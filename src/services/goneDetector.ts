import * as vscode from 'vscode';
import { getBranchInfo, deleteBranchForce, getCommitHash } from '../git';
import { addRecoveryEntry } from '../storage';
import { RepositoryContextManager } from './repositoryContext';
import { BranchTreeProvider } from './branchTreeProvider';
import { BranchInfo } from '../types';

/**
 * Detects branches whose remote tracking ref has been deleted ("gone")
 * after a fetch, and handles them according to the goneBranchAction setting.
 *
 * Designed to be called from file-system watchers observing FETCH_HEAD.
 * A 500ms debounce per repository prevents redundant work on rapid fetch events.
 */
export class GoneDetector implements vscode.Disposable {
  /** Known gone branch names per repo path — prevents false "newly gone" alerts on startup. */
  private knownGone: Map<string, Set<string>> = new Map();
  /** Debounce timers per repo path. */
  private debounceTimers: Map<string, ReturnType<typeof setTimeout>> = new Map();

  constructor(
    private readonly repoContext: RepositoryContextManager,
    private readonly treeProvider: BranchTreeProvider,
    private readonly context: vscode.ExtensionContext
  ) {}

  /**
   * Seeds knownGone from the current branch state so that branches already
   * gone at activation time are not reported as newly gone on the first fetch.
   */
  async initialize(): Promise<void> {
    for (const repo of this.repoContext.getRepositories()) {
      try {
        const branches = await getBranchInfo(repo.path);
        const goneSet = new Set(
          branches
            .filter(b => b.remoteGone === true && !b.isCurrentBranch)
            .map(b => b.name)
        );
        this.knownGone.set(repo.path, goneSet);
      } catch {
        // Skip repos that fail — non-fatal
      }
    }
  }

  /**
   * Schedules a gone-branch detection run for the given repo with a 500ms debounce.
   * Should be called from FETCH_HEAD file-watcher callbacks.
   */
  onFetchCompleted(repoPath: string): void {
    const existing = this.debounceTimers.get(repoPath);
    if (existing !== undefined) {
      clearTimeout(existing);
    }
    const timer = setTimeout(() => {
      this.debounceTimers.delete(repoPath);
      this.detectAndHandle(repoPath);
    }, 500);
    this.debounceTimers.set(repoPath, timer);
  }

  /** Clears all pending debounce timers. */
  dispose(): void {
    for (const timer of this.debounceTimers.values()) {
      clearTimeout(timer);
    }
    this.debounceTimers.clear();
  }

  /**
   * Core detection logic — computes the delta between previously known gone
   * branches and currently gone branches, then dispatches based on config.
   */
  private async detectAndHandle(repoPath: string): Promise<void> {
    let branches: BranchInfo[];
    try {
      branches = await getBranchInfo(repoPath);
    } catch {
      return;
    }

    const goneBranches = branches.filter(b => b.remoteGone && !b.isCurrentBranch);
    const nowGone = new Set(goneBranches.map(b => b.name));
    const previouslyKnown = this.knownGone.get(repoPath) ?? new Set<string>();

    const newlyGone = goneBranches.filter(b => !previouslyKnown.has(b.name));

    // Update tracking state regardless of newlyGone count
    this.knownGone.set(repoPath, nowGone);

    if (newlyGone.length === 0) {
      return;
    }

    const action = vscode.workspace
      .getConfiguration('gitBranchManager')
      .get<string>('goneBranchAction', 'prompt');

    const msg =
      newlyGone.length === 1
        ? `Branch "${newlyGone[0].name}" is orphaned — remote was deleted`
        : `${newlyGone.length} branches are orphaned — their remotes were deleted`;

    if (action === 'auto-delete') {
      await this.deleteBranches(repoPath, newlyGone);
      this.treeProvider.scheduleRefresh();
      return;
    }

    if (action === 'notify-only') {
      vscode.window.showInformationMessage(msg);
      return;
    }

    // Default: prompt
    const choice = await vscode.window.showWarningMessage(
      msg,
      'Clean All Gone',
      'Preview',
      'Dismiss'
    );

    if (choice === 'Clean All Gone') {
      await this.deleteBranches(repoPath, newlyGone);
      this.treeProvider.scheduleRefresh();
    } else if (choice === 'Preview') {
      await this.previewAndConfirm(repoPath, newlyGone);
    }
  }

  /**
   * Shows a multi-select QuickPick so the user can choose which orphaned
   * branches to delete. All branches are pre-selected by default.
   */
  private async previewAndConfirm(
    repoPath: string,
    goneBranches: BranchInfo[]
  ): Promise<void> {
    const items = goneBranches.map(b => ({
      label: `$(git-branch) ${b.name}`,
      description: b.trackingBranch ? `was tracking ${b.trackingBranch}` : 'remote gone',
      picked: true,
    }));

    const selected = await vscode.window.showQuickPick(items, {
      placeHolder: 'Select orphaned branches to delete (all pre-selected)',
      canPickMany: true,
    });

    if (!selected || selected.length === 0) {
      return;
    }

    // Match selected items back to BranchInfo objects by branch name
    const selectedNames = new Set(selected.map(s => s.label.replace(/^\$\(git-branch\) /, '')));
    const toDelete = goneBranches.filter(b => selectedNames.has(b.name));

    await this.deleteBranches(repoPath, toDelete);
    this.treeProvider.scheduleRefresh();
  }

  /**
   * Logs each branch to the recovery store, then force-deletes it.
   * Individual branch failures are caught so a single error does not abort
   * the rest of the batch.
   */
  private async deleteBranches(
    repoPath: string,
    branches: BranchInfo[]
  ): Promise<void> {
    let deleted = 0;

    for (const branch of branches) {
      try {
        // Log to recovery before deletion
        const hash = await getCommitHash(repoPath, branch.name);
        if (hash) {
          await addRecoveryEntry(this.context, repoPath, {
            branchName: branch.name,
            commitHash: hash,
            deletedAt: Date.now(),
          });
        }

        await deleteBranchForce(repoPath, branch.name);

        // Remove from knownGone tracking
        this.knownGone.get(repoPath)?.delete(branch.name);

        deleted++;
      } catch {
        // Continue with remaining branches on individual failure
      }
    }

    if (deleted > 0) {
      vscode.window.showInformationMessage(
        `Deleted ${deleted} orphaned branch${deleted === 1 ? '' : 'es'}`
      );
    }
  }
}
