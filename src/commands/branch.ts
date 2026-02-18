import * as vscode from 'vscode';
import { getBranchInfo, gitCommand, getCommitHash, restoreBranch } from '../git';
import { addRecoveryEntry, getRecoveryLog, removeRecoveryEntry } from '../storage';
import { BRANCH_TEMPLATES } from '../constants';
import { RepositoryContextManager } from '../services';

/**
 * Creates a branch from a template.
 * @param repoContext - Repository context manager
 */
export async function createBranchFromTemplate(repoContext: RepositoryContextManager): Promise<void> {
  const repo = await repoContext.getActiveRepository();
  if (!repo) {
    vscode.window.showErrorMessage('Not in a Git repository');
    return;
  }
  const gitRoot = repo.path;

  try {
    await gitCommand(['log', '-1'], gitRoot);
  } catch {
    await vscode.window.showErrorMessage(
      'Cannot create a branch: Your repository has no commits yet.',
      'OK'
    );
    return;
  }

  const selected = await vscode.window.showQuickPick(
    BRANCH_TEMPLATES.map((t) => ({
      label: t.name,
      description: t.pattern,
      detail: `Example: ${t.example}`,
      template: t,
    })),
    { placeHolder: 'Select a branch template', matchOnDescription: true }
  );

  if (!selected) return;

  const description = await vscode.window.showInputBox({
    prompt: `Enter ${selected.template.pattern.includes('version') ? 'version' : 'description'}`,
    placeHolder: selected.template.pattern.includes('version') ? 'v1.2.0' : 'brief-description',
    validateInput: (value) => {
      if (!value) return 'Value is required';
      if (value.includes(' ') && !selected.template.pattern.includes('version')) {
        return 'Use hyphens instead of spaces';
      }
      return null;
    },
  });

  if (!description) return;

  const branchName = selected.template.pattern
    .replace('{description}', description)
    .replace('{version}', description);

  try {
    await gitCommand(['checkout', '-b', branchName], gitRoot);
    vscode.window.showInformationMessage(`Created branch: ${branchName}`);
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    if (errorMessage.includes('already exists')) {
      vscode.window.showErrorMessage(`Branch '${branchName}' already exists`);
    } else {
      vscode.window.showErrorMessage(`Failed to create branch: ${errorMessage}`);
    }
  }
}

/**
 * Quick cleanup of merged branches.
 * @param repoContext - Repository context manager
 * @param context - Extension context
 * @param updateStatusBar - Optional callback to update status bar
 */
export async function quickCleanup(
  repoContext: RepositoryContextManager,
  context?: vscode.ExtensionContext,
  updateStatusBar?: () => Promise<void>
): Promise<void> {
  const repo = await repoContext.getActiveRepository();
  if (!repo) {
    vscode.window.showErrorMessage('Not in a Git repository');
    return;
  }
  const gitRoot = repo.path;

  const branches = await getBranchInfo(gitRoot);
  const toDelete = branches.filter((b) => !b.isCurrentBranch && b.isMerged);

  if (toDelete.length === 0) {
    vscode.window.showInformationMessage('No merged branches to clean up.');
    return;
  }

  const message = `Delete ${toDelete.length} merged branch${toDelete.length > 1 ? 'es' : ''}?\n\n` +
    toDelete.map((b) => `• ${b.name}`).join('\n');

  const result = await vscode.window.showWarningMessage(message, { modal: true }, 'Delete All', 'View Details');

  if (result === 'Delete All') {
    await deleteMultipleBranches(gitRoot, toDelete.map((b) => b.name), context);
    if (context && toDelete.length > 0) {
      const usageCount = context.globalState.get<number>('usageCount', 0);
      await context.globalState.update('usageCount', usageCount + 1);
    }
    if (updateStatusBar) {
      await updateStatusBar();
    }
  } else if (result === 'View Details') {
    vscode.commands.executeCommand('git-branch-manager.cleanup');
  }
}

/**
 * Switch to a branch.
 * @param cwd - Working directory
 * @param branchName - Branch to switch to
 */
export async function switchBranch(cwd: string, branchName: string): Promise<void> {
  const result = await vscode.window.showQuickPick(['Yes', 'No'], {
    placeHolder: `Switch to branch "${branchName}"?`,
  });

  if (result !== 'Yes') return;

  try {
    await gitCommand(['checkout', branchName], cwd);
    vscode.window.showInformationMessage(`Switched to branch: ${branchName}`);
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    vscode.window.showErrorMessage(`Failed to switch branch: ${errorMessage}`);
  }
}

/**
 * Deletes a single branch.
 * @param cwd - Working directory
 * @param branchName - Branch to delete
 * @param context - Extension context
 * @returns Success status
 */
export async function deleteBranch(cwd: string, branchName: string, context?: vscode.ExtensionContext): Promise<boolean> {
  const config = vscode.workspace.getConfiguration('gitBranchManager');
  const confirmBeforeDelete = config.get<boolean>('confirmBeforeDelete', true);

  if (confirmBeforeDelete) {
    const result = await vscode.window.showWarningMessage(
      `Delete branch "${branchName}"?`,
      { modal: true },
      'Delete',
      'Cancel'
    );
    if (result !== 'Delete') return false;
  }

  try {
    // Capture commit hash BEFORE deletion for recovery
    const commitHash = await getCommitHash(cwd, branchName);

    await gitCommand(['branch', '-D', '--', branchName], cwd);
    vscode.window.showInformationMessage(`Deleted branch: ${branchName}`);

    // Store recovery entry if we have context and captured the hash
    if (context && commitHash) {
      await addRecoveryEntry(context, cwd, {
        branchName,
        commitHash,
        deletedAt: Date.now(),
      });
    }

    if (context) {
      const totalDeleted = context.globalState.get<number>('totalBranchesDeleted', 0);
      await context.globalState.update('totalBranchesDeleted', totalDeleted + 1);
    }
    return true;
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    vscode.window.showErrorMessage(`Failed to delete branch ${branchName}: ${errorMessage}`);
    return false;
  }
}

/**
 * Deletes branches with batch optimization. Falls back to sequential deletion on partial failure.
 * @param cwd - Working directory
 * @param branches - Branches to delete
 * @param context - Extension context
 */
export async function deleteMultipleBranches(cwd: string, branches: string[], context?: vscode.ExtensionContext): Promise<void> {
  if (!branches.length) return;

  // Capture commit hashes BEFORE deletion for recovery
  const commitHashes: Map<string, string> = new Map();
  if (context) {
    for (const branch of branches) {
      const hash = await getCommitHash(cwd, branch);
      if (hash) {
        commitHashes.set(branch, hash);
      }
    }
  }

  const result = await vscode.window.withProgress(
    { location: vscode.ProgressLocation.Notification, title: 'Deleting branches', cancellable: false },
    async (progress) => {
      let deleted = 0;
      let failed = 0;
      const failedBranches: string[] = [];
      const deletedBranches: string[] = [];

      if (branches.length > 1) {
        progress.report({ increment: 50, message: `Deleting ${branches.length} branches...` });

        try {
          const args = ['branch', '-D', '--', ...branches];
          await gitCommand(args, cwd);
          deleted = branches.length;
          deletedBranches.push(...branches);
          progress.report({ increment: 50, message: 'Done' });
        } catch (err: unknown) {
          // Batch failed, fall back to sequential for accurate error tracking
          const errMessage = err instanceof Error ? err.message : String(err);
          console.warn('Batch delete failed:', errMessage);

          for (let i = 0; i < branches.length; i++) {
            progress.report({ increment: 50 / branches.length, message: branches[i] });
            try {
              await gitCommand(['branch', '-D', '--', branches[i]], cwd);
              deleted++;
              deletedBranches.push(branches[i]);
            } catch {
              failed++;
              failedBranches.push(branches[i]);
            }
          }
        }
      } else {
        progress.report({ increment: 50, message: branches[0] });
        try {
          await gitCommand(['branch', '-D', '--', branches[0]], cwd);
          deleted = 1;
          deletedBranches.push(branches[0]);
        } catch {
          failed = 1;
          failedBranches.push(branches[0]);
        }
        progress.report({ increment: 50, message: 'Done' });
      }

      // Store recovery entries for successfully deleted branches
      if (context) {
        for (const branch of deletedBranches) {
          const hash = commitHashes.get(branch);
          if (hash) {
            await addRecoveryEntry(context, cwd, {
              branchName: branch,
              commitHash: hash,
              deletedAt: Date.now(),
            });
          }
        }
      }

      return { deleted, failed, failedBranches };
    }
  );

  if (result.failed === 0) {
    vscode.window.showInformationMessage(`Deleted ${result.deleted} branch${result.deleted > 1 ? 'es' : ''}`);
  } else {
    const failedList = result.failedBranches.length <= 3
      ? result.failedBranches.join(', ')
      : `${result.failedBranches.slice(0, 3).join(', ')}...`;
    vscode.window.showWarningMessage(`Deleted ${result.deleted}, failed ${result.failed}: ${failedList}`);
  }

  if (context && result.deleted > 0) {
    const totalDeleted = context.globalState.get<number>('totalBranchesDeleted', 0);
    const successfulCleanups = context.globalState.get<number>('successfulCleanups', 0);

    await context.globalState.update('totalBranchesDeleted', totalDeleted + result.deleted);
    await context.globalState.update('successfulCleanups', successfulCleanups + 1);

    await checkAndShowReviewRequest(context);
  }
}

/**
 * Checks branch health and shows notifications.
 * @param repoContext - Repository context manager
 */
export async function checkBranchHealth(repoContext: RepositoryContextManager): Promise<void> {
  const config = vscode.workspace.getConfiguration('gitBranchManager');
  if (!config.get('showNotifications', true)) return;

  const repo = await repoContext.getActiveRepository();
  if (!repo) return;
  const gitRoot = repo.path;

  const branches = await getBranchInfo(gitRoot);
  const daysUntilStale = config.get<number>('daysUntilStale', 30);
  const cleanupCandidates = branches.filter(
    (b) => !b.isCurrentBranch && (b.isMerged || b.daysOld > daysUntilStale || b.remoteGone)
  );

  if (cleanupCandidates.length >= 5) {
    const dangerCount = cleanupCandidates.filter((b) => b.healthStatus === 'danger').length;
    const message = dangerCount > 0
      ? `${cleanupCandidates.length} branches need cleanup (${dangerCount} critical)`
      : `${cleanupCandidates.length} branches could be cleaned up`;

    const result = await vscode.window.showInformationMessage(
      message,
      'Clean Now',
      'View Details',
      "Don't Show Again"
    );

    if (result === 'Clean Now') {
      vscode.commands.executeCommand('git-branch-manager.quickCleanup');
    } else if (result === 'View Details') {
      vscode.commands.executeCommand('git-branch-manager.cleanup');
    } else if (result === "Don't Show Again") {
      config.update('showNotifications', false, true);
    }
  }
}

/**
 * Checks and shows review request based on usage.
 */
async function checkAndShowReviewRequest(context: vscode.ExtensionContext): Promise<void> {
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
async function showReviewRequest(context: vscode.ExtensionContext): Promise<void> {
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
    await context.globalState.update('hasReviewed', true);
  } else if (result === "Don't Ask Again") {
    await context.globalState.update('hasReviewed', true);
  } else {
    await context.globalState.update('reviewRequestCount', reviewRequestCount + 1);
  }

  await context.globalState.update('lastReviewRequestDate', Date.now());
}

/**
 * Formats a timestamp as a human-readable "time ago" string.
 */
function getTimeAgo(timestamp: number): string {
  const seconds = Math.floor((Date.now() - timestamp) / 1000);
  if (seconds < 60) return 'just now';
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes} minute${minutes > 1 ? 's' : ''} ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} hour${hours > 1 ? 's' : ''} ago`;
  const days = Math.floor(hours / 24);
  return `${days} day${days > 1 ? 's' : ''} ago`;
}

/**
 * Undoes the last branch deletion by restoring from recovery log.
 * @param context - Extension context
 * @param cwd - Working directory (git root)
 */
export async function undoLastDelete(
  context: vscode.ExtensionContext,
  cwd: string
): Promise<void> {
  const log = getRecoveryLog(context, cwd);

  if (log.length === 0) {
    vscode.window.showInformationMessage('No deleted branches to restore.');
    return;
  }

  const lastEntry = log[0]; // Newest entry is first
  const timeAgo = getTimeAgo(lastEntry.deletedAt);

  const result = await vscode.window.showInformationMessage(
    `Restore branch "${lastEntry.branchName}" (deleted ${timeAgo})?`,
    { modal: true },
    'Restore',
    'Cancel'
  );

  if (result !== 'Restore') return;

  const restoreResult = await restoreBranch(cwd, lastEntry.branchName, lastEntry.commitHash);

  if (restoreResult.success) {
    await removeRecoveryEntry(context, cwd, lastEntry.branchName, lastEntry.commitHash);
    vscode.window.showInformationMessage(`Restored branch: ${lastEntry.branchName}`);
  } else {
    vscode.window.showErrorMessage(`Failed to restore: ${restoreResult.error}`);
  }
}

/**
 * Restores a specific branch from the recovery log.
 * @param context - Extension context
 * @param cwd - Working directory
 * @param branchName - Branch name to restore
 * @param commitHash - Commit hash to restore to
 */
export async function restoreFromLog(
  context: vscode.ExtensionContext,
  cwd: string,
  branchName: string,
  commitHash: string
): Promise<{ success: boolean; error?: string }> {
  const result = await restoreBranch(cwd, branchName, commitHash);

  if (result.success) {
    await removeRecoveryEntry(context, cwd, branchName, commitHash);
    vscode.window.showInformationMessage(`Restored branch: ${branchName}`);
  }

  return result;
}
