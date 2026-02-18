import * as vscode from 'vscode';

// Types
import {
  BranchInfo,
  PRStatus,
  RemoteBranchInfo,
  WorktreeInfo,
  StashInfo,
  BranchNote,
  CleanupRule,
  DeletedBranchEntry,
} from './types';

// Services
import { RepositoryContextManager, BranchTreeProvider, BranchItem, StatusGroupItem, GoneDetector, AutoCleanupEvaluator, DiffContentProvider, GIT_DIFF_SCHEME } from './services';

// Utilities
import { getNonce, formatAge, escapeHtml, getHealthColor, validateRegexPattern } from './utils';

// Git operations
import {
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

let gitHubSession: vscode.AuthenticationSession | undefined;

/**
 * Activates the extension.
 * @param context - Extension context for subscriptions and state
 */
export async function activate(context: vscode.ExtensionContext) {
  incrementUsageCount(context);

  const repoContext = new RepositoryContextManager(context);
  await repoContext.discoverRepositories();
  context.subscriptions.push(repoContext);

  // PAT secret storage keys
  const GITLAB_TOKEN_KEY = 'gitBranchManager.gitlabToken';
  const AZURE_TOKEN_KEY = 'gitBranchManager.azureToken';

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

  // File watchers for auto-refresh (TREE-05)
  for (const repo of repoContext.getRepositories()) {
    const refsPattern = new vscode.RelativePattern(repo.path, '.git/refs/heads/**');
    const headPattern = new vscode.RelativePattern(repo.path, '.git/HEAD');
    const packedPattern = new vscode.RelativePattern(repo.path, '.git/packed-refs');

    const refsWatcher = vscode.workspace.createFileSystemWatcher(refsPattern);
    const headWatcher = vscode.workspace.createFileSystemWatcher(headPattern);
    const packedWatcher = vscode.workspace.createFileSystemWatcher(packedPattern);

    const scheduleRefresh = () => branchTreeProvider.scheduleRefresh();

    context.subscriptions.push(
      refsWatcher.onDidCreate(scheduleRefresh),
      refsWatcher.onDidDelete(scheduleRefresh),
      refsWatcher.onDidChange(scheduleRefresh),
      headWatcher.onDidChange(scheduleRefresh),
      packedWatcher.onDidChange(scheduleRefresh),
      refsWatcher, headWatcher, packedWatcher
    );
  }

  // Gone branch auto-detection (GONE-01, GONE-02, GONE-03, GONE-04)
  const goneDetector = new GoneDetector(repoContext, branchTreeProvider, context);
  await goneDetector.initialize();
  context.subscriptions.push(goneDetector);

  // Auto-cleanup evaluator (AUTO-01 to AUTO-05)
  const autoCleanupEvaluator = new AutoCleanupEvaluator(repoContext, branchTreeProvider, context);
  context.subscriptions.push(autoCleanupEvaluator);

  for (const repo of repoContext.getRepositories()) {
    const fetchHeadPattern = new vscode.RelativePattern(repo.path, '.git/FETCH_HEAD');
    const fetchHeadWatcher = vscode.workspace.createFileSystemWatcher(fetchHeadPattern);

    context.subscriptions.push(
      fetchHeadWatcher.onDidChange(() => {
        goneDetector.onFetchCompleted(repo.path);
        autoCleanupEvaluator.onEventTriggered(repo.path);
      }),
      fetchHeadWatcher.onDidCreate(() => {
        goneDetector.onFetchCompleted(repo.path);
        autoCleanupEvaluator.onEventTriggered(repo.path);
      }),
      fetchHeadWatcher
    );
  }

  // ORIG_HEAD watcher for merge events (AUTO-01)
  for (const repo of repoContext.getRepositories()) {
    const origHeadPattern = new vscode.RelativePattern(repo.path, '.git/ORIG_HEAD');
    const origHeadWatcher = vscode.workspace.createFileSystemWatcher(origHeadPattern);

    context.subscriptions.push(
      origHeadWatcher.onDidCreate(() => autoCleanupEvaluator.onEventTriggered(repo.path)),
      origHeadWatcher
    );
  }

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
        gitHubSession = await vscode.authentication.getSession('github', ['repo'], { createIfNone: true });
        if (gitHubSession) { vscode.window.showInformationMessage('Connected to GitHub'); }
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
    localResourceRoots: [],
  });

  // Clean up when the panel is disposed (closed by user)
  panel.onDidDispose(() => {}, undefined, context.subscriptions);

  async function updateWebview() {
    const repo = await repoContext.getActiveRepository();
    if (!repo) {
      panel.webview.html = getWebviewContent(panel.webview, [], [], [], [], {}, {}, 30, 60, null, '', {}, []);
      return;
    }
    const gitRoot = repo.path;

    const config = vscode.workspace.getConfiguration('gitBranchManager');
    const daysUntilStale = config.get<number>('daysUntilStale', 30);
    const daysUntilOld = config.get<number>('daysUntilOld', 60);

    const [branches, remoteBranches, worktrees, stashes, currentBranch, baseBranch, allBranchNames] = await Promise.all([
      getBranchInfo(gitRoot),
      getRemoteBranchInfo(gitRoot),
      getWorktreeInfo(gitRoot),
      getStashInfo(gitRoot),
      getCurrentBranch(gitRoot),
      getBaseBranch(gitRoot),
      getAllBranchNames(gitRoot),
    ]);

    // Platform-aware PR fetching (PLAT-01, PLAT-02, PLAT-03, PLAT-05)
    const platformInfo = await detectPlatform(gitRoot);
    let prMap = new Map<string, PRStatus>();
    const branchNames = branches.map(b => b.name);

    if (platformInfo.platform === 'github') {
      const token = gitHubSession?.accessToken;
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

    // Apply PR status to branches for webview rendering
    for (const branch of branches) {
      const pr = prMap.get(branch.name);
      if (pr) { branch.prStatus = pr; }
    }

    // Push PR data to tree view as well
    branchTreeProvider.setPRStatuses(prMap);
    branchTreeProvider.scheduleRefresh();

    const branchNotesMap = getBranchNotes(context, gitRoot);
    const branchNotes: Record<string, BranchNote> = Object.fromEntries(branchNotesMap);
    const cleanupRulesArray = getCleanupRules(context, gitRoot);
    const cleanupRules: Record<string, CleanupRule> = Object.fromEntries(
      cleanupRulesArray.map(rule => [rule.id, rule])
    );
    const recoveryLog = getRecoveryLog(context, gitRoot);

    panel.webview.html = getWebviewContent(
      panel.webview,
      branches,
      remoteBranches,
      worktrees,
      stashes,
      branchNotes,
      cleanupRules,
      daysUntilStale,
      daysUntilOld,
      currentBranch,
      baseBranch,
      {},
      recoveryLog,
      allBranchNames
    );
  }

  await updateWebview();

  panel.webview.onDidReceiveMessage(
    async (message) => {
      const repo = await repoContext.getActiveRepository();
      if (!repo) return;
      const gitRoot = repo.path;

      switch (message.command) {
        case 'delete':
          try {
            await deleteBranchForce(gitRoot, message.branch);
            vscode.window.showInformationMessage(`Deleted branch: ${message.branch}`);

            const totalDeleted = context.globalState.get<number>('totalBranchesDeleted', 0);
            context.globalState.update('totalBranchesDeleted', totalDeleted + 1);
            await checkAndShowReviewRequest(context);

            await updateWebview();
            await updateGlobalStatusBar();
          } catch (error) {
            vscode.window.showErrorMessage(`Failed to delete branch: ${error}`);
          }
          break;

        case 'deleteMultiple':
          const branchesToDelete = message.branches as string[];
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
          context.globalState.update('totalBranchesDeleted', totalDeleted + results.success.length);

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
            await switchBranch(gitRoot, message.branch);
            vscode.window.showInformationMessage(`Switched to branch: ${message.branch}`);
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
            await applyStash(gitRoot, message.index);
            vscode.window.showInformationMessage(`Applied stash ${message.index}`);
            await updateWebview();
          } catch (error) {
            vscode.window.showErrorMessage(`Failed to apply stash: ${error}`);
          }
          break;

        case 'popStash':
          try {
            await popStash(gitRoot, message.index);
            vscode.window.showInformationMessage(`Popped stash ${message.index}`);
            await updateWebview();
          } catch (error) {
            vscode.window.showErrorMessage(`Failed to pop stash: ${error}`);
          }
          break;

        case 'dropStash':
          try {
            await dropStash(gitRoot, message.index);
            vscode.window.showInformationMessage(`Dropped stash ${message.index}`);
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
            const comparison = await compareBranches(gitRoot, message.branch1, message.branch2);
            panel.webview.postMessage({ command: 'comparisonResult', data: comparison });
          } catch (error) {
            vscode.window.showErrorMessage(`Failed to compare branches: ${error}`);
          }
          break;

        case 'getTimeline':
          try {
            const timeline = await getBranchTimeline(gitRoot, message.branchName, 5);
            panel.webview.postMessage({ command: 'timelineResult', data: { branchName: message.branchName, commits: timeline } });
          } catch {
            // Silent failure — timeline is supplementary
          }
          break;

        case 'renameBranch':
          try {
            const newName = await vscode.window.showInputBox({
              prompt: 'New branch name',
              value: message.oldName,
              validateInput: (value) => {
                if (!value) return 'Branch name cannot be empty';
                if (value === message.oldName) return 'New name must be different';
                return null;
              },
            });

            if (newName) {
              await renameBranch(gitRoot, message.oldName, newName);
              vscode.window.showInformationMessage(`Renamed ${message.oldName} to ${newName}`);
              await updateWebview();
              await updateGlobalStatusBar();
            }
          } catch (error) {
            vscode.window.showErrorMessage(`Failed to rename branch: ${error}`);
          }
          break;

        case 'batchRename':
          try {
            const pattern = message.pattern;
            const replacement = message.replacement;
            const branchesToRename = message.branches as string[];

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
              for (const rename of renames) {
                try {
                  await renameBranch(gitRoot, rename.old, rename.new);
                  successCount++;
                } catch (error) {
                  vscode.window.showErrorMessage(`Failed to rename ${rename.old}: ${error}`);
                }
              }

              if (successCount > 0) {
                vscode.window.showInformationMessage(`Renamed ${successCount} branches`);
                await updateWebview();
                await updateGlobalStatusBar();
              }
            }
          } catch (error) {
            vscode.window.showErrorMessage(`Batch rename failed: ${error}`);
          }
          break;

        case 'deleteRemote':
          try {
            const fullName = `${message.remote}/${message.branch}`;
            await deleteBranchForce(gitRoot, fullName);
            vscode.window.showInformationMessage(`Deleted remote branch: ${fullName}`);
            await updateWebview();
          } catch (error) {
            vscode.window.showErrorMessage(`Failed to delete remote branch: ${error}`);
          }
          break;

        case 'deleteMultipleRemotes':
          const remoteBranches = message.branches as Array<{ remote: string; name: string }>;
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

        case 'saveBranchNote':
          await saveBranchNote(context, gitRoot, message.branch, message.note);
          await updateWebview();
          break;

        case 'saveCleanupRules':
          await saveCleanupRules(context, gitRoot, message.rules);
          await updateWebview();
          break;

        case 'evaluateRule':
          const rule = message.rule as CleanupRule;
          const allBranches = await getBranchInfo(gitRoot);
          const matchingBranches = evaluateCleanupRule(allBranches, rule);

          panel.webview.postMessage({
            command: 'ruleEvaluationResult',
            matches: matchingBranches.map((b) => b.name),
          });
          break;

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
            gitHubSession = await vscode.authentication.getSession('github', ['repo'], { createIfNone: true });
            if (gitHubSession) {
              vscode.window.showInformationMessage('Connected to GitHub');
              await updateWebview();
            }
          } catch (error) {
            vscode.window.showErrorMessage(`Failed to connect to GitHub: ${error}`);
          }
          break;

        case 'refresh':
          await updateWebview();
          break;

        case 'restoreBranch': {
          const { branchName, commitHash } = message;
          const result = await restoreFromLog(context, gitRoot, branchName, commitHash);
          if (!result.success) {
            vscode.window.showErrorMessage(`Failed to restore: ${result.error}`);
          }
          await updateWebview();
          await updateGlobalStatusBar();
          break;
        }

        case 'clearRecoveryEntry': {
          const { branchName, commitHash } = message;
          await removeRecoveryEntry(context, gitRoot, branchName, commitHash);
          await updateWebview();
          break;
        }

        case 'openDiff': {
          const { branchA, branchB, filePath } = message;
          // Handle renamed files (R status): path is "oldPath\tnewPath"
          const paths = (filePath as string).split('\t');
          const fileInA = paths.length > 1 ? paths[1] : paths[0]; // new path in branchA
          const fileInB = paths[0]; // old path in branchB

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

/**
 * Generates HTML content for the webview.
 * @param webview - The webview instance
 * @param branches - Local branches
 * @param remoteBranches - Remote branches
 * @param worktrees - Git worktrees
 * @param stashes - Git stashes
 * @param branchNotes - Saved branch notes
 * @param cleanupRules - Cleanup automation rules
 * @param daysUntilStale - Days before branch is stale
 * @param daysUntilOld - Days before branch is old
 * @param currentBranch - Currently checked out branch
 * @param baseBranch - Base branch for comparisons
 * @param githubPRs - GitHub pull requests by branch
 * @param recoveryLog - Deleted branches available for recovery
 * @returns HTML string for webview
 */
function getWebviewContent(
  webview: vscode.Webview,
  branches: BranchInfo[],
  remoteBranches: RemoteBranchInfo[],
  worktrees: WorktreeInfo[],
  stashes: StashInfo[],
  branchNotes: Record<string, BranchNote>,
  cleanupRules: Record<string, CleanupRule>,
  daysUntilStale: number,
  _daysUntilOld: number,
  currentBranch: string | null,
  _baseBranch: string,
  _githubPRs: Record<string, PRStatus>,
  recoveryLog: DeletedBranchEntry[],
  allBranchNames: string[] = []
): string {
  const nonce = getNonce();

  const mergedBranches = branches.filter((b) => b.isMerged && !b.isCurrentBranch);
  const staleBranches = branches.filter((b) => !b.isMerged && b.daysOld > daysUntilStale && !b.isCurrentBranch);
  const goneBranches = branches.filter((b) => b.remoteGone && !b.isCurrentBranch);
  const activeBranches = branches.filter((b) => !b.isMerged && b.daysOld <= daysUntilStale && !b.remoteGone);

  const allBranches = [...mergedBranches, ...staleBranches, ...goneBranches, ...activeBranches];

  function renderBranchRow(branch: BranchInfo): string {
    const healthColor = getHealthColor(branch.healthStatus || 'healthy');
    const note = branchNotes[branch.name];
    const noteHtml = note ? `<div class="branch-note" title="${escapeHtml(note.note)}">📝 ${escapeHtml(note.note)}</div>` : '';

    const prInfo =
      branch.prStatus
        ? `<a href="${escapeHtml(branch.prStatus.url)}" class="pr-link" title="${escapeHtml(branch.prStatus.title)}">#${branch.prStatus.number} (${escapeHtml(branch.prStatus.state)})</a>`
        : '';

    const remoteInfo = branch.hasRemote ? (branch.remoteGone ? '<span class="remote-gone">🔴 Gone</span>' : '🌐') : '';

    const aheadBehindInfo =
      branch.ahead !== undefined && branch.behind !== undefined
        ? `<span class="ahead-behind" title="Ahead: ${branch.ahead}, Behind: ${branch.behind}">↑${branch.ahead} ↓${branch.behind}</span>`
        : '';

    return `
      <tr data-branch="${escapeHtml(branch.name)}" class="${branch.isCurrentBranch ? 'current-branch' : ''}">
        <td><input type="checkbox" class="branch-checkbox" data-branch="${escapeHtml(branch.name)}" ${branch.isCurrentBranch ? 'disabled' : ''}/></td>
        <td>
          <div class="branch-name">${escapeHtml(branch.name)}</div>
          ${noteHtml}
        </td>
        <td><span class="health-indicator" style="background-color: ${healthColor};" title="${escapeHtml(branch.healthReason || '')}"></span></td>
        <td>${formatAge(branch.daysOld)}</td>
        <td>${branch.isMerged ? '✓' : ''}</td>
        <td>${escapeHtml(branch.author || '')}</td>
        <td>${remoteInfo} ${prInfo} ${aheadBehindInfo}</td>
        <td>
          <button class="action-btn" data-action="deleteBranch" data-branch="${escapeHtml(branch.name)}" ${branch.isCurrentBranch ? 'disabled' : ''}>Delete</button>
          <button class="action-btn" data-action="switchTo" data-branch="${escapeHtml(branch.name)}" ${branch.isCurrentBranch ? 'disabled' : ''}>Switch</button>
          <button class="action-btn" data-action="addNote" data-branch="${escapeHtml(branch.name)}">Note</button>
        </td>
      </tr>
    `;
  }

  function renderRemoteBranchRow(branch: RemoteBranchInfo): string {
    return `
      <tr data-remote-branch="${escapeHtml(branch.remote)}/${escapeHtml(branch.name)}">
        <td><input type="checkbox" class="remote-branch-checkbox" data-remote="${escapeHtml(branch.remote)}" data-branch="${escapeHtml(branch.name)}"/></td>
        <td>${escapeHtml(branch.remote)}/${escapeHtml(branch.name)}</td>
        <td>${branch.daysOld ? formatAge(branch.daysOld) : 'Unknown'}</td>
        <td>${branch.isMerged ? '✓' : ''}</td>
        <td>${branch.isGone ? '🔴 Gone' : ''}</td>
        <td>${escapeHtml(branch.localBranch || '')}</td>
        <td>
          <button class="action-btn" data-action="deleteRemoteBranch" data-remote="${escapeHtml(branch.remote)}" data-branch="${escapeHtml(branch.name)}">Delete</button>
        </td>
      </tr>
    `;
  }

  function renderWorktreeRow(worktree: WorktreeInfo): string {
    return `
      <tr>
        <td>${escapeHtml(worktree.path)}</td>
        <td>${escapeHtml(worktree.branch)}</td>
        <td>${worktree.isMainWorktree ? '✓' : ''}</td>
        <td>${worktree.isLocked ? '🔒' : ''}</td>
        <td>${worktree.prunable ? '⚠️' : ''}</td>
      </tr>
    `;
  }

  function renderStashRow(stash: StashInfo): string {
    const fileList =
      stash.files && stash.files.length > 0 ? `<div class="stash-files">${stash.files.slice(0, 5).map((f) => escapeHtml(f)).join(', ')}</div>` : '';

    return `
      <tr>
        <td>${stash.index}</td>
        <td>
          <div class="stash-message">${escapeHtml(stash.message)}</div>
          ${fileList}
        </td>
        <td>${escapeHtml(stash.branch)}</td>
        <td>${formatAge(stash.daysOld)}</td>
        <td>${stash.filesChanged || 0}</td>
        <td>
          <button class="action-btn" data-action="applyStash" data-index="${stash.index}">Apply</button>
          <button class="action-btn" data-action="popStash" data-index="${stash.index}">Pop</button>
          <button class="action-btn" data-action="dropStash" data-index="${stash.index}">Drop</button>
        </td>
      </tr>
    `;
  }

  function renderRecoveryRow(entry: DeletedBranchEntry): string {
    const timeAgo = formatRecoveryTime(entry.deletedAt);
    return `
      <tr data-recovery="${escapeHtml(entry.branchName)}">
        <td>
          <div class="branch-name">${escapeHtml(entry.branchName)}</div>
        </td>
        <td>${timeAgo}</td>
        <td><code>${escapeHtml(entry.commitHash.substring(0, 7))}</code></td>
        <td>
          <button class="action-btn" data-action="restoreBranch" data-branch="${escapeHtml(entry.branchName)}" data-hash="${escapeHtml(entry.commitHash)}">Restore</button>
          <button class="action-btn" data-action="dismissRecoveryEntry" data-branch="${escapeHtml(entry.branchName)}" data-hash="${escapeHtml(entry.commitHash)}">Dismiss</button>
        </td>
      </tr>
    `;
  }

  function formatRecoveryTime(timestamp: number): string {
    const seconds = Math.floor((Date.now() - timestamp) / 1000);
    if (seconds < 60) return 'just now';
    const minutes = Math.floor(seconds / 60);
    if (minutes < 60) return `${minutes}m ago`;
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `${hours}h ago`;
    const days = Math.floor(hours / 24);
    return `${days}d ago`;
  }

  const branchRows = allBranches.map(renderBranchRow).join('');
  const remoteBranchRows = remoteBranches.map(renderRemoteBranchRow).join('');
  const worktreeRows = worktrees.map(renderWorktreeRow).join('');
  const stashRows = stashes.map(renderStashRow).join('');
  const recoveryRows = recoveryLog.map(renderRecoveryRow).join('');

  const cleanupRulesArray = Object.entries(cleanupRules).map(([_id, rule]) => rule);
  const rulesJson = JSON.stringify(cleanupRulesArray).replace(/</g, '\\u003c');

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource} 'nonce-${nonce}'; script-src 'nonce-${nonce}'; frame-ancestors 'none';">
  <title>Git Branch Manager</title>
  <style nonce="${nonce}">
    * {
      box-sizing: border-box;
      margin: 0;
      padding: 0;
    }

    body {
      font-family: var(--vscode-font-family);
      font-size: var(--vscode-font-size);
      color: var(--vscode-foreground);
      background-color: var(--vscode-editor-background);
      padding: 20px;
    }

    h1, h2, h3 {
      margin-bottom: 16px;
      font-weight: 600;
    }

    .header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 24px;
      padding-bottom: 16px;
      border-bottom: 1px solid var(--vscode-panel-border);
    }

    .header-actions {
      display: flex;
      gap: 8px;
    }

    .stats {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
      gap: 16px;
      margin-bottom: 24px;
    }

    .stat-card {
      padding: 16px;
      background: var(--vscode-editor-inactiveSelectionBackground);
      border-radius: 4px;
      border: 1px solid var(--vscode-panel-border);
    }

    .stat-value {
      font-size: 24px;
      font-weight: 600;
      margin-bottom: 4px;
    }

    .stat-label {
      font-size: 12px;
      opacity: 0.8;
    }

    .tabs {
      display: flex;
      gap: 4px;
      margin-bottom: 16px;
      border-bottom: 1px solid var(--vscode-panel-border);
    }

    .tab {
      padding: 8px 16px;
      background: transparent;
      border: none;
      color: var(--vscode-foreground);
      cursor: pointer;
      border-bottom: 2px solid transparent;
      font-size: 14px;
    }

    .tab:hover {
      background: var(--vscode-list-hoverBackground);
    }

    .tab.active {
      border-bottom-color: var(--vscode-focusBorder);
    }

    .tab-content {
      display: none;
    }

    .tab-content.active {
      display: block;
    }

    .toolbar {
      display: flex;
      gap: 8px;
      margin-bottom: 16px;
      flex-wrap: wrap;
    }

    .btn {
      padding: 6px 12px;
      background: var(--vscode-button-background);
      color: var(--vscode-button-foreground);
      border: none;
      border-radius: 2px;
      cursor: pointer;
      font-size: 13px;
    }

    .btn:hover {
      background: var(--vscode-button-hoverBackground);
    }

    .btn:disabled {
      opacity: 0.5;
      cursor: not-allowed;
    }

    .btn-secondary {
      background: var(--vscode-button-secondaryBackground);
      color: var(--vscode-button-secondaryForeground);
    }

    .btn-secondary:hover {
      background: var(--vscode-button-secondaryHoverBackground);
    }

    .action-btn {
      padding: 4px 8px;
      background: var(--vscode-button-secondaryBackground);
      color: var(--vscode-button-secondaryForeground);
      border: none;
      border-radius: 2px;
      cursor: pointer;
      font-size: 12px;
      margin-right: 4px;
    }

    .action-btn:hover {
      background: var(--vscode-button-secondaryHoverBackground);
    }

    .action-btn:disabled {
      opacity: 0.5;
      cursor: not-allowed;
    }

    table {
      width: 100%;
      border-collapse: collapse;
      margin-bottom: 16px;
    }

    th {
      text-align: left;
      padding: 8px;
      background: var(--vscode-editor-inactiveSelectionBackground);
      border-bottom: 1px solid var(--vscode-panel-border);
      font-weight: 600;
      font-size: 12px;
    }

    td {
      padding: 8px;
      border-bottom: 1px solid var(--vscode-panel-border);
      font-size: 13px;
    }

    tr:hover {
      background: var(--vscode-list-hoverBackground);
    }

    .current-branch {
      background: var(--vscode-list-inactiveSelectionBackground);
    }

    .health-indicator {
      display: inline-block;
      width: 12px;
      height: 12px;
      border-radius: 50%;
    }

    .branch-name {
      font-weight: 500;
    }

    .branch-note {
      font-size: 11px;
      color: var(--vscode-descriptionForeground);
      margin-top: 2px;
      font-style: italic;
    }

    .pr-link {
      color: var(--vscode-textLink-foreground);
      text-decoration: none;
      font-size: 12px;
    }

    .pr-link:hover {
      text-decoration: underline;
    }

    .remote-gone {
      color: var(--vscode-errorForeground);
      font-size: 12px;
    }

    .ahead-behind {
      font-size: 11px;
      color: var(--vscode-descriptionForeground);
    }

    .stash-message {
      font-weight: 500;
    }

    .stash-files {
      font-size: 11px;
      color: var(--vscode-descriptionForeground);
      margin-top: 2px;
    }

    .filter-section {
      margin-bottom: 16px;
      padding: 12px;
      background: var(--vscode-editor-inactiveSelectionBackground);
      border-radius: 4px;
    }

    .filter-row {
      display: flex;
      gap: 8px;
      align-items: center;
      margin-bottom: 8px;
    }

    .filter-row:last-child {
      margin-bottom: 0;
    }

    input[type="text"],
    input[type="number"],
    select {
      padding: 4px 8px;
      background: var(--vscode-input-background);
      color: var(--vscode-input-foreground);
      border: 1px solid var(--vscode-input-border);
      border-radius: 2px;
      font-size: 13px;
    }

    input[type="checkbox"] {
      cursor: pointer;
    }

    .tools-section {
      margin-bottom: 24px;
    }

    .tool-card {
      padding: 16px;
      background: var(--vscode-editor-inactiveSelectionBackground);
      border: 1px solid var(--vscode-panel-border);
      border-radius: 4px;
      margin-bottom: 16px;
    }

    .tool-card h3 {
      margin-bottom: 12px;
    }

    .rule-item {
      padding: 12px;
      background: var(--vscode-editor-background);
      border: 1px solid var(--vscode-panel-border);
      border-radius: 4px;
      margin-bottom: 8px;
    }

    .rule-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 8px;
    }

    .rule-name {
      font-weight: 600;
    }

    .rule-conditions {
      font-size: 12px;
      color: var(--vscode-descriptionForeground);
    }

    .empty-state {
      text-align: center;
      padding: 48px;
      color: var(--vscode-descriptionForeground);
    }

    .batch-rename-form {
      display: flex;
      gap: 8px;
      align-items: center;
      margin-bottom: 12px;
    }

    .batch-rename-form input {
      flex: 1;
    }

    .comparison-section { margin: 12px 0; }
    .comparison-section h3 { margin-bottom: 8px; }
    .commit-row { padding: 4px 0; font-size: 12px; }
    .commit-hash { font-family: monospace; opacity: 0.8; }
    .file-change-row { display: flex; align-items: center; gap: 8px; padding: 4px 0; }
    .status-badge { display: inline-block; width: 20px; text-align: center; font-weight: bold; font-size: 11px; border-radius: 3px; padding: 1px 4px; }
    .status-a { background: var(--vscode-gitDecoration-addedResourceForeground, #2ea043); color: #fff; }
    .status-m { background: var(--vscode-gitDecoration-modifiedResourceForeground, #d29922); color: #fff; }
    .status-d { background: var(--vscode-gitDecoration-deletedResourceForeground, #f85149); color: #fff; }
    .status-r { background: var(--vscode-gitDecoration-renamedResourceForeground, #58a6ff); color: #fff; }
    .file-path { font-family: monospace; font-size: 12px; }
  </style>
</head>
<body>
  <div class="header">
    <h1>🌿 Git Branch Manager</h1>
    <div class="header-actions">
      <button class="btn" data-action="refresh">↻ Refresh</button>
      <button class="btn btn-secondary" data-action="connectGitHub">Connect GitHub</button>
    </div>
  </div>

  <div class="stats">
    <div class="stat-card">
      <div class="stat-value">${branches.length}</div>
      <div class="stat-label">Total Branches</div>
    </div>
    <div class="stat-card">
      <div class="stat-value">${mergedBranches.length}</div>
      <div class="stat-label">Merged</div>
    </div>
    <div class="stat-card">
      <div class="stat-value">${staleBranches.length}</div>
      <div class="stat-label">Stale (&gt;${daysUntilStale}d)</div>
    </div>
    <div class="stat-card">
      <div class="stat-value">${goneBranches.length}</div>
      <div class="stat-label">Remote Gone</div>
    </div>
  </div>

  <div class="tabs">
    <button class="tab active" data-action="showTab" data-tab="branches">Branches</button>
    <button class="tab" data-action="showTab" data-tab="remotes">Remote Branches</button>
    <button class="tab" data-action="showTab" data-tab="worktrees">Worktrees</button>
    <button class="tab" data-action="showTab" data-tab="stashes">Stashes</button>
    <button class="tab" data-action="showTab" data-tab="recovery">Recovery${recoveryLog.length > 0 ? ` (${recoveryLog.length})` : ''}</button>
    <button class="tab" data-action="showTab" data-tab="tools">Tools</button>
    <button class="tab" data-action="showTab" data-tab="compare">Compare</button>
  </div>

  <div id="branches-tab" class="tab-content active">
    <div class="toolbar">
      <button class="btn" data-action="deleteSelected">Delete Selected</button>
      <button class="btn btn-secondary" data-action="selectMerged">Select Merged</button>
      <button class="btn btn-secondary" data-action="selectStale">Select Stale</button>
      <button class="btn btn-secondary" data-action="selectGone">Select Gone</button>
      <button class="btn btn-secondary" data-action="clearSelection">Clear</button>
    </div>

    ${
      branches.length === 0
        ? '<div class="empty-state">No branches found</div>'
        : `
    <table>
      <thead>
        <tr>
          <th><input type="checkbox" id="select-all" data-action="toggleSelectAll"/></th>
          <th>Branch</th>
          <th>Health</th>
          <th>Age</th>
          <th>Merged</th>
          <th>Author</th>
          <th>Info</th>
          <th>Actions</th>
        </tr>
      </thead>
      <tbody>
        ${branchRows}
      </tbody>
    </table>
    `
    }
  </div>

  <div id="remotes-tab" class="tab-content">
    <div class="toolbar">
      <button class="btn" data-action="deleteSelectedRemotes">Delete Selected</button>
      <button class="btn btn-secondary" data-action="selectMergedRemotes">Select Merged</button>
      <button class="btn btn-secondary" data-action="selectGoneRemotes">Select Gone</button>
      <button class="btn btn-secondary" data-action="clearRemoteSelection">Clear</button>
    </div>

    ${
      remoteBranches.length === 0
        ? '<div class="empty-state">No remote branches found</div>'
        : `
    <table>
      <thead>
        <tr>
          <th><input type="checkbox" id="select-all-remotes" data-action="toggleSelectAllRemotes"/></th>
          <th>Branch</th>
          <th>Age</th>
          <th>Merged</th>
          <th>Status</th>
          <th>Local Branch</th>
          <th>Actions</th>
        </tr>
      </thead>
      <tbody>
        ${remoteBranchRows}
      </tbody>
    </table>
    `
    }
  </div>

  <div id="worktrees-tab" class="tab-content">
    <div class="toolbar">
      <button class="btn" data-action="createWorktree">Create Worktree</button>
    </div>

    ${
      worktrees.length === 0
        ? '<div class="empty-state">No worktrees found</div>'
        : `
    <table>
      <thead>
        <tr>
          <th>Path</th>
          <th>Branch</th>
          <th>Main</th>
          <th>Locked</th>
          <th>Prunable</th>
        </tr>
      </thead>
      <tbody>
        ${worktreeRows}
      </tbody>
    </table>
    `
    }
  </div>

  <div id="stashes-tab" class="tab-content">
    <div class="toolbar">
      <button class="btn" data-action="createStash">Create Stash</button>
      <button class="btn btn-secondary" data-action="clearAllStashes">Clear All</button>
    </div>

    ${
      stashes.length === 0
        ? '<div class="empty-state">No stashes found</div>'
        : `
    <table>
      <thead>
        <tr>
          <th>Index</th>
          <th>Message</th>
          <th>Branch</th>
          <th>Age</th>
          <th>Files</th>
          <th>Actions</th>
        </tr>
      </thead>
      <tbody>
        ${stashRows}
      </tbody>
    </table>
    `
    }
  </div>

  <div id="recovery-tab" class="tab-content">
    <div class="toolbar">
      <h3>🔄 Recovery Log</h3>
      <span style="margin-left: auto; color: var(--vscode-descriptionForeground);">
        ${recoveryLog.length} deleted branch${recoveryLog.length !== 1 ? 'es' : ''} available for recovery
      </span>
    </div>

    ${
      recoveryLog.length === 0
        ? '<div class="empty-state"><p>No deleted branches to recover.</p><p style="font-size: 12px; margin-top: 8px;">Deleted branches will appear here for recovery.</p></div>'
        : `
    <table>
      <thead>
        <tr>
          <th>Branch</th>
          <th>Deleted</th>
          <th>Commit</th>
          <th>Actions</th>
        </tr>
      </thead>
      <tbody>
        ${recoveryRows}
      </tbody>
    </table>
    `
    }
  </div>

  <div id="compare-tab" class="tab-content">
    <div class="tool-card">
      <h3>Compare Branches</h3>
      <div class="filter-row" style="margin-bottom: 12px;">
        <label style="width: 80px; font-size: 12px;">Branch A:</label>
        <select id="compare-branch-a" style="flex: 1;"></select>
      </div>
      <div class="filter-row" style="margin-bottom: 12px;">
        <label style="width: 80px; font-size: 12px;">Branch B:</label>
        <select id="compare-branch-b" style="flex: 1;"></select>
      </div>
      <button class="btn" data-action="runCompare">Compare</button>
    </div>
    <div id="comparison-results"></div>
    <div id="timeline-result" class="comparison-section" style="margin-top: 16px;"></div>
  </div>

  <div id="tools-tab" class="tab-content">
    <div class="tools-section">
      <div class="tool-card">
        <h3>📝 Batch Rename</h3>
        <div class="batch-rename-form">
          <input type="text" id="rename-pattern" placeholder="Pattern (regex)" value="feature/">
          <input type="text" id="rename-replacement" placeholder="Replacement" value="feat/">
          <button class="btn" data-action="batchRename">Preview Rename</button>
        </div>
        <p style="font-size: 12px; color: var(--vscode-descriptionForeground);">
          Use regex patterns to rename multiple branches. Example: <code>feature/</code> → <code>feat/</code>
        </p>
      </div>

      <div class="tool-card">
        <h3>🎯 Regex Branch Selection</h3>
        <div class="filter-row">
          <input type="text" id="regex-pattern" placeholder="Enter regex pattern" style="flex: 1;">
          <button class="btn" data-action="selectByRegex">Select Matching</button>
        </div>
        <p style="font-size: 12px; color: var(--vscode-descriptionForeground);">
          Select branches matching a regex pattern. Example: <code>^feature/.*</code>
        </p>
      </div>

      <div class="tool-card">
        <h3>🤖 Auto-Cleanup Rules</h3>
        <div id="rules-container"></div>
        <div style="display:flex;gap:8px;margin-top:12px;">
          <button class="btn" data-action="addCleanupRule">Add Rule</button>
          <button class="btn btn-secondary" data-action="exportRules">Export to Clipboard</button>
          <button class="btn btn-secondary" data-action="importRules">Import from Clipboard</button>
        </div>
      </div>
    </div>
  </div>

  <script nonce="${nonce}">
    const vscode = acquireVsCodeApi();

    // HTML escape utility (client-side)
    function escapeHtml(str) {
      return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
    }

    // Regex validation utility (client-side)
    function validateRegexPattern(pattern) {
      if (pattern.length > 200) {
        return { valid: false, error: 'Pattern too long (max 200 characters)' };
      }

      // Detect ReDoS-prone patterns
      const dangerousPatterns = [
        /\\([^)]*[+*]\\)[+*{]/,         // (x+)+, (x+)*, (x*)+, (x*)*
        /\\([^|]*\\|[^)]*\\)[+*{]/,      // (a|b)+, (a|b)*
        /\\.\\*\\.\\*/,                     // .*.* (multiple unbounded wildcards)
      ];

      for (const dangerous of dangerousPatterns) {
        if (dangerous.test(pattern)) {
          return {
            valid: false,
            error: 'Pattern contains quantifiers that may cause performance issues',
          };
        }
      }

      try {
        new RegExp(pattern);
        return { valid: true };
      } catch (e) {
        return {
          valid: false,
          error: 'Invalid regex: ' + e.message,
        };
      }
    }

    // Tab management
    function showTab(tabName, clickedEl) {
      document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
      document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
      if (clickedEl) clickedEl.classList.add('active');
      var tabEl = document.getElementById(tabName + '-tab');
      if (tabEl) tabEl.classList.add('active');
    }

    // Branch actions
    function deleteBranch(branch) {
      vscode.postMessage({ command: 'delete', branch });
    }

    function switchTo(branch) {
      vscode.postMessage({ command: 'switch', branch });
    }

    function addNote(branch) {
      const note = prompt('Add note for ' + branch);
      if (note !== null) {
        vscode.postMessage({ command: 'saveBranchNote', branch, note });
      }
    }

    function deleteSelected() {
      const selected = Array.from(document.querySelectorAll('.branch-checkbox:checked')).map(cb => cb.dataset.branch);
      if (selected.length > 0) {
        vscode.postMessage({ command: 'deleteMultiple', branches: selected });
      }
    }

    function toggleSelectAll(checked) {
      document.querySelectorAll('.branch-checkbox').forEach(cb => cb.checked = checked);
    }

    function selectMerged() {
      const rows = document.querySelectorAll('tr[data-branch]');
      rows.forEach(row => {
        const mergedCell = row.cells[4];
        if (mergedCell && mergedCell.textContent.includes('✓')) {
          const checkbox = row.querySelector('.branch-checkbox');
          if (checkbox && !checkbox.disabled) checkbox.checked = true;
        }
      });
    }

    function selectStale() {
      const rows = document.querySelectorAll('tr[data-branch]');
      rows.forEach(row => {
        const ageCell = row.cells[3];
        if (ageCell) {
          const match = ageCell.textContent.match(/(\\d+)d/);
          if (match && parseInt(match[1]) > ${daysUntilStale}) {
            const checkbox = row.querySelector('.branch-checkbox');
            if (checkbox && !checkbox.disabled) checkbox.checked = true;
          }
        }
      });
    }

    function selectGone() {
      const rows = document.querySelectorAll('tr[data-branch]');
      rows.forEach(row => {
        const infoCell = row.cells[6];
        if (infoCell && infoCell.textContent.includes('Gone')) {
          const checkbox = row.querySelector('.branch-checkbox');
          if (checkbox && !checkbox.disabled) checkbox.checked = true;
        }
      });
    }

    function clearSelection() {
      document.querySelectorAll('.branch-checkbox').forEach(cb => cb.checked = false);
      document.getElementById('select-all').checked = false;
    }

    // Remote branch actions
    function deleteRemoteBranch(remote, branch) {
      vscode.postMessage({ command: 'deleteRemote', remote, branch });
    }

    function deleteSelectedRemotes() {
      const selected = Array.from(document.querySelectorAll('.remote-branch-checkbox:checked')).map(cb => ({
        remote: cb.dataset.remote,
        name: cb.dataset.branch
      }));
      if (selected.length > 0) {
        vscode.postMessage({ command: 'deleteMultipleRemotes', branches: selected });
      }
    }

    function toggleSelectAllRemotes(checked) {
      document.querySelectorAll('.remote-branch-checkbox').forEach(cb => cb.checked = checked);
    }

    function selectMergedRemotes() {
      const rows = document.querySelectorAll('tr[data-remote-branch]');
      rows.forEach(row => {
        const mergedCell = row.cells[3];
        if (mergedCell && mergedCell.textContent.includes('✓')) {
          row.querySelector('.remote-branch-checkbox').checked = true;
        }
      });
    }

    function selectGoneRemotes() {
      const rows = document.querySelectorAll('tr[data-remote-branch]');
      rows.forEach(row => {
        const statusCell = row.cells[4];
        if (statusCell && statusCell.textContent.includes('Gone')) {
          row.querySelector('.remote-branch-checkbox').checked = true;
        }
      });
    }

    function clearRemoteSelection() {
      document.querySelectorAll('.remote-branch-checkbox').forEach(cb => cb.checked = false);
      document.getElementById('select-all-remotes').checked = false;
    }

    // Stash actions
    function createStash() {
      vscode.postMessage({ command: 'createStash' });
    }

    function applyStash(index) {
      vscode.postMessage({ command: 'applyStash', index });
    }

    function popStash(index) {
      vscode.postMessage({ command: 'popStash', index });
    }

    function dropStash(index) {
      vscode.postMessage({ command: 'dropStash', index });
    }

    function clearAllStashes() {
      vscode.postMessage({ command: 'clearStashes' });
    }

    // Worktree actions
    function createWorktree() {
      vscode.postMessage({ command: 'createWorktree' });
    }

    // Recovery actions
    function restoreBranch(branchName, commitHash) {
      vscode.postMessage({ command: 'restoreBranch', branchName, commitHash });
    }

    function dismissRecoveryEntry(branchName, commitHash) {
      vscode.postMessage({ command: 'clearRecoveryEntry', branchName, commitHash });
    }

    // Tools actions
    function batchRename() {
      const pattern = document.getElementById('rename-pattern').value;
      const replacement = document.getElementById('rename-replacement').value;
      const selected = Array.from(document.querySelectorAll('.branch-checkbox:checked')).map(cb => cb.dataset.branch);

      if (selected.length === 0) {
        alert('Please select branches to rename');
        return;
      }

      vscode.postMessage({ command: 'batchRename', pattern, replacement, branches: selected });
    }

    function selectByRegex() {
      const pattern = document.getElementById('regex-pattern').value;
      if (!pattern) return;

      const validation = validateRegexPattern(pattern);
      if (!validation.valid) {
        alert('Invalid regex pattern: ' + validation.error);
        return;
      }

      try {
        const regex = new RegExp(pattern);
        const rows = document.querySelectorAll('tr[data-branch]');
        rows.forEach(row => {
          const branch = row.dataset.branch;
          if (regex.test(branch)) {
            const checkbox = row.querySelector('.branch-checkbox');
            if (checkbox && !checkbox.disabled) checkbox.checked = true;
          }
        });
      } catch (e) {
        alert('Invalid regex pattern: ' + e.message);
      }
    }

    // Cleanup rule rendering
    function renderRules() {
      const container = document.getElementById('rules-container');
      if (!container) return;
      container.innerHTML = '';

      if (cleanupRules.length === 0) {
        const p = document.createElement('p');
        p.style.color = 'var(--vscode-descriptionForeground)';
        p.textContent = 'No rules configured. Click Add Rule to create one.';
        container.appendChild(p);
        return;
      }

      cleanupRules.forEach(rule => {
        const item = document.createElement('div');
        item.className = 'rule-item';

        const header = document.createElement('div');
        header.className = 'rule-header';

        const nameSpan = document.createElement('span');
        nameSpan.className = 'rule-name';
        nameSpan.textContent = rule.name;

        const controls = document.createElement('div');

        const toggleLabel = document.createElement('label');
        toggleLabel.style.cssText = 'margin-right: 8px; font-size: 12px;';
        const toggleInput = document.createElement('input');
        toggleInput.type = 'checkbox';
        toggleInput.checked = !!rule.enabled;
        toggleInput.addEventListener('change', () => toggleRule(rule.id));
        toggleLabel.appendChild(toggleInput);
        toggleLabel.appendChild(document.createTextNode(' Enabled'));

        const previewBtn = document.createElement('button');
        previewBtn.className = 'action-btn';
        previewBtn.textContent = 'Preview';
        previewBtn.addEventListener('click', () => previewRule(rule.id));

        const deleteBtn = document.createElement('button');
        deleteBtn.className = 'action-btn';
        deleteBtn.textContent = 'Delete';
        deleteBtn.addEventListener('click', () => deleteRule(rule.id));

        controls.appendChild(toggleLabel);
        controls.appendChild(previewBtn);
        controls.appendChild(deleteBtn);
        header.appendChild(nameSpan);
        header.appendChild(controls);

        const conditionsDiv = document.createElement('div');
        conditionsDiv.className = 'rule-conditions';
        conditionsDiv.textContent = formatConditions(rule.conditions);

        const previewDiv = document.createElement('div');
        previewDiv.id = 'preview-' + rule.id;

        item.appendChild(header);
        item.appendChild(conditionsDiv);
        item.appendChild(previewDiv);
        container.appendChild(item);
      });
    }

    function formatConditions(conditions) {
      if (!conditions) return '(no conditions \u2014 matches all branches)';
      const parts = [];
      if (conditions.merged === true) parts.push('Is merged');
      if (conditions.olderThanDays !== undefined && conditions.olderThanDays !== null) {
        parts.push('Older than ' + conditions.olderThanDays + ' days');
      }
      if (conditions.pattern) parts.push('Name matches /' + conditions.pattern + '/');
      if (conditions.noRemote === true) parts.push('No remote tracking branch');
      return parts.length > 0 ? parts.join(' AND ') : '(no conditions \u2014 matches all branches)';
    }

    function addCleanupRule() {
      const existing = document.getElementById('new-rule-form');
      if (existing) {
        existing.remove();
        return;
      }

      const container = document.getElementById('rules-container');

      const form = document.createElement('div');
      form.id = 'new-rule-form';
      form.style.cssText = 'background: var(--vscode-editor-background); border: 1px solid var(--vscode-panel-border); border-radius: 4px; padding: 12px; margin-bottom: 8px;';

      function makeRow(labelText, inputEl) {
        const row = document.createElement('div');
        row.className = 'filter-row';
        row.style.marginBottom = '8px';
        const lbl = document.createElement('label');
        lbl.style.cssText = 'width: 160px; font-size: 12px;';
        lbl.textContent = labelText;
        row.appendChild(lbl);
        row.appendChild(inputEl);
        return row;
      }

      function makeCheckRow(labelText, inputId) {
        const row = document.createElement('div');
        row.className = 'filter-row';
        row.style.marginBottom = '8px';
        const lbl = document.createElement('label');
        lbl.style.cssText = 'font-size: 12px;';
        const cb = document.createElement('input');
        cb.type = 'checkbox';
        cb.id = inputId;
        lbl.appendChild(cb);
        lbl.appendChild(document.createTextNode(' ' + labelText));
        row.appendChild(lbl);
        return row;
      }

      const nameInput = document.createElement('input');
      nameInput.type = 'text';
      nameInput.id = 'new-rule-name';
      nameInput.placeholder = 'e.g. Delete merged branches';
      nameInput.style.flex = '1';
      form.appendChild(makeRow('Rule name *', nameInput));

      form.appendChild(makeCheckRow('Merged branches only', 'new-rule-merged'));

      const daysInput = document.createElement('input');
      daysInput.type = 'number';
      daysInput.id = 'new-rule-days';
      daysInput.placeholder = 'e.g. 30';
      daysInput.min = '1';
      daysInput.style.width = '100px';
      form.appendChild(makeRow('Older than N days', daysInput));

      const patternInput = document.createElement('input');
      patternInput.type = 'text';
      patternInput.id = 'new-rule-pattern';
      patternInput.placeholder = 'e.g. ^feature/';
      patternInput.style.flex = '1';
      form.appendChild(makeRow('Name pattern (regex)', patternInput));

      form.appendChild(makeCheckRow('No remote tracking branch', 'new-rule-no-remote'));

      const errorDiv = document.createElement('div');
      errorDiv.id = 'new-rule-error';
      errorDiv.style.cssText = 'color: var(--vscode-errorForeground); font-size: 12px; margin-bottom: 8px; display: none;';
      form.appendChild(errorDiv);

      const btnRow = document.createElement('div');
      btnRow.className = 'filter-row';
      const saveBtn = document.createElement('button');
      saveBtn.className = 'btn';
      saveBtn.textContent = 'Save Rule';
      saveBtn.addEventListener('click', saveNewRule);
      const cancelBtn = document.createElement('button');
      cancelBtn.className = 'btn';
      cancelBtn.style.marginLeft = '8px';
      cancelBtn.textContent = 'Cancel';
      cancelBtn.addEventListener('click', cancelNewRule);
      btnRow.appendChild(saveBtn);
      btnRow.appendChild(cancelBtn);
      form.appendChild(btnRow);

      container.parentNode.insertBefore(form, container);
    }

    function saveNewRule() {
      const nameInput = document.getElementById('new-rule-name');
      const mergedInput = document.getElementById('new-rule-merged');
      const daysInput = document.getElementById('new-rule-days');
      const patternInput = document.getElementById('new-rule-pattern');
      const noRemoteInput = document.getElementById('new-rule-no-remote');
      const errorDiv = document.getElementById('new-rule-error');

      const name = nameInput.value.trim();
      const daysRaw = daysInput.value.trim();
      const pattern = patternInput.value.trim();

      const showError = (msg) => {
        errorDiv.textContent = msg;
        errorDiv.style.display = 'block';
      };
      errorDiv.style.display = 'none';

      if (!name) {
        showError('Rule name is required.');
        return;
      }

      let olderThanDays;
      if (daysRaw !== '') {
        const parsed = parseInt(daysRaw, 10);
        if (isNaN(parsed) || parsed <= 0 || String(parsed) !== daysRaw) {
          showError('Days must be a positive integer.');
          return;
        }
        olderThanDays = parsed;
      }

      if (pattern) {
        const validation = validateRegexPattern(pattern);
        if (!validation.valid) {
          showError('Invalid pattern: ' + validation.error);
          return;
        }
      }

      const conditions = {};
      if (mergedInput.checked) conditions.merged = true;
      if (olderThanDays !== undefined) conditions.olderThanDays = olderThanDays;
      if (pattern) conditions.pattern = pattern;
      if (noRemoteInput.checked) conditions.noRemote = true;

      const newRule = {
        id: 'rule-' + Date.now(),
        name,
        enabled: true,
        action: 'delete',
        conditions,
      };

      vscode.postMessage({ command: 'saveCleanupRules', rules: [...cleanupRules, newRule] });
    }

    function cancelNewRule() {
      const form = document.getElementById('new-rule-form');
      if (form) form.remove();
    }

    function toggleRule(ruleId) {
      const updated = cleanupRules.map(r => r.id === ruleId ? Object.assign({}, r, { enabled: !r.enabled }) : r);
      vscode.postMessage({ command: 'saveCleanupRules', rules: updated });
    }

    function deleteRule(ruleId) {
      const updated = cleanupRules.filter(r => r.id !== ruleId);
      vscode.postMessage({ command: 'saveCleanupRules', rules: updated });
    }

    // Dry-run preview
    var pendingPreviewRuleId = null;

    function previewRule(ruleId) {
      const rule = cleanupRules.find(r => r.id === ruleId);
      if (!rule) return;
      pendingPreviewRuleId = ruleId;
      vscode.postMessage({ command: 'evaluateRule', rule: rule });
    }

    // Import/export clipboard
    function exportRules() {
      vscode.postMessage({ command: 'exportRules' });
    }

    function importRules() {
      vscode.postMessage({ command: 'importRules' });
    }

    // Extension host message listener
    window.addEventListener('message', function(event) {
      const msg = event.data;
      switch (msg.command) {
        case 'ruleEvaluationResult': {
          if (!pendingPreviewRuleId) break;
          const previewDiv = document.getElementById('preview-' + pendingPreviewRuleId);
          if (previewDiv) {
            while (previewDiv.firstChild) previewDiv.removeChild(previewDiv.firstChild);
            const matches = msg.matches;
            if (!matches || matches.length === 0) {
              const p = document.createElement('p');
              p.style.cssText = 'font-size: 12px; color: var(--vscode-descriptionForeground); margin-top: 6px;';
              p.textContent = 'No branches match this rule';
              previewDiv.appendChild(p);
            } else {
              const summary = document.createElement('p');
              summary.style.cssText = 'font-size: 12px; color: var(--vscode-descriptionForeground); margin-top: 6px;';
              summary.textContent = matches.length + ' branch' + (matches.length !== 1 ? 'es' : '') + ' would be deleted:';
              previewDiv.appendChild(summary);
              const list = document.createElement('ul');
              list.style.cssText = 'font-size: 12px; color: var(--vscode-descriptionForeground); margin-top: 4px; padding-left: 20px;';
              matches.forEach(function(name) {
                const li = document.createElement('li');
                li.textContent = name;
                list.appendChild(li);
              });
              previewDiv.appendChild(list);
            }
          }
          pendingPreviewRuleId = null;
          break;
        }

        case 'comparisonResult': {
          const resultsContainer = document.getElementById('comparison-results');
          if (!resultsContainer) break;
          while (resultsContainer.firstChild) resultsContainer.removeChild(resultsContainer.firstChild);

          const data = msg.data;
          if (!data) break;

          // Ahead/behind summary
          const summarySection = document.createElement('div');
          summarySection.className = 'comparison-section';
          const summaryH3 = document.createElement('h3');
          summaryH3.textContent = data.branchA + ' vs ' + data.branchB;
          summarySection.appendChild(summaryH3);
          const summaryP = document.createElement('p');
          summaryP.style.cssText = 'font-size: 12px; color: var(--vscode-descriptionForeground); margin-bottom: 8px;';
          summaryP.textContent = data.branchA + ' is ' + data.ahead + ' ahead and ' + data.behind + ' behind ' + data.branchB;
          summarySection.appendChild(summaryP);
          resultsContainer.appendChild(summarySection);

          // Commits unique to branchA
          if (data.commitsA && data.commitsA.length > 0) {
            const sectionA = document.createElement('div');
            sectionA.className = 'comparison-section';
            const headA = document.createElement('h3');
            headA.textContent = 'Commits unique to ' + data.branchA + ' (' + data.commitsA.length + ')';
            sectionA.appendChild(headA);
            renderCommits(data.commitsA, sectionA);
            resultsContainer.appendChild(sectionA);
          }

          // Commits unique to branchB
          if (data.commitsB && data.commitsB.length > 0) {
            const sectionB = document.createElement('div');
            sectionB.className = 'comparison-section';
            const headB = document.createElement('h3');
            headB.textContent = 'Commits unique to ' + data.branchB + ' (' + data.commitsB.length + ')';
            sectionB.appendChild(headB);
            renderCommits(data.commitsB, sectionB);
            resultsContainer.appendChild(sectionB);
          }

          // Changed files
          if (data.files && data.files.length > 0) {
            const filesSection = document.createElement('div');
            filesSection.className = 'comparison-section';
            const filesH3 = document.createElement('h3');
            filesH3.textContent = 'Changed files (' + data.files.length + ')';
            filesSection.appendChild(filesH3);
            renderFileChanges(data.files, filesSection, data.branchA, data.branchB);
            resultsContainer.appendChild(filesSection);
          }

          if ((!data.commitsA || data.commitsA.length === 0) && (!data.commitsB || data.commitsB.length === 0) && (!data.files || data.files.length === 0)) {
            const noDiffP = document.createElement('p');
            noDiffP.style.cssText = 'font-size: 12px; color: var(--vscode-descriptionForeground);';
            noDiffP.textContent = 'No differences found between the two branches.';
            resultsContainer.appendChild(noDiffP);
          }

          // Request timeline for branchA after comparison results are rendered
          vscode.postMessage({ command: 'getTimeline', branchName: data.branchA });
          break;
        }

        case 'timelineResult': {
          const data = msg.data;
          if (!data || !data.commits || data.commits.length === 0) break;
          const timelineContainer = document.getElementById('timeline-result');
          if (!timelineContainer) break;
          while (timelineContainer.firstChild) timelineContainer.removeChild(timelineContainer.firstChild);
          const heading = document.createElement('h3');
          heading.textContent = 'Recent commits on ' + String(data.branchName);
          timelineContainer.appendChild(heading);
          renderCommits(data.commits, timelineContainer);
          break;
        }
      }
    });

    // General actions
    function refresh() {
      vscode.postMessage({ command: 'refresh' });
    }

    function connectGitHub() {
      vscode.postMessage({ command: 'connectGitHub' });
    }

    // Event delegation — replaces all inline onclick/onchange handlers for CSP compliance
    document.addEventListener('click', function(e) {
      var el = e.target.closest('[data-action]');
      if (!el || el.disabled) return;
      var action = el.dataset.action;
      switch (action) {
        case 'deleteBranch': deleteBranch(el.dataset.branch); break;
        case 'switchTo': switchTo(el.dataset.branch); break;
        case 'addNote': addNote(el.dataset.branch); break;
        case 'deleteRemoteBranch': deleteRemoteBranch(el.dataset.remote, el.dataset.branch); break;
        case 'applyStash': applyStash(parseInt(el.dataset.index)); break;
        case 'popStash': popStash(parseInt(el.dataset.index)); break;
        case 'dropStash': dropStash(parseInt(el.dataset.index)); break;
        case 'restoreBranch': restoreBranch(el.dataset.branch, el.dataset.hash); break;
        case 'dismissRecoveryEntry': dismissRecoveryEntry(el.dataset.branch, el.dataset.hash); break;
        case 'showTab': showTab(el.dataset.tab, el); break;
        case 'refresh': refresh(); break;
        case 'connectGitHub': connectGitHub(); break;
        case 'deleteSelected': deleteSelected(); break;
        case 'selectMerged': selectMerged(); break;
        case 'selectStale': selectStale(); break;
        case 'selectGone': selectGone(); break;
        case 'clearSelection': clearSelection(); break;
        case 'deleteSelectedRemotes': deleteSelectedRemotes(); break;
        case 'selectMergedRemotes': selectMergedRemotes(); break;
        case 'selectGoneRemotes': selectGoneRemotes(); break;
        case 'clearRemoteSelection': clearRemoteSelection(); break;
        case 'createWorktree': createWorktree(); break;
        case 'createStash': createStash(); break;
        case 'clearAllStashes': clearAllStashes(); break;
        case 'runCompare': runCompare(); break;
        case 'batchRename': batchRename(); break;
        case 'selectByRegex': selectByRegex(); break;
        case 'addCleanupRule': addCleanupRule(); break;
        case 'exportRules': exportRules(); break;
        case 'importRules': importRules(); break;
      }
    });
    // Handle checkbox change events via delegation
    document.addEventListener('change', function(e) {
      var el = e.target.closest('[data-action]');
      if (!el) return;
      var action = el.dataset.action;
      if (action === 'toggleSelectAll') toggleSelectAll(el.checked);
      if (action === 'toggleSelectAllRemotes') toggleSelectAllRemotes(el.checked);
    });

    // Load cleanup rules
    const cleanupRules = ${rulesJson};
    renderRules();

    // Load branch names for compare dropdowns
    const allBranchNames = ${JSON.stringify(allBranchNames).replace(/</g, '\\u003c')};
    const currentBranchName = ${JSON.stringify(currentBranch ?? '').replace(/</g, '\\u003c')};
    initCompareDropdowns();

    function initCompareDropdowns() {
      const selectA = document.getElementById('compare-branch-a');
      const selectB = document.getElementById('compare-branch-b');
      if (!selectA || !selectB) return;

      allBranchNames.forEach(function(name) {
        const optA = document.createElement('option');
        optA.textContent = name;
        optA.value = name;
        if (name === currentBranchName) optA.selected = true;
        selectA.appendChild(optA);

        const optB = document.createElement('option');
        optB.textContent = name;
        optB.value = name;
        selectB.appendChild(optB);
      });
    }

    function runCompare() {
      const selectA = document.getElementById('compare-branch-a');
      const selectB = document.getElementById('compare-branch-b');
      if (!selectA || !selectB) return;
      const branch1 = selectA.value;
      const branch2 = selectB.value;
      if (!branch1 || !branch2) return;
      vscode.postMessage({ command: 'compareBranches', branch1, branch2 });
    }

    function renderCommits(commits, container) {
      commits.forEach(function(c) {
        const row = document.createElement('div');
        row.className = 'commit-row';
        const hashSpan = document.createElement('code');
        hashSpan.className = 'commit-hash';
        hashSpan.textContent = c.hash;
        const textSpan = document.createElement('span');
        textSpan.textContent = ' ' + c.message + ' \u2014 ' + c.author + ', ' + c.date;
        row.appendChild(hashSpan);
        row.appendChild(textSpan);
        container.appendChild(row);
      });
    }

    function renderFileChanges(files, container, branchA, branchB) {
      files.forEach(function(f) {
        const row = document.createElement('div');
        row.className = 'file-change-row';
        const badge = document.createElement('span');
        badge.className = 'status-badge status-' + (f.status || '').toLowerCase();
        badge.textContent = f.status || '?';
        const pathSpan = document.createElement('span');
        pathSpan.className = 'file-path';
        pathSpan.textContent = f.path;
        row.appendChild(badge);
        row.appendChild(pathSpan);
        if (branchA && branchB) {
          const diffBtn = document.createElement('button');
          diffBtn.className = 'action-btn';
          diffBtn.textContent = 'Diff';
          diffBtn.addEventListener('click', function() {
            vscode.postMessage({
              command: 'openDiff',
              branchA: branchA,
              branchB: branchB,
              filePath: f.path
            });
          });
          row.appendChild(diffBtn);
        }
        container.appendChild(row);
      });
    }
  </script>
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
    setTimeout(() => showReviewRequest(context), 2000);
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
    vscode.env.openExternal(vscode.Uri.parse(`https://marketplace.visualstudio.com/items?itemName=${extensionId}&ssr=false#review-details`));
    context.globalState.update('hasReviewed', true);
  } else if (result === "Don't Ask Again") {
    context.globalState.update('hasReviewed', true);
  } else {
    context.globalState.update('reviewRequestCount', reviewRequestCount + 1);
  }

  context.globalState.update('lastReviewRequestDate', Date.now());
}

/**
 * Increments usage count and shows support message.
 */
function incrementUsageCount(context: vscode.ExtensionContext) {
  const usageCount = context.globalState.get<number>('usageCount', 0);
  const hasShownSupport = context.globalState.get<boolean>('hasShownSupportMessage', false);
  const lastShownDate = context.globalState.get<number>('lastSupportMessageDate', 0);

  context.globalState.update('usageCount', usageCount + 1);

  const daysSinceLastShown = (Date.now() - lastShownDate) / (1000 * 60 * 60 * 24);

  if ((usageCount === 10 && !hasShownSupport) || (usageCount > 10 && usageCount % 20 === 0 && daysSinceLastShown > 14)) {
    showSupportMessage(context);
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
    vscode.env.openExternal(vscode.Uri.parse('https://github.com/sponsors/YonasValentin'));
    context.globalState.update('hasShownSupportMessage', true);
  } else if (result === "Don't Show Again") {
    context.globalState.update('hasShownSupportMessage', true);
  }

  context.globalState.update('lastSupportMessageDate', Date.now());
}

/**
 * Deactivates the extension.
 * Cleanup is handled automatically via context.subscriptions.
 */
export function deactivate() {}
