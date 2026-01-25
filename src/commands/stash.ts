import * as vscode from 'vscode';
import { getGitRoot, getStashInfo, createStash, popStash } from '../git';

/**
 * Quick stash command handler.
 * @param updateStatusBar - Optional callback to update status bar
 */
export async function quickStash(updateStatusBar?: () => Promise<void>): Promise<void> {
  const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
  if (!workspaceFolder) {
    vscode.window.showErrorMessage('Not in a Git repository');
    return;
  }

  const gitRoot = await getGitRoot(workspaceFolder.uri.fsPath);
  if (!gitRoot) {
    vscode.window.showErrorMessage('Not in a Git repository');
    return;
  }

  const options: vscode.QuickPickItem[] = [
    { label: 'Stash changes', description: 'Stash tracked files only' },
    { label: 'Stash all', description: 'Include untracked files' },
    { label: 'Stash with message', description: 'Add a custom message' },
  ];

  const choice = await vscode.window.showQuickPick(options, {
    placeHolder: 'How would you like to stash?',
  });

  if (!choice) return;

  let message: string | undefined;
  let includeUntracked = false;

  if (choice.label === 'Stash all') {
    includeUntracked = true;
  } else if (choice.label === 'Stash with message') {
    message = await vscode.window.showInputBox({
      prompt: 'Enter stash message',
      placeHolder: 'WIP: description of changes',
    });
    if (message === undefined) return;
  }

  const success = await createStash(gitRoot, message, includeUntracked);
  if (success) {
    vscode.window.showInformationMessage('Changes stashed successfully');
    if (updateStatusBar) {
      await updateStatusBar();
    }
  } else {
    vscode.window.showErrorMessage('Failed to stash changes. Make sure you have changes to stash.');
  }
}

/**
 * Pop latest stash command handler.
 * @param updateStatusBar - Optional callback to update status bar
 */
export async function quickStashPop(updateStatusBar?: () => Promise<void>): Promise<void> {
  const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
  if (!workspaceFolder) {
    vscode.window.showErrorMessage('Not in a Git repository');
    return;
  }

  const gitRoot = await getGitRoot(workspaceFolder.uri.fsPath);
  if (!gitRoot) {
    vscode.window.showErrorMessage('Not in a Git repository');
    return;
  }

  const stashes = await getStashInfo(gitRoot);
  if (stashes.length === 0) {
    vscode.window.showInformationMessage('No stashes to pop');
    return;
  }

  const success = await popStash(gitRoot, 0);
  if (success) {
    vscode.window.showInformationMessage('Stash popped successfully');
    if (updateStatusBar) {
      await updateStatusBar();
    }
  } else {
    vscode.window.showErrorMessage('Failed to pop stash. There may be conflicts.');
  }
}
