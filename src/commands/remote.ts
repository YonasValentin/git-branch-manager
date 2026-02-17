import * as vscode from 'vscode';
import { getRemoteBranchInfo, gitCommand } from '../git';
import { RemoteBranchInfo } from '../types';
import { RepositoryContextManager } from '../services';

/**
 * Cleans remote branches.
 * @param repoContext - Repository context manager
 * @param context - Extension context
 */
export async function cleanRemoteBranches(repoContext: RepositoryContextManager, context: vscode.ExtensionContext): Promise<void> {
  const repo = await repoContext.getActiveRepository();
  if (!repo) {
    vscode.window.showErrorMessage('Not in a Git repository');
    return;
  }
  const gitRoot = repo.path;

  const remoteBranches = await getRemoteBranchInfo(gitRoot);
  const config = vscode.workspace.getConfiguration('gitBranchManager');
  const daysUntilStale = config.get<number>('daysUntilStale', 30);

  const mergedRemotes = remoteBranches.filter((b) => b.isMerged);
  const staleRemotes = remoteBranches.filter((b) => !b.isMerged && b.daysOld && b.daysOld > daysUntilStale);

  if (mergedRemotes.length === 0 && staleRemotes.length === 0) {
    vscode.window.showInformationMessage('No remote branches need cleanup.');
    return;
  }

  const items: vscode.QuickPickItem[] = [];
  if (mergedRemotes.length > 0) {
    items.push({ label: `Delete ${mergedRemotes.length} merged remote branches`, description: 'merged' });
  }
  if (staleRemotes.length > 0) {
    items.push({ label: `Delete ${staleRemotes.length} stale remote branches`, description: 'stale' });
  }
  items.push({ label: 'Select individual branches...', description: 'select' });

  const choice = await vscode.window.showQuickPick(items, {
    placeHolder: 'Remote branch cleanup',
  });

  if (!choice) return;

  let toDelete: RemoteBranchInfo[] = [];

  if (choice.description === 'merged') {
    toDelete = mergedRemotes;
  } else if (choice.description === 'stale') {
    toDelete = staleRemotes;
  } else {
    const allRemotes = [...mergedRemotes, ...staleRemotes];
    const selected = await vscode.window.showQuickPick(
      allRemotes.map((b) => ({
        label: b.name,
        description: b.isMerged ? 'merged' : `${b.daysOld}d old`,
        picked: false,
        branch: b,
      })),
      { canPickMany: true, placeHolder: 'Select remote branches to delete' }
    );
    if (selected) {
      toDelete = selected.map((s) => (s as any).branch);
    }
  }

  if (toDelete.length === 0) return;

  const confirm = await vscode.window.showWarningMessage(
    `Delete ${toDelete.length} remote branch${toDelete.length > 1 ? 'es' : ''}? This cannot be undone.`,
    { modal: true },
    'Delete'
  );

  if (confirm !== 'Delete') return;

  await vscode.window.withProgress(
    { location: vscode.ProgressLocation.Notification, title: 'Deleting remote branches' },
    async (progress) => {
      let deleted = 0, failed = 0;

      for (const branch of toDelete) {
        progress.report({ increment: 100 / toDelete.length, message: branch.name });

        try {
          await gitCommand(['push', branch.remote, '--delete', branch.name], gitRoot);
          deleted++;
        } catch {
          failed++;
        }
      }

      if (failed === 0) {
        vscode.window.showInformationMessage(`Deleted ${deleted} remote branch${deleted > 1 ? 'es' : ''}`);
      } else {
        vscode.window.showWarningMessage(`Deleted ${deleted}, failed ${failed}`);
      }
    }
  );
}
