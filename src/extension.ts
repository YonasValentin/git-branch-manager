import * as vscode from 'vscode';

// Types
import {
  BranchInfo,
  PRStatus,
  RemoteBranchInfo,
  WorktreeInfo,
  StashInfo,
  CleanupRule,
  DeletedBranchEntry,
  CommitInfo,
  FileChange,
  BranchNote,
} from './types';

// Services
import { RepositoryContextManager, BranchTreeProvider, BranchItem, StatusGroupItem, GoneDetector, AutoCleanupEvaluator, DiffContentProvider, GIT_DIFF_SCHEME } from './services';

// Utilities
import { getNonce, formatAge, validateRegexPattern } from './utils';
import { escapeForScriptTag } from './internals/escapeForScriptTag';
import { reqStr, reqStrArray, reqNum, isCleanupRuleArray } from './internals/messageValidators';
import { mapPR } from './internals/mapPR';
import { buildInitialData } from './internals/buildInitialData';
import { createSafePost } from './internals/safePost';
import { requireValidRef } from './internals/validateRef';

// Git operations
import {
  gitCommand,
  getCurrentBranch,
  getBaseBranch,
  getBranchInfo,
  getRemoteBranchInfo,
  getWorktreeInfo,
  getStashInfo,
  createStash,
  applyStash,
  popStash,
  dropStash,
  clearStashes,
  compareBranches,
  getBranchTimeline,
  getAllBranchNames,
  renameBranch,
  deleteBranchForce,
  fetchGitHubPRs,
  detectPlatform,
  fetchGitLabMRs,
  fetchAzurePRs,
} from './git';

// Storage
import {
  getBranchNotes,
  saveBranchNote,
  getCleanupRules,
  saveCleanupRules,
  evaluateCleanupRule,
  getRecoveryLog,
  removeRecoveryEntry,
} from './storage';

// Commands
import {
  quickStash,
  quickStashPop,
  createBranchFromTemplate,
  createWorktreeFromBranch,
  showWorktreeManager,
  cleanRemoteBranches,
  quickCleanup,
  switchBranch,
  checkBranchHealth,
  undoLastDelete,
  restoreFromLog,
} from './commands';

/**
 * Looks up the current GitHub authentication session on demand. Avoids the
 * stale-cache pitfall where a module-level `let session` survives a
 * user-initiated revoke/sign-out.
 */
async function getGitHubAccessToken(silent = true): Promise<string | undefined> {
  try {
    const session = await vscode.authentication.getSession('github', ['repo'], silent ? { silent: true } : { createIfNone: true });
    return session?.accessToken;
  } catch {
    return undefined;
  }
}

export async function activate(context: vscode.ExtensionContext) {
  void incrementUsageCount(context);

  const repoContext = new RepositoryContextManager(context);
  await repoContext.discoverRepositories();
  context.subscriptions.push(repoContext);

  // PAT secret storage keys
  const GITLAB_TOKEN_KEY = 'gitBranchManager.gitlabToken';
  const AZURE_TOKEN_KEY = 'gitBranchManager.azureToken';

  // Re-fetch PR data when the user's GitHub auth session changes (sign-in, sign-out, token rotation).
  context.subscriptions.push(
    vscode.authentication.onDidChangeSessions((e) => {
      if (e.provider.id === 'github') {
        // Active panel will pick up the new token on its next refresh; tree view too.
        // No need to push state imperatively — VS Code's lazy refresh model handles it.
      }
    })
  );

  // Refresh views when our settings change (e.g., daysUntilStale moves a branch
  // from active → stale; protectedBranches changes the cleanup target set).
  context.subscriptions.push(
    vscode.workspace.onDidChangeConfiguration((e) => {
      if (e.affectsConfiguration('gitBranchManager')) {
        branchTreeProvider.scheduleRefresh();
      }
    })
  );

  // Register DiffContentProvider for virtual diff documents (COMP-03)
  const diffProvider = new DiffContentProvider();
  context.subscriptions.push(
    vscode.workspace.registerTextDocumentContentProvider(GIT_DIFF_SCHEME, diffProvider)
  );

  const statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 100);
  statusBarItem.command = 'git-branch-manager.cleanup';
  context.subscriptions.push(statusBarItem);

  /**
   * Updates the global status bar item using the current repo context.
   */
  async function updateGlobalStatusBar() {
    await updateStatusBar(statusBarItem, repoContext);
  }

  void updateGlobalStatusBar();

  // Tree view (TREE-04, TREE-05)
  const branchTreeProvider = new BranchTreeProvider(repoContext);
  const branchTreeView = vscode.window.createTreeView('git-branch-manager.branchTree', {
    treeDataProvider: branchTreeProvider,
    showCollapseAll: true,
  });
  context.subscriptions.push(branchTreeView, branchTreeProvider);

  // File watchers for auto-refresh (TREE-05).
  // Tracked per-repo so we can re-create them when workspace folders change.
  const repoWatcherDisposables = new Map<string, vscode.Disposable[]>();

  // Gone branch auto-detection (GONE-01, GONE-02, GONE-03, GONE-04)
  const goneDetector = new GoneDetector(repoContext, branchTreeProvider, context);
  await goneDetector.initialize();
  context.subscriptions.push(goneDetector);

  // Auto-cleanup evaluator (AUTO-01 to AUTO-05)
  const autoCleanupEvaluator = new AutoCleanupEvaluator(repoContext, branchTreeProvider, context);
  context.subscriptions.push(autoCleanupEvaluator);

  function watchRepo(repoPath: string) {
    if (repoWatcherDisposables.has(repoPath)) return; // already watching

    const refsWatcher = vscode.workspace.createFileSystemWatcher(new vscode.RelativePattern(repoPath, '.git/refs/heads/**'));
    const headWatcher = vscode.workspace.createFileSystemWatcher(new vscode.RelativePattern(repoPath, '.git/HEAD'));
    const packedWatcher = vscode.workspace.createFileSystemWatcher(new vscode.RelativePattern(repoPath, '.git/packed-refs'));
    const fetchHeadWatcher = vscode.workspace.createFileSystemWatcher(new vscode.RelativePattern(repoPath, '.git/FETCH_HEAD'));
    const origHeadWatcher = vscode.workspace.createFileSystemWatcher(new vscode.RelativePattern(repoPath, '.git/ORIG_HEAD'));

    const scheduleRefresh = () => branchTreeProvider.scheduleRefresh();
    const onFetchOrCleanup = () => {
      goneDetector.onFetchCompleted(repoPath);
      autoCleanupEvaluator.onEventTriggered(repoPath);
    };

    const disposables: vscode.Disposable[] = [
      refsWatcher.onDidCreate(scheduleRefresh),
      refsWatcher.onDidDelete(scheduleRefresh),
      refsWatcher.onDidChange(scheduleRefresh),
      headWatcher.onDidChange(scheduleRefresh),
      packedWatcher.onDidChange(scheduleRefresh),
      fetchHeadWatcher.onDidChange(onFetchOrCleanup),
      fetchHeadWatcher.onDidCreate(onFetchOrCleanup),
      origHeadWatcher.onDidCreate(() => autoCleanupEvaluator.onEventTriggered(repoPath)),
      refsWatcher, headWatcher, packedWatcher, fetchHeadWatcher, origHeadWatcher,
    ];
    repoWatcherDisposables.set(repoPath, disposables);
    for (const d of disposables) context.subscriptions.push(d);
  }

  function unwatchRepo(repoPath: string) {
    const disposables = repoWatcherDisposables.get(repoPath);
    if (!disposables) return;
    for (const d of disposables) d.dispose();
    repoWatcherDisposables.delete(repoPath);
  }

  // Initial watcher setup for each known repo
  for (const repo of repoContext.getRepositories()) watchRepo(repo.path);

  // Re-sync watchers when workspace folders change (repos added/removed)
  context.subscriptions.push(
    vscode.workspace.onDidChangeWorkspaceFolders(async () => {
      await repoContext.discoverRepositories();
      const current = new Set(repoContext.getRepositories().map((r) => r.path));
      for (const path of repoWatcherDisposables.keys()) {
        if (!current.has(path)) unwatchRepo(path);
      }
      for (const repo of repoContext.getRepositories()) watchRepo(repo.path);
      branchTreeProvider.scheduleRefresh();
    })
  );

  // cleanGoneBranches command (GONE-04) — programmatic trigger for manual gone-branch scan
  context.subscriptions.push(
    vscode.commands.registerCommand('git-branch-manager.cleanGoneBranches', () => {
      for (const repo of repoContext.getRepositories()) {
        goneDetector.onFetchCompleted(repo.path);
      }
    })
  );

  // Tree-specific command handlers (TREE-04)
  context.subscriptions.push(
    vscode.commands.registerCommand('git-branch-manager.refreshTree', () => {
      branchTreeProvider.scheduleRefresh();
    }),

    vscode.commands.registerCommand('git-branch-manager.loadMoreBranches', (group: StatusGroupItem) => {
      branchTreeProvider.loadMore(group);
    }),

    vscode.commands.registerCommand('git-branch-manager.treeDeleteBranch', async (item: BranchItem) => {
      if (!item?.branch?.name || !item?.repoPath) return;

      const config = vscode.workspace.getConfiguration('gitBranchManager');
      const confirmBeforeDelete = config.get<boolean>('confirmBeforeDelete', true);

      if (confirmBeforeDelete) {
        const answer = await vscode.window.showWarningMessage(
          `Delete branch "${item.branch.name}"?`,
          { modal: true },
          'Delete'
        );
        if (answer !== 'Delete') return;
      }

      try {
        await deleteBranchForce(item.repoPath, item.branch.name);
        vscode.window.showInformationMessage(`Deleted branch: ${item.branch.name}`);
        branchTreeProvider.scheduleRefresh();
        void updateGlobalStatusBar();
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        vscode.window.showErrorMessage(`Failed to delete branch: ${msg}`);
      }
    }),

    vscode.commands.registerCommand('git-branch-manager.treeSwitchBranch', async (item: BranchItem) => {
      if (!item?.branch?.name || !item?.repoPath) return;

      try {
        await switchBranch(item.repoPath, item.branch.name);
        branchTreeProvider.scheduleRefresh();
        void updateGlobalStatusBar();
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        vscode.window.showErrorMessage(`Failed to switch branch: ${msg}`);
      }
    }),

    vscode.commands.registerCommand('git-branch-manager.treeCompareBranch', async (item: BranchItem) => {
      if (!item?.branch?.name || !item?.repoPath) return;

      // Show webview and guide user to Compare tab (COMP-03)
      await vscode.commands.executeCommand('git-branch-manager.cleanup');
      vscode.window.showInformationMessage(`Compare "${item.branch.name}" with current branch using the Compare tab in Branch Manager.`);
    }),
  );

  // Platform connection command (PLAT-04)
  context.subscriptions.push(
    vscode.commands.registerCommand('git-branch-manager.connectPlatform', async () => {
      const repo = await repoContext.getActiveRepository();
      if (!repo) { return; }
      const platformInfo = await detectPlatform(repo.path);

      if (platformInfo.platform === 'github') {
        const token = await getGitHubAccessToken(/* silent */ false);
        if (token) { vscode.window.showInformationMessage('Connected to GitHub'); }
      } else if (platformInfo.platform === 'gitlab') {
        const token = await vscode.window.showInputBox({
          title: 'GitLab Personal Access Token',
          prompt: 'Enter a GitLab PAT with read_api scope. Stored securely in OS keychain.',
          password: true,
          ignoreFocusOut: true,
        });
        if (token) {
          await context.secrets.store(GITLAB_TOKEN_KEY, token);
          vscode.window.showInformationMessage('Connected to GitLab');
        }
      } else if (platformInfo.platform === 'azure') {
        const token = await vscode.window.showInputBox({
          title: 'Azure DevOps Personal Access Token',
          prompt: 'Enter an Azure DevOps PAT with Code (Read) scope. Stored securely in OS keychain.',
          password: true,
          ignoreFocusOut: true,
        });
        if (token) {
          await context.secrets.store(AZURE_TOKEN_KEY, token);
          vscode.window.showInformationMessage('Connected to Azure DevOps');
        }
      } else {
        vscode.window.showWarningMessage('No recognized git platform detected from remote URL.');
      }
    })
  );

  // Open PR/MR in browser command (PLAT-04)
  context.subscriptions.push(
    vscode.commands.registerCommand('git-branch-manager.openPR', (item: BranchItem) => {
      const prUrl = item?.branch?.prStatus?.url;
      if (prUrl) {
        vscode.env.openExternal(vscode.Uri.parse(prUrl));
      } else {
        vscode.window.showInformationMessage('No PR/MR associated with this branch.');
      }
    })
  );

  // Clear platform token command
  context.subscriptions.push(
    vscode.commands.registerCommand('git-branch-manager.clearPlatformToken', async () => {
      const platform = await vscode.window.showQuickPick(['GitLab', 'Azure DevOps'], { placeHolder: 'Select platform to disconnect' });
      if (platform === 'GitLab') {
        await context.secrets.delete(GITLAB_TOKEN_KEY);
        vscode.window.showInformationMessage('GitLab token cleared.');
      } else if (platform === 'Azure DevOps') {
        await context.secrets.delete(AZURE_TOKEN_KEY);
        vscode.window.showInformationMessage('Azure DevOps token cleared.');
      }
    })
  );

  const cleanupCommand = vscode.commands.registerCommand('git-branch-manager.cleanup', () => {
    showBranchManager(context, repoContext, updateGlobalStatusBar, branchTreeProvider, GITLAB_TOKEN_KEY, AZURE_TOKEN_KEY);
  });
  context.subscriptions.push(cleanupCommand);

  const quickCleanupCommand = vscode.commands.registerCommand('git-branch-manager.quickCleanup', () => {
    quickCleanup(repoContext, context, updateGlobalStatusBar);
  });
  context.subscriptions.push(quickCleanupCommand);

  const createBranchCommand = vscode.commands.registerCommand('git-branch-manager.createBranch', () => {
    createBranchFromTemplate(repoContext);
  });
  context.subscriptions.push(createBranchCommand);

  const cleanRemotesCommand = vscode.commands.registerCommand('git-branch-manager.cleanRemotes', () => {
    cleanRemoteBranches(repoContext, context);
  });
  context.subscriptions.push(cleanRemotesCommand);

  const manageWorktreesCommand = vscode.commands.registerCommand('git-branch-manager.manageWorktrees', () => {
    showWorktreeManager(repoContext, context);
  });
  context.subscriptions.push(manageWorktreesCommand);

  const createWorktreeCommand = vscode.commands.registerCommand('git-branch-manager.createWorktree', () => {
    createWorktreeFromBranch(repoContext);
  });
  context.subscriptions.push(createWorktreeCommand);

  const stashCommand = vscode.commands.registerCommand('git-branch-manager.stash', () => {
    quickStash(repoContext);
  });
  context.subscriptions.push(stashCommand);

  const stashPopCommand = vscode.commands.registerCommand('git-branch-manager.stashPop', () => {
    quickStashPop(repoContext);
  });
  context.subscriptions.push(stashPopCommand);

  const undoDeleteCommand = vscode.commands.registerCommand('git-branch-manager.undoDelete', async () => {
    const repo = await repoContext.getActiveRepository();
    if (!repo) return;
    await undoLastDelete(context, repo.path);
    await updateGlobalStatusBar();
  });
  context.subscriptions.push(undoDeleteCommand);

  const statusBarInterval = setInterval(() => { updateGlobalStatusBar().catch(() => {}); }, 30000);
  const healthCheckTimeout = setTimeout(() => checkBranchHealth(repoContext), 5000);

  context.subscriptions.push({
    dispose: () => {
      clearInterval(statusBarInterval);
      clearTimeout(healthCheckTimeout);
    },
  });
}

/**
 * Updates the status bar with aggregate branch cleanup count across all repositories.
 * @param statusBarItem - The status bar item to update
 * @param repoContext - Repository context manager
 */
async function updateStatusBar(statusBarItem: vscode.StatusBarItem, repoContext: RepositoryContextManager) {
  let allRepos = repoContext.getRepositories();

  if (allRepos.length === 0) {
    await repoContext.discoverRepositories();
    allRepos = repoContext.getRepositories();
    if (allRepos.length === 0) {
      statusBarItem.hide();
      return;
    }
  }

  try {
    const config = vscode.workspace.getConfiguration('gitBranchManager');
    const daysUntilStale = config.get<number>('daysUntilStale', 30);
    let totalCleanupCount = 0;

    for (const repo of allRepos) {
      try {
        const branches = await getBranchInfo(repo.path);
        totalCleanupCount += branches.filter(
          (b) => !b.isCurrentBranch && (b.isMerged || b.daysOld > daysUntilStale || b.remoteGone)
        ).length;
      } catch {
        // Skip repos with errors
      }
    }

    if (totalCleanupCount > 0) {
      statusBarItem.text = `$(git-branch) ${totalCleanupCount} to clean`;
      statusBarItem.tooltip = allRepos.length === 1
        ? `${totalCleanupCount} branches ready for cleanup`
        : `${totalCleanupCount} branches across ${allRepos.length} repositories`;
      statusBarItem.backgroundColor = new vscode.ThemeColor('statusBarItem.warningBackground');
    } else {
      statusBarItem.text = '$(git-branch) Branches';
      statusBarItem.tooltip = 'Git branches are clean';
      statusBarItem.backgroundColor = undefined;
    }
    statusBarItem.show();
  } catch {
    statusBarItem.hide();
  }
}

/**
 * Shows the branch manager webview panel.
 * @param context - Extension context for state management
 * @param repoContext - Repository context manager
 * @param updateGlobalStatusBar - Callback to update global status bar
 * @param branchTreeProvider - Tree view provider for PR status injection
 * @param gitlabTokenKey - Secret storage key for GitLab PAT
 * @param azureTokenKey - Secret storage key for Azure DevOps PAT
 */
async function showBranchManager(
  context: vscode.ExtensionContext,
  repoContext: RepositoryContextManager,
  updateGlobalStatusBar: () => Promise<void>,
  branchTreeProvider: BranchTreeProvider,
  gitlabTokenKey: string,
  azureTokenKey: string
) {
  const panel = vscode.window.createWebviewPanel('branchManager', 'Git Branch Manager', vscode.ViewColumn.One, {
    enableScripts: true,
    retainContextWhenHidden: true,
    localResourceRoots: [vscode.Uri.joinPath(context.extensionUri, 'dist')],
  });

  // Track disposal so async tasks (PR fetch, comparisons) don't postMessage after close.
  const disposalState = { disposed: false };
  panel.onDidDispose(() => { disposalState.disposed = true; }, undefined, context.subscriptions);
  const safePost = createSafePost(
    (msg) => { void panel.webview.postMessage(msg); },
    disposalState,
  );

  async function updateWebview() {
    const repo = await repoContext.getActiveRepository();
    if (!repo) {
      panel.title = 'Git Branch Manager';
      panel.webview.html = getWebviewContent(panel.webview, context.extensionUri, buildInitialData([], [], [], [], [], [], new Map(), '', 'main', '', 30));
      return;
    }
    panel.title = `Git Branch Manager: ${repo.name}`;
    const gitRoot = repo.path;

    const config = vscode.workspace.getConfiguration('gitBranchManager');
    const daysUntilStale = config.get<number>('daysUntilStale', 30);

    const [branches, remoteBranches, worktrees, stashes, currentBranch, baseBranch] = await Promise.all([
      getBranchInfo(gitRoot),
      getRemoteBranchInfo(gitRoot),
      getWorktreeInfo(gitRoot),
      getStashInfo(gitRoot),
      getCurrentBranch(gitRoot),
      getBaseBranch(gitRoot),
    ]);

    const cleanupRulesArray = getCleanupRules(context, gitRoot);
    const recoveryLog = getRecoveryLog(context, gitRoot);
    const branchNotes = getBranchNotes(context, gitRoot);

    // Phase 1: Render immediately with local git data (no PR API calls)
    panel.webview.html = getWebviewContent(
      panel.webview,
      context.extensionUri,
      buildInitialData(branches, remoteBranches, worktrees, stashes, cleanupRulesArray, recoveryLog, branchNotes, currentBranch ?? '', baseBranch, repo.name, daysUntilStale)
    );

    // Phase 2: Fetch PR data asynchronously and push to webview
    void (async () => {
      try {
        const platformInfo = await detectPlatform(gitRoot);
        let prMap = new Map<string, PRStatus>();
        const branchNames = branches.map(b => b.name);

        if (platformInfo.platform === 'github') {
          const token = await getGitHubAccessToken();
          if (platformInfo.owner && platformInfo.repo) {
            prMap = await fetchGitHubPRs(platformInfo.owner, platformInfo.repo, branchNames, token);
          }
        } else if (platformInfo.platform === 'gitlab') {
          const token = await context.secrets.get(gitlabTokenKey);
          if (token && platformInfo.gitlabHost && platformInfo.projectPath) {
            prMap = await fetchGitLabMRs(platformInfo.gitlabHost, platformInfo.projectPath, branchNames, token);
          }
        } else if (platformInfo.platform === 'azure') {
          const token = await context.secrets.get(azureTokenKey);
          if (token && platformInfo.organization && platformInfo.project && platformInfo.azureRepo) {
            prMap = await fetchAzurePRs(platformInfo.organization, platformInfo.project, platformInfo.azureRepo, branchNames, token);
          }
        }

        if (prMap.size > 0) {
          // Webview expects mapped PRInfo shape, not raw PRStatus.
          for (const [branchName, pr] of prMap) {
            safePost({ command: 'prStatusUpdate', data: { branchName, pr: mapPR(pr) } });
          }
        }

        branchTreeProvider.setPRStatuses(prMap);
        branchTreeProvider.scheduleRefresh();
      } catch (err) {
        // PR fetch is supplementary — don't block the panel render on failure,
        // but surface auth/rate-limit problems so users know why PR badges
        // are missing. Token errors get a sticky info message; transient
        // network errors are logged silently.
        const msg = err instanceof Error ? err.message : String(err);
        if (/401|403|rate limit/i.test(msg)) {
          vscode.window.showWarningMessage(`PR status unavailable: ${msg}`);
        } else {
          console.warn('[git-branch-manager] PR fetch failed:', msg);
        }
      }
    })();
  }

  await updateWebview();

  type WebviewMessage = { command: string } & Record<string, unknown>;

  panel.webview.onDidReceiveMessage(
    async (message: WebviewMessage) => {
      if (!message || typeof message.command !== 'string') return;
      const repo = await repoContext.getActiveRepository();
      if (!repo) return;
      const gitRoot = repo.path;

      switch (message.command) {
        case 'delete':
          try {
            const delBranch = requireValidRef(reqStr(message.branchName, 'branchName'), 'branchName');
            await deleteBranchForce(gitRoot, delBranch);
            vscode.window.showInformationMessage(`Deleted branch: ${delBranch}`);

            const totalDeleted = context.globalState.get<number>('totalBranchesDeleted', 0);
            await context.globalState.update('totalBranchesDeleted', totalDeleted + 1);
            await checkAndShowReviewRequest(context);

            await updateWebview();
            await updateGlobalStatusBar();
          } catch (error) {
            vscode.window.showErrorMessage(`Failed to delete branch: ${error}`);
          }
          break;

        case 'deleteMultiple':
          const branchesToDelete = reqStrArray(message.branchNames, 'branchNames').map((b) => requireValidRef(b, 'branchNames'));
          const results = { success: [] as string[], failed: [] as Array<{ branch: string; error: string }> };

          for (const branch of branchesToDelete) {
            try {
              await deleteBranchForce(gitRoot, branch);
              results.success.push(branch);
            } catch (error) {
              results.failed.push({ branch, error: String(error) });
            }
          }

          const totalDeleted = context.globalState.get<number>('totalBranchesDeleted', 0);
          await context.globalState.update('totalBranchesDeleted', totalDeleted + results.success.length);

          if (results.success.length > 0) {
            vscode.window.showInformationMessage(`Deleted ${results.success.length} branches`);
            await checkAndShowReviewRequest(context);
          }

          if (results.failed.length > 0) {
            vscode.window.showWarningMessage(`Failed to delete ${results.failed.length} branches`);
          }

          await updateWebview();
          await updateGlobalStatusBar();
          break;

        case 'switch':
          try {
            const switchBranchName = requireValidRef(reqStr(message.branchName, 'branchName'), 'branchName');
            await gitCommand(['checkout', switchBranchName], gitRoot);
            vscode.window.showInformationMessage(`Switched to branch: ${switchBranchName}`);
            await updateWebview();
            await updateGlobalStatusBar();
          } catch (error) {
            vscode.window.showErrorMessage(`Failed to switch branch: ${error}`);
          }
          break;

        case 'createStash':
          try {
            const stashMessage = await vscode.window.showInputBox({
              prompt: 'Stash message (optional)',
              placeHolder: 'WIP: feature work',
            });
            if (stashMessage !== undefined) {
              await createStash(gitRoot, stashMessage || undefined);
              vscode.window.showInformationMessage('Created stash');
              await updateWebview();
            }
          } catch (error) {
            vscode.window.showErrorMessage(`Failed to create stash: ${error}`);
          }
          break;

        case 'applyStash':
          try {
            const idx = reqNum(message.index, 'index');
            await applyStash(gitRoot, idx);
            vscode.window.showInformationMessage(`Applied stash ${idx}`);
            await updateWebview();
          } catch (error) {
            vscode.window.showErrorMessage(`Failed to apply stash: ${error}`);
          }
          break;

        case 'popStash':
          try {
            const idx = reqNum(message.index, 'index');
            await popStash(gitRoot, idx);
            vscode.window.showInformationMessage(`Popped stash ${idx}`);
            await updateWebview();
          } catch (error) {
            vscode.window.showErrorMessage(`Failed to pop stash: ${error}`);
          }
          break;

        case 'dropStash':
          try {
            const idx = reqNum(message.index, 'index');
            await dropStash(gitRoot, idx);
            vscode.window.showInformationMessage(`Dropped stash ${idx}`);
            await updateWebview();
          } catch (error) {
            vscode.window.showErrorMessage(`Failed to drop stash: ${error}`);
          }
          break;

        case 'clearStashes':
          const confirm = await vscode.window.showWarningMessage(
            'Are you sure you want to clear all stashes? This cannot be undone.',
            { modal: true },
            'Clear All'
          );
          if (confirm === 'Clear All') {
            try {
              await clearStashes(gitRoot);
              vscode.window.showInformationMessage('Cleared all stashes');
              await updateWebview();
            } catch (error) {
              vscode.window.showErrorMessage(`Failed to clear stashes: ${error}`);
            }
          }
          break;

        case 'compareBranches':
          try {
            const branchA = requireValidRef(reqStr(message.branchA, 'branchA'), 'branchA');
            const branchB = requireValidRef(reqStr(message.branchB, 'branchB'), 'branchB');
            const comparison = await compareBranches(gitRoot, branchA, branchB);
            safePost({ command: 'comparisonResult', data: {
              ahead: (comparison.commitsA ?? []).map((c: CommitInfo) => ({ hash: c.hash, message: c.message, author: c.author, date: c.date })),
              behind: (comparison.commitsB ?? []).map((c: CommitInfo) => ({ hash: c.hash, message: c.message, author: c.author, date: c.date })),
              files: (comparison.files ?? []).map((f: FileChange) => ({ path: f.path, status: f.status, additions: 0, deletions: 0 })),
            } });
          } catch (error) {
            vscode.window.showErrorMessage(`Failed to compare branches: ${error}`);
          }
          break;

        case 'getTimeline':
          try {
            const branchName = requireValidRef(reqStr(message.branchName, 'branchName'), 'branchName');
            const timeline = await getBranchTimeline(gitRoot, branchName, 5);
            safePost({ command: 'timelineResult', data: { branchName, commits: timeline } });
          } catch {
            // Silent failure — timeline is supplementary
          }
          break;

        case 'renameBranch':
          try {
            const oldName = requireValidRef(reqStr(message.oldName, 'oldName'), 'oldName');
            const newName = await vscode.window.showInputBox({
              prompt: 'New branch name',
              value: oldName,
              validateInput: (value) => {
                if (!value) return 'Branch name cannot be empty';
                if (value === oldName) return 'New name must be different';
                return null;
              },
            });

            if (newName) {
              await renameBranch(gitRoot, oldName, newName);
              vscode.window.showInformationMessage(`Renamed ${oldName} to ${newName}`);
              await updateWebview();
              await updateGlobalStatusBar();
            }
          } catch (error) {
            vscode.window.showErrorMessage(`Failed to rename branch: ${error}`);
          }
          break;

        case 'batchRename':
          try {
            const pattern = reqStr(message.pattern, 'pattern');
            const replacement = reqStr(message.replacement, 'replacement');
            const branchesToRename = reqStrArray(message.branches, 'branches');

            const validation = validateRegexPattern(pattern);
            if (!validation.valid) {
              vscode.window.showErrorMessage(`Invalid regex pattern: ${validation.error}`);
              return;
            }

            const regex = new RegExp(pattern);

            const renames: Array<{ old: string; new: string }> = [];
            for (const branch of branchesToRename) {
              if (regex.test(branch)) {
                const newName = branch.replace(regex, replacement);
                if (newName !== branch) {
                  renames.push({ old: branch, new: newName });
                }
              }
            }

            if (renames.length === 0) {
              vscode.window.showInformationMessage('No branches matched the pattern');
              return;
            }

            const previewMessage = renames.map((r) => `${r.old} → ${r.new}`).join('\n');
            const confirm = await vscode.window.showInformationMessage(
              `Rename ${renames.length} branches?\n\n${previewMessage}`,
              { modal: true },
              'Rename All'
            );

            if (confirm === 'Rename All') {
              let successCount = 0;
              const failures: string[] = [];
              for (const rename of renames) {
                try {
                  await renameBranch(gitRoot, rename.old, rename.new);
                  successCount++;
                } catch (error) {
                  const msg = error instanceof Error ? error.message : String(error);
                  failures.push(`${rename.old}: ${msg}`);
                }
              }

              if (successCount > 0) {
                vscode.window.showInformationMessage(`Renamed ${successCount} branches`);
              }
              if (failures.length > 0) {
                // Roll up failures into one notification (avoids N popups)
                const detail = failures.length <= 3
                  ? failures.join('; ')
                  : `${failures.slice(0, 3).join('; ')}; +${failures.length - 3} more`;
                vscode.window.showWarningMessage(`Failed to rename ${failures.length} branches: ${detail}`);
              }
              await updateWebview();
              await updateGlobalStatusBar();
            }
          } catch (error) {
            vscode.window.showErrorMessage(`Batch rename failed: ${error}`);
          }
          break;

        case 'deleteRemote':
          try {
            const remote = reqStr(message.remote, 'remote');
            const branch = requireValidRef(reqStr(message.branch, 'branch'), 'branch');
            const fullName = `${remote}/${branch}`;
            await deleteBranchForce(gitRoot, fullName);
            vscode.window.showInformationMessage(`Deleted remote branch: ${fullName}`);
            await updateWebview();
          } catch (error) {
            vscode.window.showErrorMessage(`Failed to delete remote branch: ${error}`);
          }
          break;

        case 'deleteMultipleRemotes': {
          const raw = message.branches;
          if (!Array.isArray(raw)) break;
          const remoteBranches = raw.filter((rb): rb is { remote: string; name: string } =>
            rb !== null && typeof rb === 'object' &&
            typeof (rb as Record<string, unknown>).remote === 'string' &&
            typeof (rb as Record<string, unknown>).name === 'string'
          );
          let successCount = 0;

          for (const rb of remoteBranches) {
            try {
              await deleteBranchForce(gitRoot, `${rb.remote}/${rb.name}`);
              successCount++;
            } catch (error) {
              console.error(`Failed to delete ${rb.remote}/${rb.name}:`, error);
            }
          }

          if (successCount > 0) {
            vscode.window.showInformationMessage(`Deleted ${successCount} remote branches`);
            await updateWebview();
          }
          break;
        }

        case 'promptBranchNote': {
          const branchName = requireValidRef(reqStr(message.branch, 'branch'), 'branch');
          const noteText = await vscode.window.showInputBox({
            prompt: `Add note for ${branchName}`,
            placeHolder: 'Enter a note for this branch',
          });
          if (noteText !== undefined) {
            await saveBranchNote(context, gitRoot, branchName, noteText);
            await updateWebview();
          }
          break;
        }

        case 'saveNote':
        case 'saveBranchNote':
          await saveBranchNote(
            context,
            gitRoot,
            reqStr(message.branchName ?? message.branch, 'branchName'),
            typeof message.note === 'string' ? message.note : ''
          );
          await updateWebview();
          break;

        case 'saveCleanupRules':
          if (!isCleanupRuleArray(message.rules)) {
            vscode.window.showErrorMessage('Invalid cleanup rules payload');
            break;
          }
          await saveCleanupRules(context, gitRoot, message.rules);
          await updateWebview();
          break;

        case 'evaluateRule': {
          const r = message.rule;
          if (!r || typeof r !== 'object' || typeof (r as Record<string, unknown>).id !== 'string') {
            break;
          }
          const rule = r as CleanupRule;
          const allBranches = await getBranchInfo(gitRoot);
          const matchingBranches = evaluateCleanupRule(allBranches, rule);

          safePost({
            command: 'ruleEvaluationResult',
            matches: matchingBranches.map((b) => b.name),
          });
          break;
        }

        case 'exportRules': {
          const exportedRules = getCleanupRules(context, gitRoot);
          await vscode.env.clipboard.writeText(JSON.stringify(exportedRules, null, 2));
          vscode.window.showInformationMessage(`Exported ${exportedRules.length} rule(s) to clipboard`);
          break;
        }

        case 'importRules': {
          const clipboardText = await vscode.env.clipboard.readText();
          let parsed: unknown;
          try {
            parsed = JSON.parse(clipboardText);
          } catch {
            vscode.window.showErrorMessage('Clipboard does not contain valid JSON');
            break;
          }
          if (!Array.isArray(parsed)) {
            vscode.window.showErrorMessage('Imported JSON must be an array of rules');
            break;
          }
          const imported = (parsed as unknown[]).filter(
            (entry): entry is CleanupRule =>
              entry !== null &&
              typeof entry === 'object' &&
              typeof (entry as Record<string, unknown>).id === 'string' &&
              typeof (entry as Record<string, unknown>).name === 'string' &&
              typeof (entry as Record<string, unknown>).enabled === 'boolean' &&
              (entry as Record<string, unknown>).conditions !== null &&
              typeof (entry as Record<string, unknown>).conditions === 'object'
          );
          if (imported.length === 0) {
            vscode.window.showErrorMessage('No valid rules found in clipboard JSON');
            break;
          }
          const existingRules = getCleanupRules(context, gitRoot);
          if (existingRules.length > 0) {
            const answer = await vscode.window.showWarningMessage(
              `Replace ${existingRules.length} existing rule(s) with ${imported.length} imported?`,
              { modal: true },
              'Replace'
            );
            if (answer !== 'Replace') break;
          }
          await saveCleanupRules(context, gitRoot, imported);
          await updateWebview();
          vscode.window.showInformationMessage(`Imported ${imported.length} rule(s)`);
          break;
        }

        case 'connectGitHub':
          try {
            const token = await getGitHubAccessToken(/* silent */ false);
            if (token) {
              vscode.window.showInformationMessage('Connected to GitHub');
              await updateWebview();
            }
          } catch (error) {
            vscode.window.showErrorMessage(`Failed to connect to GitHub: ${error}`);
          }
          break;

        case 'createBranch':
          void createBranchFromTemplate(repoContext);
          break;

        case 'createWorktree':
          void createWorktreeFromBranch(repoContext);
          break;

        case 'openSupport':
          void vscode.env.openExternal(vscode.Uri.parse('https://www.buymeacoffee.com/YonasValentin'));
          break;

        case 'openSponsor':
          void vscode.env.openExternal(vscode.Uri.parse('https://github.com/sponsors/YonasValentin'));
          break;

        case 'openGithub':
          void vscode.env.openExternal(vscode.Uri.parse('https://github.com/YonasValentin/git-branch-manager/issues'));
          break;

        case 'dismissSponsor':
          await context.globalState.update('sponsorBannerDismissed', true);
          break;

        case 'openUrl':
          if (typeof message.url === 'string') {
            void vscode.env.openExternal(vscode.Uri.parse(message.url));
          }
          break;

        case 'refresh':
          await updateWebview();
          break;

        case 'switchRepository': {
          if (repoContext.getRepositories().length === 0) {
            await repoContext.discoverRepositories();
          }
          const selectedPath = await repoContext.selectRepository();
          if (selectedPath) {
            await repoContext.setActiveRepository(selectedPath);
            await updateWebview();
            await updateGlobalStatusBar();
            branchTreeProvider.scheduleRefresh();
          }
          break;
        }

        case 'restoreBranch': {
          const branchName = requireValidRef(reqStr(message.branchName, 'branchName'), 'branchName');
          const commitHash = reqStr(message.commitHash, 'commitHash');
          const result = await restoreFromLog(context, gitRoot, branchName, commitHash);
          if (!result.success) {
            vscode.window.showErrorMessage(`Failed to restore: ${result.error}`);
          }
          await updateWebview();
          await updateGlobalStatusBar();
          break;
        }

        case 'clearRecoveryEntry': {
          const branchName = requireValidRef(reqStr(message.branchName, 'branchName'), 'branchName');
          const commitHash = reqStr(message.commitHash, 'commitHash');
          await removeRecoveryEntry(context, gitRoot, branchName, commitHash);
          await updateWebview();
          break;
        }

        case 'openDiff': {
          const branchA = requireValidRef(reqStr(message.branchA, 'branchA'), 'branchA');
          const branchB = requireValidRef(reqStr(message.branchB, 'branchB'), 'branchB');
          const filePath = reqStr(message.filePath, 'filePath');
          // Handle renamed files (R status): path is "oldPath\tnewPath"
          const paths = filePath.split('\t');
          const fileInB = paths[0] ?? filePath; // old path in branchB
          const fileInA = paths.length > 1 ? (paths[1] ?? fileInB) : fileInB; // new path in branchA

          const leftParams = `branch=${encodeURIComponent(branchB)}&file=${encodeURIComponent(fileInB)}&repo=${encodeURIComponent(gitRoot)}`;
          const rightParams = `branch=${encodeURIComponent(branchA)}&file=${encodeURIComponent(fileInA)}&repo=${encodeURIComponent(gitRoot)}`;

          const leftUri = vscode.Uri.parse(`${GIT_DIFF_SCHEME}:${encodeURIComponent(fileInB)}?${leftParams}`);
          const rightUri = vscode.Uri.parse(`${GIT_DIFF_SCHEME}:${encodeURIComponent(fileInA)}?${rightParams}`);

          const displayFile = paths.length > 1 ? `${fileInB} \u2192 ${fileInA}` : fileInA;
          await vscode.commands.executeCommand(
            'vscode.diff',
            leftUri,
            rightUri,
            `${displayFile} (${branchB} \u2194 ${branchA})`
          );
          break;
        }
      }
    },
    undefined,
    context.subscriptions
  );
}

// ─── Webview HTML scaffold ───────────────────────────────────────────────────

function getWebviewContent(
  webview: vscode.Webview,
  extensionUri: vscode.Uri,
  data: import('./webview/types').InitialData
): string {
  const nonce = getNonce();
  const scriptUri = webview.asWebviewUri(vscode.Uri.joinPath(extensionUri, 'dist', 'webview.js'));
  const initialDataJson = escapeForScriptTag(JSON.stringify(data));

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8"/>
  <meta name="viewport" content="width=device-width,initial-scale=1"/>
  <meta http-equiv="Content-Security-Policy"
        content="default-src 'none'; script-src 'nonce-${nonce}' ${webview.cspSource}; style-src 'unsafe-inline'; font-src ${webview.cspSource} data:; img-src ${webview.cspSource} data:;"/>
  <style>
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
    html, body, #root { height: 100%; }
    body { background: var(--bg, var(--vscode-editor-background)); color: var(--fg, var(--vscode-editor-foreground)); }

    /* Design tokens — dark theme default */
    :root, [data-theme="dark"] {
      --bg:           #0a0a0b;
      --bg-elevated:  #111113;
      --bg-raised:    #18181b;
      --bg-hover:     rgba(255,255,255,0.06);
      --fg:           #d4d4d8;
      --fg-strong:    #fafafa;
      --fg-muted:     #71717a;
      --fg-subtle:    #52525b;
      --fg-faint:     #3f3f46;
      --border:       rgba(255,255,255,0.08);
      --border-strong:rgba(255,255,255,0.14);
      --accent:       #34d399;
      --accent-strong:#10b981;
      --accent-soft:  rgba(52,211,153,0.12);
      --accent-ring:  rgba(52,211,153,0.35);
      --healthy:      #34d399;
      --warning:      #fbbf24;
      --danger:       #f43f5e;
      --critical:     #f43f5e;
      --info:         #60a5fa;
      --pr:           #a78bfa;
      --bg-input:     rgba(255,255,255,0.04);
      --bg-selected:  rgba(52,211,153,0.10);
      --border-focus: rgba(52,211,153,0.45);
      --row-py:       8px;
      --shadow-toast:    0 8px 24px rgba(0,0,0,0.55);
      --shadow-popover:  0 12px 32px rgba(0,0,0,0.6);
      --shadow-drawer:   -8px 0 32px rgba(0,0,0,0.55);
      --font-sans: ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif;
      --font-mono: ui-monospace, "JetBrains Mono", "SF Mono", Menlo, Consolas, monospace;
    }
    [data-theme="light"] {
      --bg:           #f8f8f8;
      --bg-elevated:  #ffffff;
      --bg-raised:    #f1f1f3;
      --bg-hover:     rgba(0,0,0,0.05);
      --fg:           #27272a;
      --fg-strong:    #09090b;
      --fg-muted:     #71717a;
      --fg-subtle:    #a1a1aa;
      --fg-faint:     #d4d4d8;
      --border:       rgba(0,0,0,0.08);
      --border-strong:rgba(0,0,0,0.14);
      --bg-input:     rgba(0,0,0,0.03);
      --bg-selected:  rgba(16,185,129,0.10);
      --border-focus: rgba(16,185,129,0.45);
      --shadow-toast:    0 4px 16px rgba(0,0,0,0.15);
      --shadow-popover:  0 8px 24px rgba(0,0,0,0.18);
      --shadow-drawer:   -4px 0 16px rgba(0,0,0,0.12);
    }

    body { font-family: var(--font-sans); font-size: 13px; }
    button, input, textarea, select { font-family: inherit; }
    button { cursor: pointer; }

    @keyframes fade-in    { from { opacity: 0 } to { opacity: 1 } }
    @keyframes slide-up   { from { transform: translateY(8px); opacity: 0 } to { transform: none; opacity: 1 } }
    @keyframes slide-in-right { from { transform: translateX(16px); opacity: 0 } to { transform: none; opacity: 1 } }
    @keyframes toast-in   { from { transform: translateX(32px); opacity: 0 } to { transform: none; opacity: 1 } }
  </style>
</head>
<body>
  <div id="root"></div>
  <script nonce="${nonce}">window.INITIAL_DATA=${initialDataJson};</script>
  <script nonce="${nonce}" src="${scriptUri}"></script>
</body>
</html>`;
}


/**
 * Checks review request eligibility and shows dialog if appropriate.
 * @param context - Extension context for state access
 */
async function checkAndShowReviewRequest(context: vscode.ExtensionContext) {
  const hasReviewed = context.globalState.get<boolean>('hasReviewed', false);
  const reviewRequestCount = context.globalState.get<number>('reviewRequestCount', 0);
  const lastReviewRequestDate = context.globalState.get<number>('lastReviewRequestDate', 0);
  const totalBranchesDeleted = context.globalState.get<number>('totalBranchesDeleted', 0);
  const successfulCleanups = context.globalState.get<number>('successfulCleanups', 0);

  if (hasReviewed || reviewRequestCount >= 3) return;

  const daysSinceLastRequest = (Date.now() - lastReviewRequestDate) / (1000 * 60 * 60 * 24);

  const shouldShowReview =
    (reviewRequestCount === 0 && (successfulCleanups >= 5 || totalBranchesDeleted >= 20)) ||
    (reviewRequestCount === 1 && successfulCleanups >= 10 && daysSinceLastRequest > 30) ||
    (reviewRequestCount === 2 && successfulCleanups >= 20 && daysSinceLastRequest > 60);

  if (shouldShowReview) {
    setTimeout(() => void showReviewRequest(context), 2000);
  }
}

/**
 * Shows review request dialog.
 */
async function showReviewRequest(context: vscode.ExtensionContext) {
  const totalDeleted = context.globalState.get<number>('totalBranchesDeleted', 0);

  const result = await vscode.window.showInformationMessage(
    `You've cleaned ${totalDeleted} branches. If this helps, a review helps others find it.`,
    'Leave a Review',
    'Maybe Later',
    "Don't Ask Again"
  );

  const reviewRequestCount = context.globalState.get<number>('reviewRequestCount', 0);

  if (result === 'Leave a Review') {
    const extensionId = 'YonasValentinMougaardKristensen.git-branch-manager-pro';
    void vscode.env.openExternal(vscode.Uri.parse(`https://marketplace.visualstudio.com/items?itemName=${extensionId}&ssr=false#review-details`));
    await context.globalState.update('hasReviewed', true);
  } else if (result === "Don't Ask Again") {
    await context.globalState.update('hasReviewed', true);
  } else {
    await context.globalState.update('reviewRequestCount', reviewRequestCount + 1);
  }

  await context.globalState.update('lastReviewRequestDate', Date.now());
}

/**
 * Increments usage count and shows support message.
 */
async function incrementUsageCount(context: vscode.ExtensionContext) {
  const usageCount = context.globalState.get<number>('usageCount', 0);
  const hasShownSupport = context.globalState.get<boolean>('hasShownSupportMessage', false);
  const lastShownDate = context.globalState.get<number>('lastSupportMessageDate', 0);

  await context.globalState.update('usageCount', usageCount + 1);

  const daysSinceLastShown = (Date.now() - lastShownDate) / (1000 * 60 * 60 * 24);

  if ((usageCount === 10 && !hasShownSupport) || (usageCount > 10 && usageCount % 20 === 0 && daysSinceLastShown > 14)) {
    void showSupportMessage(context);
  }
}

/**
 * Shows support message dialog.
 */
async function showSupportMessage(context: vscode.ExtensionContext) {
  const usageCount = context.globalState.get<number>('usageCount', 0);

  const result = await vscode.window.showInformationMessage(
    `You've used Git Branch Manager ${usageCount} times. Consider sponsoring to support development.`,
    'Sponsor on GitHub',
    'Maybe Later',
    "Don't Show Again"
  );

  if (result === 'Sponsor on GitHub') {
    void vscode.env.openExternal(vscode.Uri.parse('https://github.com/sponsors/YonasValentin'));
    await context.globalState.update('hasShownSupportMessage', true);
  } else if (result === "Don't Show Again") {
    await context.globalState.update('hasShownSupportMessage', true);
  }

  await context.globalState.update('lastSupportMessageDate', Date.now());
}

/**
 * Deactivates the extension.
 * Cleanup is handled automatically via context.subscriptions.
 */
export function deactivate() {}
