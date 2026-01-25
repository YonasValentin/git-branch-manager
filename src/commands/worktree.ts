import * as vscode from 'vscode';
import { getGitRoot, getCurrentBranch, getBranchInfo, getWorktreeInfo, exec } from '../git';
import { formatAge } from '../utils';

/**
 * Creates a worktree from a branch.
 */
export async function createWorktreeFromBranch(): Promise<void> {
  const gitRoot = await getGitRoot();
  if (!gitRoot) {
    vscode.window.showErrorMessage('Not in a Git repository');
    return;
  }

  const branches = await getBranchInfo(gitRoot);
  const currentBranch = await getCurrentBranch(gitRoot);

  const items = branches
    .filter((b) => !b.isCurrentBranch)
    .map((b) => ({
      label: b.name,
      description: b.isMerged ? 'merged' : formatAge(b.daysOld),
      branch: b,
    }));

  const selected = await vscode.window.showQuickPick(items, {
    placeHolder: 'Select branch for worktree',
  });

  if (!selected) return;

  const worktreePath = await vscode.window.showInputBox({
    prompt: 'Enter worktree path',
    value: `../${selected.branch.name.replace(/\//g, '-')}`,
    validateInput: (value) => (!value ? 'Path is required' : null),
  });

  if (!worktreePath) return;

  try {
    await exec(`git worktree add ${JSON.stringify(worktreePath)} ${JSON.stringify(selected.branch.name)}`, { cwd: gitRoot });

    const openInNewWindow = await vscode.window.showInformationMessage(
      `Worktree created at ${worktreePath}`,
      'Open in New Window',
      'OK'
    );

    if (openInNewWindow === 'Open in New Window') {
      const fullPath = worktreePath.startsWith('/') ? worktreePath : `${gitRoot}/${worktreePath}`;
      vscode.commands.executeCommand('vscode.openFolder', vscode.Uri.file(fullPath), true);
    }
  } catch (error: any) {
    vscode.window.showErrorMessage(`Failed to create worktree: ${error.message}`);
  }
}

/**
 * Shows the worktree manager.
 * @param context - Extension context
 */
export async function showWorktreeManager(context: vscode.ExtensionContext): Promise<void> {
  const gitRoot = await getGitRoot();
  if (!gitRoot) {
    vscode.window.showErrorMessage('Not in a Git repository');
    return;
  }

  const worktrees = await getWorktreeInfo(gitRoot);

  if (worktrees.length <= 1) {
    const result = await vscode.window.showInformationMessage(
      'No additional worktrees found.',
      'Create Worktree',
      'Cancel'
    );
    if (result === 'Create Worktree') {
      vscode.commands.executeCommand('git-branch-manager.createWorktree');
    }
    return;
  }

  const items = worktrees.map((w) => ({
    label: w.branch,
    description: w.isMainWorktree ? '(main)' : w.path,
    detail: w.isLocked ? 'Locked' : w.prunable ? 'Prunable' : undefined,
    worktree: w,
  }));

  const selected = await vscode.window.showQuickPick(items, {
    placeHolder: 'Select worktree to manage',
  });

  if (!selected) return;

  if (selected.worktree.isMainWorktree) {
    vscode.window.showInformationMessage('Cannot modify main worktree');
    return;
  }

  const action = await vscode.window.showQuickPick(
    [
      { label: 'Open in New Window', action: 'open' },
      { label: 'Remove Worktree', action: 'remove' },
      { label: selected.worktree.isLocked ? 'Unlock Worktree' : 'Lock Worktree', action: 'toggle-lock' },
    ],
    { placeHolder: `Action for ${selected.worktree.branch}` }
  );

  if (!action) return;

  try {
    switch (action.action) {
      case 'open':
        vscode.commands.executeCommand('vscode.openFolder', vscode.Uri.file(selected.worktree.path), true);
        break;
      case 'remove':
        const confirm = await vscode.window.showWarningMessage(
          `Remove worktree for ${selected.worktree.branch}?`,
          { modal: true },
          'Remove'
        );
        if (confirm === 'Remove') {
          await exec(`git worktree remove ${JSON.stringify(selected.worktree.path)}`, { cwd: gitRoot });
          vscode.window.showInformationMessage('Worktree removed');
        }
        break;
      case 'toggle-lock':
        const lockCmd = selected.worktree.isLocked ? 'unlock' : 'lock';
        await exec(`git worktree ${lockCmd} ${JSON.stringify(selected.worktree.path)}`, { cwd: gitRoot });
        vscode.window.showInformationMessage(`Worktree ${lockCmd}ed`);
        break;
    }
  } catch (error: any) {
    vscode.window.showErrorMessage(`Operation failed: ${error.message}`);
  }
}
