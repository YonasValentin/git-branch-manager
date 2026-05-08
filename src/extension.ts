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
import { getNonce, formatAge } from './utils';
import { escapeForScriptTag } from './internals/escapeForScriptTag';
import { mapPR } from './internals/mapPR';
import { buildInitialData } from './internals/buildInitialData';
import { buildWebviewCss } from './internals/buildWebviewCss';
import { createSafePost } from './internals/safePost';
import { dispatchWebviewMessage, type WebviewMessageDeps } from './internals/dispatchWebviewMessage';

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
    localResourceRoots: [
      vscode.Uri.joinPath(context.extensionUri, 'dist'),
      vscode.Uri.joinPath(context.extensionUri, 'media'),
    ],
  });

  // Track disposal so async tasks (PR fetch, comparisons) don't postMessage after close.
  const disposalState = { disposed: false };
  panel.onDidDispose(() => { disposalState.disposed = true; }, undefined, context.subscriptions);
  const safePost = createSafePost(
    (msg) => { void panel.webview.postMessage(msg); },
    disposalState,
  );

  async function updateWebview() {
    const persistedTheme = context.workspaceState.get<'dark' | 'light'>('theme', 'dark');
    const repo = await repoContext.getActiveRepository();
    if (!repo) {
      panel.title = 'Git Branch Manager';
      panel.webview.html = getWebviewContent(panel.webview, context.extensionUri, {
        ...buildInitialData([], [], [], [], [], [], new Map(), '', 'main', '', 30),
        theme: persistedTheme,
      });
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
      {
        ...buildInitialData(branches, remoteBranches, worktrees, stashes, cleanupRulesArray, recoveryLog, branchNotes, currentBranch ?? '', baseBranch, repo.name, daysUntilStale),
        theme: persistedTheme,
      }
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

  panel.webview.onDidReceiveMessage(
    async (message: unknown) => {
      // Don't gate the dispatcher on having an active repo — ambient commands
      // (openSponsor/openSupport/openGithub/setTheme/switchRepository) work
      // regardless. Repo-required handlers fail gracefully with empty gitRoot.
      const repo = await repoContext.getActiveRepository();
      const gitRoot = repo?.path ?? '';

      const deps: WebviewMessageDeps = {
        context,
        gitRoot,
        ui: {
          showInfo: (msg) => { void vscode.window.showInformationMessage(msg); },
          showWarning: (msg) => { void vscode.window.showWarningMessage(msg); },
          showError: (msg) => { void vscode.window.showErrorMessage(msg); },
          showInputBox: (opts) => vscode.window.showInputBox(opts),
          showWarningModal: (msg, ...items) => vscode.window.showWarningMessage(msg, { modal: true }, ...items),
          showInfoModal: (msg, ...items) => vscode.window.showInformationMessage(msg, { modal: true }, ...items),
        },
        env: {
          openExternal: (uri) => vscode.env.openExternal(vscode.Uri.parse(uri)),
          executeCommand: <T,>(cmd: string, ...args: unknown[]) => vscode.commands.executeCommand<T>(cmd, ...args),
          clipboardRead: () => vscode.env.clipboard.readText(),
          clipboardWrite: (text) => Promise.resolve(vscode.env.clipboard.writeText(text)).then(() => undefined),
        },
        git: {
          deleteBranchForce,
          checkout: (cwd, name) => gitCommand(['checkout', name], cwd).then(() => undefined),
          rename: renameBranch,
          compare: compareBranches,
          timeline: getBranchTimeline,
          branchInfo: getBranchInfo,
          createStash,
          applyStash,
          popStash,
          dropStash,
          clearStashes,
        },
        storage: {
          saveBranchNote,
          getCleanupRules,
          saveCleanupRules,
          evaluateCleanupRule,
          removeRecoveryEntry,
          restoreFromLog,
        },
        hooks: {
          createBranchFromTemplate: () => createBranchFromTemplate(repoContext),
          createWorktreeFromBranch: () => createWorktreeFromBranch(repoContext),
          getGitHubToken: getGitHubAccessToken,
          recordBranchDeleted: async (count) => {
            if (count <= 0) return;
            const totalDeleted = context.globalState.get<number>('totalBranchesDeleted', 0);
            await context.globalState.update('totalBranchesDeleted', totalDeleted + count);
            await checkAndShowReviewRequest(context);
          },
          selectRepository: () => repoContext.selectRepository(),
          setActiveRepository: (path) => repoContext.setActiveRepository(path),
          discoverRepositories: () => repoContext.discoverRepositories(),
          getRepositoriesCount: () => repoContext.getRepositories().length,
          branchTreeRefresh: () => branchTreeProvider.scheduleRefresh(),
          openDiff: async (branchA, branchB, filePath, root) => {
            const paths = filePath.split('\t');
            const fileInB = paths[0] ?? filePath;
            const fileInA = paths.length > 1 ? (paths[1] ?? fileInB) : fileInB;
            const leftParams = `branch=${encodeURIComponent(branchB)}&file=${encodeURIComponent(fileInB)}&repo=${encodeURIComponent(root)}`;
            const rightParams = `branch=${encodeURIComponent(branchA)}&file=${encodeURIComponent(fileInA)}&repo=${encodeURIComponent(root)}`;
            const leftUri = vscode.Uri.parse(`${GIT_DIFF_SCHEME}:${encodeURIComponent(fileInB)}?${leftParams}`);
            const rightUri = vscode.Uri.parse(`${GIT_DIFF_SCHEME}:${encodeURIComponent(fileInA)}?${rightParams}`);
            const displayFile = paths.length > 1 ? `${fileInB} \u2192 ${fileInA}` : fileInA;
            await vscode.commands.executeCommand(
              'vscode.diff',
              leftUri,
              rightUri,
              `${displayFile} (${branchB} \u2194 ${branchA})`,
            );
          },
        },
        post: safePost,
        updateWebview,
        updateStatusBar: updateGlobalStatusBar,
      };

      await dispatchWebviewMessage(message, deps);
    },
    undefined,
    context.subscriptions,
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

  // `asWebviewUri` returns one URI per file, so we resolve each filename through it.
  const fontUri = (filename: string) =>
    webview.asWebviewUri(vscode.Uri.joinPath(extensionUri, 'media', 'fonts', filename)).toString();

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8"/>
  <meta name="viewport" content="width=device-width,initial-scale=1"/>
  <meta http-equiv="Content-Security-Policy"
        content="default-src 'none'; script-src 'nonce-${nonce}' ${webview.cspSource}; style-src 'unsafe-inline'; font-src ${webview.cspSource} data:; img-src ${webview.cspSource} data:;"/>
  <style>${buildWebviewCss(fontUri)}</style>
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
