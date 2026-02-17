import * as vscode from 'vscode';
import { getBranchInfo, deleteBranchForce, getCommitHash, gitCommand } from '../git';
import { getCleanupRules, evaluateCleanupRule, addRecoveryEntry } from '../storage';
import { isExcluded } from '../utils/regex';
import { RepositoryContextManager } from './repositoryContext';
import { BranchTreeProvider } from './branchTreeProvider';
import { BranchInfo } from '../types';

/**
 * Evaluates branches against compound cleanup rules on demand, applies exclusion
 * patterns and team-safe filtering, and shows a dry-run preview before deletion.
 *
 * Designed to be triggered by git event watchers (fetch, pull, merge).
 * A 500ms debounce per repository prevents redundant work on rapid events.
 */
export class AutoCleanupEvaluator implements vscode.Disposable {
  /** Debounce timers per repo path. */
  private debounceTimers: Map<string, ReturnType<typeof setTimeout>> = new Map();

  constructor(
    private readonly repoContext: RepositoryContextManager,
    private readonly treeProvider: BranchTreeProvider,
    private readonly context: vscode.ExtensionContext
  ) {}

  /**
   * Schedules a cleanup evaluation run for the given repo with a 500ms debounce.
   * Should be called from git event file-watcher callbacks.
   */
  onEventTriggered(repoPath: string): void {
    const existing = this.debounceTimers.get(repoPath);
    if (existing !== undefined) {
      clearTimeout(existing);
    }
    const timer = setTimeout(() => {
      this.debounceTimers.delete(repoPath);
      this.evaluateAndHandle(repoPath);
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
   * Core evaluation logic — checks branches against enabled cleanup rules,
   * applies exclusion patterns and team-safe filtering, then shows a dry-run
   * QuickPick preview before deleting with recovery logging.
   */
  private async evaluateAndHandle(repoPath: string): Promise<void> {
    const config = vscode.workspace.getConfiguration('gitBranchManager');
    const autoCleanupOnEvents = config.get<string[]>('autoCleanupOnEvents', ['fetch', 'pull']);

    if (autoCleanupOnEvents.length === 0) {
      return;
    }

    const enabledRules = getCleanupRules(this.context, repoPath).filter(r => r.enabled);
    if (enabledRules.length === 0) {
      return;
    }

    let branches: BranchInfo[];
    try {
      branches = await getBranchInfo(repoPath);
    } catch {
      return;
    }

    // Union results from all enabled rules, deduplicated by branch name
    const candidateMap = new Map<string, BranchInfo>();
    for (const rule of enabledRules) {
      const matches = evaluateCleanupRule(branches, rule);
      for (const branch of matches) {
        candidateMap.set(branch.name, branch);
      }
    }

    let candidates = Array.from(candidateMap.values());

    // Apply exclusion glob patterns
    const exclusionPatterns = config.get<string[]>('cleanupExclusionPatterns', []);
    if (exclusionPatterns.length > 0) {
      candidates = candidates.filter(b => !isExcluded(b.name, exclusionPatterns));
    }

    // Apply team-safe mode: only branches authored by the current git user
    const teamSafeMode = config.get<boolean>('teamSafeMode', false);
    if (teamSafeMode) {
      let currentUser: string | undefined;
      try {
        currentUser = await gitCommand(['config', 'user.name'], repoPath);
      } catch {
        // Skip filter on failure — safe default is to not filter
      }

      if (currentUser) {
        candidates = candidates.filter(b => b.author === currentUser);
      }
    }

    if (candidates.length === 0) {
      return;
    }

    // Dry-run preview: multi-select QuickPick, all pre-selected
    const items = candidates.map(b => ({
      label: `$(git-branch) ${b.name}`,
      description: `${b.daysOld}d old · ${b.isMerged ? 'merged' : 'unmerged'}`,
      detail: b.author ? `Author: ${b.author}` : undefined,
      picked: true,
    }));

    const selected = await vscode.window.showQuickPick(items, {
      title: 'Auto-Cleanup Preview — uncheck to keep',
      placeHolder: `${candidates.length} branch${candidates.length === 1 ? '' : 'es'} matched cleanup rules`,
      canPickMany: true,
    });

    if (!selected || selected.length === 0) {
      return;
    }

    // Match selected labels back to BranchInfo objects
    const selectedLabels = new Set(selected.map(s => s.label));
    const toDelete = candidates.filter(b => selectedLabels.has(`$(git-branch) ${b.name}`));

    let deleted = 0;

    for (const branch of toDelete) {
      try {
        const hash = await getCommitHash(repoPath, branch.name);
        if (hash) {
          await addRecoveryEntry(this.context, repoPath, {
            branchName: branch.name,
            commitHash: hash,
            deletedAt: Date.now(),
          });
        }

        await deleteBranchForce(repoPath, branch.name);
        deleted++;
      } catch {
        // Continue with remaining branches on individual failure
      }
    }

    if (deleted > 0) {
      vscode.window.showInformationMessage(
        `Deleted ${deleted} branch${deleted === 1 ? '' : 'es'} via auto-cleanup`
      );
      this.treeProvider.scheduleRefresh();
    }
  }
}
