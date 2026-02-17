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
import { RepositoryContextManager } from './services';

// Constants
import { BRANCH_TEMPLATES } from './constants';

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
  getAllBranchNames,
  renameBranch,
  deleteBranchForce,
  getGitHubInfo,
  fetchGitHubPRs,
  calculateHealthScore,
  getHealthStatus,
  getHealthReason,
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
  deleteBranch,
  deleteMultipleBranches,
  checkBranchHealth,
  undoLastDelete,
  restoreFromLog,
} from './commands';

let globalStatusBarItem: vscode.StatusBarItem | undefined;
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

  const statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 100);
  statusBarItem.command = 'git-branch-manager.cleanup';
  globalStatusBarItem = statusBarItem;
  context.subscriptions.push(statusBarItem);

  /**
   * Updates the global status bar item using the current repo context.
   */
  async function updateGlobalStatusBar() {
    await updateStatusBar(statusBarItem, repoContext);
  }

  updateGlobalStatusBar();

  const cleanupCommand = vscode.commands.registerCommand('git-branch-manager.cleanup', () => {
    showBranchManager(context, repoContext, updateGlobalStatusBar);
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

  const statusBarInterval = setInterval(() => updateGlobalStatusBar(), 30000);
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
 */
async function showBranchManager(
  context: vscode.ExtensionContext,
  repoContext: RepositoryContextManager,
  updateGlobalStatusBar: () => Promise<void>
) {
  const panel = vscode.window.createWebviewPanel('branchManager', 'Git Branch Manager', vscode.ViewColumn.One, {
    enableScripts: true,
    retainContextWhenHidden: true,
  });

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

    const [branches, remoteBranches, worktrees, stashes, currentBranch, baseBranch] = await Promise.all([
      getBranchInfo(gitRoot),
      getRemoteBranchInfo(gitRoot),
      getWorktreeInfo(gitRoot),
      getStashInfo(gitRoot),
      getCurrentBranch(gitRoot),
      getBaseBranch(gitRoot),
    ]);

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
      recoveryLog
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
            vscode.window.showInformationMessage(
              `${message.branch1} is ${comparison.ahead} ahead and ${comparison.behind} behind ${message.branch2}`
            );
          } catch (error) {
            vscode.window.showErrorMessage(`Failed to compare branches: ${error}`);
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
  recoveryLog: DeletedBranchEntry[]
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
        ? `<a href="${branch.prStatus.url}" class="pr-link" title="${escapeHtml(branch.prStatus.title)}">#${branch.prStatus.number} (${branch.prStatus.state})</a>`
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
        <td>${branch.author || ''}</td>
        <td>${remoteInfo} ${prInfo} ${aheadBehindInfo}</td>
        <td>
          <button class="action-btn" onclick="deleteBranch('${escapeHtml(branch.name)}')" ${branch.isCurrentBranch ? 'disabled' : ''}>Delete</button>
          <button class="action-btn" onclick="switchTo('${escapeHtml(branch.name)}')" ${branch.isCurrentBranch ? 'disabled' : ''}>Switch</button>
          <button class="action-btn" onclick="addNote('${escapeHtml(branch.name)}')">Note</button>
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
        <td>${branch.localBranch || ''}</td>
        <td>
          <button class="action-btn" onclick="deleteRemoteBranch('${escapeHtml(branch.remote)}', '${escapeHtml(branch.name)}')">Delete</button>
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
          <button class="action-btn" onclick="applyStash(${stash.index})">Apply</button>
          <button class="action-btn" onclick="popStash(${stash.index})">Pop</button>
          <button class="action-btn" onclick="dropStash(${stash.index})">Drop</button>
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
        <td><code>${entry.commitHash.substring(0, 7)}</code></td>
        <td>
          <button class="action-btn" onclick="restoreBranch('${escapeHtml(entry.branchName)}', '${entry.commitHash}')">Restore</button>
          <button class="action-btn" onclick="dismissRecoveryEntry('${escapeHtml(entry.branchName)}', '${entry.commitHash}')">Dismiss</button>
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
  const rulesJson = JSON.stringify(cleanupRulesArray);

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
  </style>
</head>
<body>
  <div class="header">
    <h1>🌿 Git Branch Manager</h1>
    <div class="header-actions">
      <button class="btn" onclick="refresh()">↻ Refresh</button>
      <button class="btn btn-secondary" onclick="connectGitHub()">Connect GitHub</button>
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
    <button class="tab active" onclick="showTab('branches')">Branches</button>
    <button class="tab" onclick="showTab('remotes')">Remote Branches</button>
    <button class="tab" onclick="showTab('worktrees')">Worktrees</button>
    <button class="tab" onclick="showTab('stashes')">Stashes</button>
    <button class="tab" onclick="showTab('recovery')">Recovery${recoveryLog.length > 0 ? ` (${recoveryLog.length})` : ''}</button>
    <button class="tab" onclick="showTab('tools')">Tools</button>
  </div>

  <div id="branches-tab" class="tab-content active">
    <div class="toolbar">
      <button class="btn" onclick="deleteSelected()">Delete Selected</button>
      <button class="btn btn-secondary" onclick="selectMerged()">Select Merged</button>
      <button class="btn btn-secondary" onclick="selectStale()">Select Stale</button>
      <button class="btn btn-secondary" onclick="selectGone()">Select Gone</button>
      <button class="btn btn-secondary" onclick="clearSelection()">Clear</button>
    </div>

    ${
      branches.length === 0
        ? '<div class="empty-state">No branches found</div>'
        : `
    <table>
      <thead>
        <tr>
          <th><input type="checkbox" id="select-all" onchange="toggleSelectAll(this)"/></th>
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
      <button class="btn" onclick="deleteSelectedRemotes()">Delete Selected</button>
      <button class="btn btn-secondary" onclick="selectMergedRemotes()">Select Merged</button>
      <button class="btn btn-secondary" onclick="selectGoneRemotes()">Select Gone</button>
      <button class="btn btn-secondary" onclick="clearRemoteSelection()">Clear</button>
    </div>

    ${
      remoteBranches.length === 0
        ? '<div class="empty-state">No remote branches found</div>'
        : `
    <table>
      <thead>
        <tr>
          <th><input type="checkbox" id="select-all-remotes" onchange="toggleSelectAllRemotes(this)"/></th>
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
      <button class="btn" onclick="createWorktree()">Create Worktree</button>
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
      <button class="btn" onclick="createStash()">Create Stash</button>
      <button class="btn btn-secondary" onclick="clearAllStashes()">Clear All</button>
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

  <div id="tools-tab" class="tab-content">
    <div class="tools-section">
      <div class="tool-card">
        <h3>📝 Batch Rename</h3>
        <div class="batch-rename-form">
          <input type="text" id="rename-pattern" placeholder="Pattern (regex)" value="feature/">
          <input type="text" id="rename-replacement" placeholder="Replacement" value="feat/">
          <button class="btn" onclick="batchRename()">Preview Rename</button>
        </div>
        <p style="font-size: 12px; color: var(--vscode-descriptionForeground);">
          Use regex patterns to rename multiple branches. Example: <code>feature/</code> → <code>feat/</code>
        </p>
      </div>

      <div class="tool-card">
        <h3>🎯 Regex Branch Selection</h3>
        <div class="filter-row">
          <input type="text" id="regex-pattern" placeholder="Enter regex pattern" style="flex: 1;">
          <button class="btn" onclick="selectByRegex()">Select Matching</button>
        </div>
        <p style="font-size: 12px; color: var(--vscode-descriptionForeground);">
          Select branches matching a regex pattern. Example: <code>^feature/.*</code>
        </p>
      </div>

      <div class="tool-card">
        <h3>🤖 Auto-Cleanup Rules</h3>
        <div id="rules-container">
          ${cleanupRulesArray.length === 0 ? '<p style="color: var(--vscode-descriptionForeground);">No rules configured</p>' : ''}
        </div>
        <button class="btn" onclick="addCleanupRule()">Add Rule</button>
      </div>
    </div>
  </div>

  <script nonce="${nonce}">
    const vscode = acquireVsCodeApi();

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
    function showTab(tabName) {
      document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
      document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
      event.target.classList.add('active');
      document.getElementById(tabName + '-tab').classList.add('active');
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

    function toggleSelectAll(checkbox) {
      document.querySelectorAll('.branch-checkbox').forEach(cb => cb.checked = checkbox.checked);
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

    function toggleSelectAllRemotes(checkbox) {
      document.querySelectorAll('.remote-branch-checkbox').forEach(cb => cb.checked = checkbox.checked);
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

    function addCleanupRule() {
      // TODO: Implement rule builder UI
      alert('Rule builder coming soon');
    }

    // General actions
    function refresh() {
      vscode.postMessage({ command: 'refresh' });
    }

    function connectGitHub() {
      vscode.postMessage({ command: 'connectGitHub' });
    }

    // Load cleanup rules
    const cleanupRules = ${rulesJson};
    // TODO: Render cleanup rules
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
