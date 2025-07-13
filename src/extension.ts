import * as vscode from 'vscode';
import * as cp from 'child_process';
import { promisify } from 'util';

const exec = promisify(cp.exec);

function getNonce() {
  let text = '';
  const possible =
    'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  for (let i = 0; i < 32; i++) {
    text += possible.charAt(Math.floor(Math.random() * possible.length));
  }
  return text;
}

interface BranchInfo {
  name: string;
  isMerged: boolean;
  lastCommitDate: Date;
  daysOld: number;
  isCurrentBranch: boolean;
  ahead?: number;
  behind?: number;
}

interface BranchTemplate {
  name: string;
  pattern: string;
  example: string;
}

const BRANCH_TEMPLATES: BranchTemplate[] = [
  {
    name: 'Feature',
    pattern: 'feature/{description}',
    example: 'feature/add-user-auth',
  },
  {
    name: 'Bugfix',
    pattern: 'bugfix/{description}',
    example: 'bugfix/fix-login-error',
  },
  {
    name: 'Hotfix',
    pattern: 'hotfix/{description}',
    example: 'hotfix/critical-payment-fix',
  },
  {
    name: 'Release',
    pattern: 'release/{version}',
    example: 'release/v1.2.0',
  },
  {
    name: 'Experiment',
    pattern: 'exp/{description}',
    example: 'exp/new-algorithm',
  },
];

let globalStatusBarItem: vscode.StatusBarItem | undefined;

export function activate(context: vscode.ExtensionContext) {
  incrementUsageCount(context);

  let cleanupCommand = vscode.commands.registerCommand(
    'git-branch-manager.cleanup',
    () => {
      showBranchManager(context);
    }
  );
  context.subscriptions.push(cleanupCommand);

  let quickCleanupCommand = vscode.commands.registerCommand(
    'git-branch-manager.quickCleanup',
    () => {
      quickCleanup(context);
    }
  );
  context.subscriptions.push(quickCleanupCommand);

  let createBranchCommand = vscode.commands.registerCommand(
    'git-branch-manager.createBranch',
    () => {
      createBranchFromTemplate();
    }
  );
  context.subscriptions.push(createBranchCommand);

  const statusBarItem = vscode.window.createStatusBarItem(
    vscode.StatusBarAlignment.Left,
    100
  );
  statusBarItem.command = 'git-branch-manager.cleanup';
  globalStatusBarItem = statusBarItem;
  updateStatusBar(statusBarItem);
  statusBarItem.show();
  context.subscriptions.push(statusBarItem);

  const statusBarInterval = setInterval(
    () => updateStatusBar(statusBarItem),
    30000
  );

  const healthCheckTimeout = setTimeout(() => checkBranchHealth(), 5000);

  context.subscriptions.push({
    dispose: () => {
      clearInterval(statusBarInterval);
      clearTimeout(healthCheckTimeout);
    },
  });
}

async function updateGlobalStatusBar() {
  if (globalStatusBarItem) {
    await updateStatusBar(globalStatusBarItem);
  }
}

async function updateStatusBar(statusBarItem: vscode.StatusBarItem) {
  const gitRoot = await getGitRoot();
  if (!gitRoot) {
    statusBarItem.hide();
    return;
  }

  try {
    const branches = await getBranchInfo(gitRoot);
    const config = vscode.workspace.getConfiguration('gitBranchManager');
    const daysUntilStale = config.get<number>('daysUntilStale', 30);
    const cleanupCount = branches.filter(
      (b) => !b.isCurrentBranch && (b.isMerged || b.daysOld > daysUntilStale)
    ).length;

    if (cleanupCount > 0) {
      statusBarItem.text = `$(git-branch) ${cleanupCount} branches to clean`;
      statusBarItem.tooltip = `Click to clean ${cleanupCount} old or merged branches`;
      statusBarItem.backgroundColor = new vscode.ThemeColor(
        'statusBarItem.warningBackground'
      );
    } else {
      statusBarItem.text = '$(git-branch) Branches';
      statusBarItem.tooltip = 'Git branches are clean';
      statusBarItem.backgroundColor = undefined;
    }
    statusBarItem.show();
  } catch (error) {
    statusBarItem.hide();
  }
}

async function getGitRoot(): Promise<string | undefined> {
  const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
  if (!workspaceFolder) {
    return undefined;
  }

  try {
    const { stdout } = await exec('git rev-parse --show-toplevel', {
      cwd: workspaceFolder.uri.fsPath,
    });
    return stdout.trim();
  } catch {
    return undefined;
  }
}

async function getCurrentBranch(cwd: string): Promise<string> {
  const { stdout } = await exec('git branch --show-current', { cwd });
  return stdout.trim();
}

async function getBaseBranch(cwd: string): Promise<string> {
  try {
    const { stdout } = await exec('git symbolic-ref refs/remotes/origin/HEAD', {
      cwd,
    });
    return stdout.trim().replace('refs/remotes/origin/', '');
  } catch {
    const { stdout } = await exec('git branch -r', { cwd });
    if (stdout.includes('origin/main')) {
      return 'main';
    }
    if (stdout.includes('origin/master')) {
      return 'master';
    }
    return 'main';
  }
}

async function getBranchInfo(cwd: string): Promise<BranchInfo[]> {
  const branches: BranchInfo[] = [];

  try {
    const { stdout: branchCheck } = await exec('git branch', { cwd });
    if (!branchCheck.trim()) {
      return [];
    }

    const currentBranch = await getCurrentBranch(cwd);
    const baseBranch = await getBaseBranch(cwd);

    const config = vscode.workspace.getConfiguration('gitBranchManager');
    const protectedBranches = config.get<string[]>('protectedBranches', [
      'main',
      'master',
      'develop',
      'dev',
      'staging',
      'production',
    ]);

    const { stdout: mergedBranches } = await exec(
      `git branch --merged ${JSON.stringify(
        baseBranch
      )} --format="%(refname:short)"`,
      { cwd }
    );
    const mergedSet = new Set(
      mergedBranches
        .trim()
        .split('\n')
        .filter((b) => b)
    );

    const { stdout: localBranches } = await exec(
      'git branch --format="%(refname:short)"',
      { cwd }
    );

    for (const branch of localBranches.trim().split('\n')) {
      if (!branch) {
        continue;
      }

      if (protectedBranches.includes(branch)) {
        continue;
      }

      try {
        const isMerged = mergedSet.has(branch);

        const { stdout: dateStr } = await exec(
          `git log -1 --format=%ct ${JSON.stringify(branch)}`,
          { cwd }
        );
        const timestamp = parseInt(dateStr.trim());
        const lastCommitDate = new Date(timestamp * 1000);
        const daysOld = isNaN(timestamp)
          ? 0
          : Math.floor(
              (Date.now() - lastCommitDate.getTime()) / (1000 * 60 * 60 * 24)
            );

        let ahead = 0;
        let behind = 0;
        if (!isMerged && branch !== currentBranch) {
          try {
            const { stdout: revList } = await exec(
              `git rev-list --left-right --count ${JSON.stringify(
                baseBranch
              )}...${JSON.stringify(branch)}`,
              { cwd }
            );
            const [behindStr, aheadStr] = revList.trim().split('\t');
            behind = parseInt(behindStr) || 0;
            ahead = parseInt(aheadStr) || 0;
          } catch {
          }
        }

        branches.push({
          name: branch,
          isMerged,
          lastCommitDate,
          daysOld,
          isCurrentBranch: branch === currentBranch,
          ahead,
          behind,
        });
      } catch (error) {
        console.error(`Error getting info for branch ${branch}:`, error);
      }
    }
  } catch (error) {
    console.error('Error getting branch info:', error);
    return [];
  }

  return branches;
}

async function createBranchFromTemplate() {
  const gitRoot = await getGitRoot();
  if (!gitRoot) {
    vscode.window.showErrorMessage('Not in a Git repository');
    return;
  }

  try {
    await exec('git log -1', { cwd: gitRoot });
  } catch {
    await vscode.window.showErrorMessage(
      'Cannot create a branch: Your repository has no commits yet. Please make an initial commit first.',
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
    {
      placeHolder: 'Select a branch template',
      matchOnDescription: true,
    }
  );

  if (!selected) {
    return;
  }

  const description = await vscode.window.showInputBox({
    prompt: `Enter ${
      selected.template.pattern.includes('version') ? 'version' : 'description'
    }`,
    placeHolder: selected.template.pattern.includes('version')
      ? 'v1.2.0'
      : 'brief-description',
    validateInput: (value) => {
      if (!value) {
        return 'Value is required';
      }
      if (
        value.includes(' ') &&
        !selected.template.pattern.includes('version')
      ) {
        return 'Use hyphens instead of spaces';
      }
      return null;
    },
  });

  if (!description) {
    return;
  }

  const branchName = selected.template.pattern
    .replace('{description}', description)
    .replace('{version}', description);

  try {
    await exec(`git checkout -b ${JSON.stringify(branchName)}`, {
      cwd: gitRoot,
    });
    vscode.window.showInformationMessage(
      `Created and switched to branch: ${branchName}`
    );
    await updateGlobalStatusBar();
  } catch (error: any) {
    if (error.message.includes('already exists')) {
      vscode.window.showErrorMessage(`Branch '${branchName}' already exists`);
    } else {
      vscode.window.showErrorMessage(
        `Failed to create branch: ${error.message}`
      );
    }
  }
}

async function quickCleanup(context?: vscode.ExtensionContext) {
  const gitRoot = await getGitRoot();
  if (!gitRoot) {
    vscode.window.showErrorMessage('Not in a Git repository');
    return;
  }

  const branches = await getBranchInfo(gitRoot);
  const toDelete = branches.filter((b) => !b.isCurrentBranch && b.isMerged);

  if (toDelete.length === 0) {
    vscode.window.showInformationMessage('No merged branches to clean up.');
    return;
  }

  const message =
    `Found ${toDelete.length} merged branch${
      toDelete.length > 1 ? 'es' : ''
    } to delete:\n\n` + toDelete.map((b) => `• ${b.name}`).join('\n');

  const result = await vscode.window.showWarningMessage(
    message,
    { modal: true },
    'Delete All',
    'View Details'
  );

  if (result === 'Delete All') {
    await deleteMultipleBranches(
      gitRoot,
      toDelete.map((b) => b.name),
      context
    );
    if (context && toDelete.length > 0) {
      incrementUsageCount(context);
    }
    await updateGlobalStatusBar();
  } else if (result === 'View Details') {
    vscode.commands.executeCommand('git-branch-manager.cleanup');
  }
}

async function showBranchManager(context: vscode.ExtensionContext) {
  const gitRoot = await getGitRoot();
  if (!gitRoot) {
    const result = await vscode.window.showErrorMessage(
      'This is not a Git repository. Would you like to initialize one?',
      'Initialize Git',
      'Cancel'
    );

    if (result === 'Initialize Git') {
      const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
      if (workspaceFolder) {
        try {
          await exec('git init', { cwd: workspaceFolder.uri.fsPath });
          vscode.window.showInformationMessage(
            'Git repository initialized. You can now create your first branch.'
          );
          setTimeout(() => showBranchManager(context), 500);
        } catch (error) {
          vscode.window.showErrorMessage('Failed to initialize Git repository');
        }
      }
    }
    return;
  }

  const branches = await getBranchInfo(gitRoot);

  const config = vscode.workspace.getConfiguration('gitBranchManager');
  const protectedBranches = config.get<string[]>('protectedBranches', [
    'main',
    'master',
    'develop',
    'dev',
    'staging',
    'production',
  ]);

  if (branches.length === 0) {
    try {
      await exec('git log -1', { cwd: gitRoot });
    } catch {
      const result = await vscode.window.showInformationMessage(
        'Your repository has no branches yet. Would you like to create your first branch?',
        'Create Main Branch',
        'Create Custom Branch',
        'Cancel'
      );

      if (result === 'Create Main Branch') {
        try {
          await exec('git checkout -b main', { cwd: gitRoot });
          vscode.window.showInformationMessage(
            'Created main branch. You can now start committing.'
          );
          setTimeout(() => showBranchManager(context), 500);
        } catch (error: any) {
          if (error.message.includes('does not have any commits yet')) {
            vscode.window.showErrorMessage(
              'Cannot create branch: Please make an initial commit first.'
            );
          } else {
            vscode.window.showErrorMessage(
              'Failed to create main branch. Make sure you have at least one commit.'
            );
          }
        }
      } else if (result === 'Create Custom Branch') {
        vscode.commands.executeCommand('git-branch-manager.createBranch');
      }
      return;
    }
  }

  const panel = vscode.window.createWebviewPanel(
    'gitBranchManager',
    'Git Branch Manager',
    vscode.ViewColumn.One,
    {
      enableScripts: true,
      retainContextWhenHidden: true,
    }
  );

  const nonce = getNonce();
  panel.webview.html = getWebviewContent(
    branches,
    protectedBranches,
    panel.webview.cspSource,
    nonce
  );

  panel.webview.onDidReceiveMessage(
    async (message) => {
      switch (message.command) {
        case 'deleteBranch':
          const deleteResult = await deleteBranch(
            gitRoot,
            message.branch,
            context
          );
          if (deleteResult) {
            incrementUsageCount(context);
            const updatedBranches = await getBranchInfo(gitRoot);
            const updatedNonce = getNonce();
            panel.webview.html = getWebviewContent(
              updatedBranches,
              protectedBranches,
              panel.webview.cspSource,
              updatedNonce
            );
            await updateGlobalStatusBar();
          }
          break;

        case 'deleteMultiple':
          await deleteMultipleBranches(gitRoot, message.branches, context);
          if (message.branches.length > 0) {
            incrementUsageCount(context);
          }
          const refreshedBranches = await getBranchInfo(gitRoot);
          const refreshedNonce = getNonce();
          panel.webview.html = getWebviewContent(
            refreshedBranches,
            protectedBranches,
            panel.webview.cspSource,
            refreshedNonce
          );
          await updateGlobalStatusBar();
          break;

        case 'confirmDeleteMultiple':
          const confirmResult = await vscode.window.showWarningMessage(
            `Delete ${message.branches.length} ${message.type} branch${message.branches.length > 1 ? 'es' : ''}?\n\n${message.branches.join('\n')}`,
            { modal: true },
            'Delete',
            'Cancel'
          );
          if (confirmResult === 'Delete') {
            await deleteMultipleBranches(gitRoot, message.branches, context);
            if (message.branches.length > 0) {
              incrementUsageCount(context);
            }
            const confirmedBranches = await getBranchInfo(gitRoot);
            const confirmedNonce = getNonce();
            panel.webview.html = getWebviewContent(
              confirmedBranches,
              protectedBranches,
              panel.webview.cspSource,
              confirmedNonce
            );
            await updateGlobalStatusBar();
          }
          break;

        case 'showNoMergedBranches':
          vscode.window.showInformationMessage('No merged branches to clean.');
          break;

        case 'createBranch':
          panel.dispose();
          vscode.commands.executeCommand('git-branch-manager.createBranch');
          break;

        case 'refresh':
          const newBranches = await getBranchInfo(gitRoot);
          const newNonce = getNonce();
          panel.webview.html = getWebviewContent(
            newBranches,
            protectedBranches,
            panel.webview.cspSource,
            newNonce
          );
          await updateGlobalStatusBar();
          break;

        case 'openSupport':
          vscode.env.openExternal(
            vscode.Uri.parse('https://www.buymeacoffee.com/YonasValentin')
          );
          incrementUsageCount(context);
          break;

        case 'openGithub':
          vscode.env.openExternal(
            vscode.Uri.parse(
              'https://github.com/YonasValentin/git-branch-manager/issues'
            )
          );
          break;

        case 'openSponsor':
          vscode.env.openExternal(
            vscode.Uri.parse('https://github.com/sponsors/YonasValentin')
          );
          break;

        case 'openReview':
          const extensionId =
            'YonasValentinMougaardKristensen.git-branch-manager-pro';
          const reviewUrl = `https://marketplace.visualstudio.com/items?itemName=${extensionId}&ssr=false#review-details`;
          vscode.env.openExternal(vscode.Uri.parse(reviewUrl));
          context.globalState.update('hasReviewed', true);
          break;

        case 'switchBranch':
          await switchBranch(gitRoot, message.branch);
          const updatedAfterSwitch = await getBranchInfo(gitRoot);
          const switchNonce = getNonce();
          panel.webview.html = getWebviewContent(
            updatedAfterSwitch,
            protectedBranches,
            panel.webview.cspSource,
            switchNonce
          );
          break;
      }
    },
    undefined,
    context.subscriptions
  );
}

async function switchBranch(cwd: string, branchName: string) {
  const result = await vscode.window.showQuickPick(['Yes', 'No'], {
    placeHolder: `Switch to branch "${branchName}"?`,
  });

  if (result !== 'Yes') {
    return;
  }

  try {
    await exec(`git checkout ${JSON.stringify(branchName)}`, { cwd });
    vscode.window.showInformationMessage(`Switched to branch: ${branchName}`);
  } catch (error: any) {
    vscode.window.showErrorMessage(`Failed to switch branch: ${error.message}`);
  }
}

async function deleteBranch(
  cwd: string,
  branchName: string,
  context?: vscode.ExtensionContext
): Promise<boolean> {
  const config = vscode.workspace.getConfiguration('gitBranchManager');
  const confirmBeforeDelete = config.get<boolean>('confirmBeforeDelete', true);

  if (confirmBeforeDelete) {
    const result = await vscode.window.showWarningMessage(
      `Delete branch "${branchName}"?`,
      { modal: true },
      'Delete',
      'Cancel'
    );
    if (result !== 'Delete') {
      return false;
    }
  }

  try {
    // Use -- to prevent branch names from being interpreted as options
    await exec(`git branch -D -- ${JSON.stringify(branchName)}`, { cwd });
    vscode.window.showInformationMessage(`Deleted branch: ${branchName}`);

    if (context) {
      const totalDeleted = context.globalState.get<number>(
        'totalBranchesDeleted',
        0
      );
      context.globalState.update('totalBranchesDeleted', totalDeleted + 1);
    }
    return true;
  } catch (error: any) {
    vscode.window.showErrorMessage(
      `Failed to delete branch ${branchName}: ${error.message}`
    );
    return false;
  }
}

async function deleteMultipleBranches(
  cwd: string,
  branches: string[],
  context?: vscode.ExtensionContext
) {
  const progress = vscode.window.withProgress(
    {
      location: vscode.ProgressLocation.Notification,
      title: 'Deleting branches',
      cancellable: false,
    },
    async (progress) => {
      let deleted = 0;
      let failed = 0;

      for (let i = 0; i < branches.length; i++) {
        progress.report({
          increment: 100 / branches.length,
          message: `${branches[i]}...`,
        });

        try {
          await exec(`git branch -D -- ${JSON.stringify(branches[i])}`, {
            cwd,
          });
          deleted++;
        } catch {
          failed++;
        }
      }

      return { deleted, failed };
    }
  );

  const result = await progress;

  if (result.failed === 0) {
    vscode.window.showInformationMessage(
      `Deleted ${result.deleted} branch${result.deleted > 1 ? 'es' : ''}`
    );
  } else {
    vscode.window.showWarningMessage(
      `Deleted ${result.deleted} branch${result.deleted > 1 ? 'es' : ''}, ${
        result.failed
      } failed`
    );
  }

  if (context && result.deleted > 0) {
    const totalDeleted = context.globalState.get<number>(
      'totalBranchesDeleted',
      0
    );
    const successfulCleanups = context.globalState.get<number>(
      'successfulCleanups',
      0
    );

    context.globalState.update(
      'totalBranchesDeleted',
      totalDeleted + result.deleted
    );
    context.globalState.update('successfulCleanups', successfulCleanups + 1);

    await checkAndShowReviewRequest(context);
  }
}

async function checkBranchHealth() {
  const config = vscode.workspace.getConfiguration('gitBranchManager');
  if (!config.get('showNotifications', true)) {
    return;
  }

  const gitRoot = await getGitRoot();
  if (!gitRoot) {
    return;
  }

  const branches = await getBranchInfo(gitRoot);
  const daysUntilStale = config.get<number>('daysUntilStale', 30);
  const cleanupCandidates = branches.filter(
    (b) => !b.isCurrentBranch && (b.isMerged || b.daysOld > daysUntilStale)
  );

  if (cleanupCandidates.length >= 5) {
    const result = await vscode.window.showInformationMessage(
      `You have ${cleanupCandidates.length} branches that could be cleaned up`,
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

function formatAge(days: number): string {
  if (isNaN(days) || days < 0) {
    return 'unknown';
  }
  if (days === 0) {
    return 'today';
  }
  if (days === 1) {
    return 'yesterday';
  }
  if (days < 7) {
    return `${days} days ago`;
  }
  if (days < 30) {
    return `${Math.floor(days / 7)} weeks ago`;
  }
  if (days < 365) {
    return `${Math.floor(days / 30)} months ago`;
  }
  return `${Math.floor(days / 365)} years ago`;
}

function getWebviewContent(
  branches: BranchInfo[],
  protectedBranches: string[] = [],
  cspSource: string,
  nonce: string
): string {
  const config = vscode.workspace.getConfiguration('gitBranchManager');
  const daysUntilStale = config.get<number>('daysUntilStale', 30);

  const merged = branches.filter((b) => b.isMerged && !b.isCurrentBranch);
  const old = branches.filter(
    (b) => !b.isMerged && b.daysOld > daysUntilStale && !b.isCurrentBranch
  );
  const active = branches.filter(
    (b) => !b.isMerged && b.daysOld <= daysUntilStale && !b.isCurrentBranch
  );

  const escapeHtml = (str: string): string => {
    return str
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  };

  return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${cspSource} 'unsafe-inline'; script-src 'nonce-${nonce}';">
    <title>Branch Manager</title>
    <style>
        body {
            font-family: var(--vscode-font-family);
            font-size: 13px;
            color: var(--vscode-foreground);
            background: var(--vscode-editor-background);
            padding: 12px;
            margin: 0;
        }
        .header {
            display: flex;
            justify-content: space-between;
            align-items: center;
            margin-bottom: 12px;
            padding-bottom: 8px;
            border-bottom: 1px solid var(--vscode-panel-border);
        }
        h1 { margin: 0; font-size: 14px; font-weight: 600; }
        .actions-bar { display: flex; gap: 6px; margin-bottom: 12px; }
        .stats-bar {
            display: flex;
            gap: 16px;
            margin-bottom: 16px;
            font-size: 12px;
            opacity: 0.8;
        }
        .stats-bar .warn { color: var(--vscode-editorWarning-foreground); }
        .section { margin-bottom: 16px; }
        .section-header {
            display: flex;
            justify-content: space-between;
            align-items: center;
            margin-bottom: 6px;
            font-weight: 500;
        }
        .section-header label { display: flex; align-items: center; gap: 6px; cursor: pointer; }
        .branch-list { list-style: none; padding: 0; margin: 0; }
        .branch-item {
            display: flex;
            align-items: center;
            gap: 8px;
            padding: 4px 8px;
            margin-bottom: 1px;
            background: var(--vscode-list-inactiveSelectionBackground);
            border-radius: 3px;
        }
        .branch-item:hover { background: var(--vscode-list-hoverBackground); }
        .branch-name { flex: 1; font-weight: 500; }
        .branch-meta { font-size: 11px; opacity: 0.6; margin-right: 8px; }
        .badge {
            font-size: 10px;
            padding: 1px 4px;
            background: var(--vscode-badge-background);
            color: var(--vscode-badge-foreground);
            border-radius: 3px;
        }
        button {
            background: var(--vscode-button-background);
            color: var(--vscode-button-foreground);
            border: none;
            padding: 3px 10px;
            border-radius: 3px;
            cursor: pointer;
            font-size: 11px;
        }
        button:hover:not(:disabled) { background: var(--vscode-button-hoverBackground); }
        button:disabled { opacity: 0.5; cursor: not-allowed; }
        button.secondary {
            background: var(--vscode-button-secondaryBackground);
            color: var(--vscode-button-secondaryForeground);
        }
        button.secondary:hover:not(:disabled) { background: var(--vscode-button-secondaryHoverBackground); }
        button.danger {
            background: var(--vscode-inputValidation-errorBackground);
            color: var(--vscode-inputValidation-errorForeground);
            border: 1px solid var(--vscode-inputValidation-errorBorder);
        }
        .empty-msg { opacity: 0.5; padding: 16px 0; }
        details.protected { margin-top: 16px; font-size: 11px; opacity: 0.6; }
        details.protected summary { cursor: pointer; }
        details.protected p { margin: 8px 0 0 0; }
        .footer { margin-top: 16px; font-size: 11px; opacity: 0.5; display: flex; gap: 12px; }
        .footer a { color: var(--vscode-textLink-foreground); text-decoration: none; }
        .footer a:hover { text-decoration: underline; }
        input[type="checkbox"] { width: 14px; height: 14px; cursor: pointer; }
    </style>
</head>
<body>
    <div class="header">
        <h1>Branch Manager</h1>
        <button id="refresh-btn" class="secondary">Refresh</button>
    </div>

    <div class="actions-bar">
        <button id="create-branch-btn" class="secondary">New Branch</button>
        <button id="quick-clean-btn" class="secondary">Clean Merged</button>
    </div>

    <div class="stats-bar">
        <span><strong>${branches.length}</strong> total</span>
        <span class="${merged.length > 0 ? 'warn' : ''}"><strong>${merged.length}</strong> merged</span>
        <span class="${old.length > 0 ? 'warn' : ''}"><strong>${old.length}</strong> stale</span>
        <span><strong>${active.length}</strong> active</span>
    </div>

    ${merged.length > 0 ? `
    <div class="section">
        <div class="section-header">
            <label><input type="checkbox" id="selectAllMerged" class="select-all" data-type="merged"> Merged (${merged.length})</label>
            <button class="danger" id="deleteMergedBtn" disabled>Delete Selected</button>
        </div>
        <ul class="branch-list">
            ${merged.map((b) => `
            <li class="branch-item">
                <input type="checkbox" class="merged-checkbox" data-branch="${escapeHtml(b.name)}">
                <span class="branch-name">${escapeHtml(b.name)}</span>
                <span class="branch-meta">${formatAge(b.daysOld)}</span>
                <button class="danger delete-btn" data-branch="${escapeHtml(b.name)}">Delete</button>
            </li>
            `).join('')}
        </ul>
    </div>
    ` : ''}

    ${old.length > 0 ? `
    <div class="section">
        <div class="section-header">
            <label><input type="checkbox" id="selectAllOld" class="select-all" data-type="old"> Stale (${old.length})</label>
            <button class="danger" id="deleteOldBtn" disabled>Delete Selected</button>
        </div>
        <ul class="branch-list">
            ${old.map((b) => `
            <li class="branch-item">
                <input type="checkbox" class="old-checkbox" data-branch="${escapeHtml(b.name)}">
                <span class="branch-name">${escapeHtml(b.name)}</span>
                <span class="branch-meta">${formatAge(b.daysOld)}</span>
                <button class="danger delete-btn" data-branch="${escapeHtml(b.name)}">Delete</button>
            </li>
            `).join('')}
        </ul>
    </div>
    ` : ''}

    ${active.length > 0 ? `
    <div class="section">
        <div class="section-header">
            <label><input type="checkbox" id="selectAllActive" class="select-all" data-type="active"> Active (${active.length})</label>
            <button class="danger" id="deleteActiveBtn" disabled>Delete Selected</button>
        </div>
        <ul class="branch-list">
            ${active.map((b) => `
            <li class="branch-item">
                <input type="checkbox" class="active-checkbox" data-branch="${escapeHtml(b.name)}">
                <span class="branch-name">${escapeHtml(b.name)}</span>
                <span class="branch-meta">${formatAge(b.daysOld)}${b.ahead || b.behind ? ` <span class="badge">${b.ahead ? `+${b.ahead}` : ''}${b.behind ? `-${b.behind}` : ''}</span>` : ''}</span>
                <button class="secondary switch-btn" data-branch="${escapeHtml(b.name)}">Switch</button>
                <button class="danger delete-btn" data-branch="${escapeHtml(b.name)}">Delete</button>
            </li>
            `).join('')}
        </ul>
    </div>
    ` : ''}

    ${merged.length === 0 && old.length === 0 ? `<p class="empty-msg">No branches need cleanup.</p>` : ''}

    ${protectedBranches.length > 0 ? `
    <details class="protected">
        <summary>Protected branches: ${protectedBranches.map(b => escapeHtml(b)).join(', ')}</summary>
        <p>Configure: <code>gitBranchManager.protectedBranches</code></p>
    </details>
    ` : ''}

    <div class="footer">
        <a href="#" id="sponsor-link">Sponsor</a>
        <a href="#" id="coffee-link">Buy Me a Coffee</a>
        <a href="#" id="github-link">Report Issue</a>
    </div>

    <script nonce="${nonce}">
    (function() {
        const vscode = acquireVsCodeApi();

        function decode(s) {
            const t = document.createElement('textarea');
            t.innerHTML = s;
            return t.value;
        }

        function updateCounts() {
            ['merged', 'old', 'active'].forEach(type => {
                const checked = document.querySelectorAll('.' + type + '-checkbox:checked').length;
                const btn = document.getElementById('delete' + type.charAt(0).toUpperCase() + type.slice(1) + 'Btn');
                if (btn) btn.disabled = checked === 0;
            });
        }

        document.getElementById('refresh-btn')?.addEventListener('click', () => {
            vscode.postMessage({ command: 'refresh' });
        });

        document.getElementById('create-branch-btn')?.addEventListener('click', () => {
            vscode.postMessage({ command: 'createBranch' });
        });

        document.getElementById('quick-clean-btn')?.addEventListener('click', () => {
            const branches = Array.from(document.querySelectorAll('.merged-checkbox')).map(cb => decode(cb.dataset.branch));
            if (branches.length === 0) {
                vscode.postMessage({ command: 'showNoMergedBranches' });
            } else {
                vscode.postMessage({ command: 'confirmDeleteMultiple', branches, type: 'merged' });
            }
        });

        document.querySelectorAll('.select-all').forEach(cb => {
            cb.addEventListener('change', e => {
                const type = e.target.dataset.type;
                document.querySelectorAll('.' + type + '-checkbox').forEach(c => c.checked = e.target.checked);
                updateCounts();
            });
        });

        document.querySelectorAll('input[type="checkbox"]:not(.select-all)').forEach(cb => {
            cb.addEventListener('change', updateCounts);
        });

        ['Merged', 'Old', 'Active'].forEach(type => {
            document.getElementById('delete' + type + 'Btn')?.addEventListener('click', () => {
                const checkboxes = document.querySelectorAll('.' + type.toLowerCase() + '-checkbox:checked');
                const branches = Array.from(checkboxes).map(cb => decode(cb.dataset.branch));
                if (branches.length > 0) {
                    vscode.postMessage({ command: 'confirmDeleteMultiple', branches, type: type.toLowerCase() });
                }
            });
        });

        document.querySelectorAll('.delete-btn').forEach(btn => {
            btn.addEventListener('click', e => {
                vscode.postMessage({ command: 'deleteBranch', branch: decode(e.target.dataset.branch) });
            });
        });

        document.querySelectorAll('.switch-btn').forEach(btn => {
            btn.addEventListener('click', e => {
                vscode.postMessage({ command: 'switchBranch', branch: decode(e.target.dataset.branch) });
            });
        });

        document.getElementById('sponsor-link')?.addEventListener('click', e => {
            e.preventDefault();
            vscode.postMessage({ command: 'openSponsor' });
        });

        document.getElementById('coffee-link')?.addEventListener('click', e => {
            e.preventDefault();
            vscode.postMessage({ command: 'openSupport' });
        });

        document.getElementById('github-link')?.addEventListener('click', e => {
            e.preventDefault();
            vscode.postMessage({ command: 'openGithub' });
        });
    })();
    </script>
</body>
</html>`;
}

export function deactivate() {}

async function checkAndShowReviewRequest(context: vscode.ExtensionContext) {
  const hasReviewed = context.globalState.get<boolean>('hasReviewed', false);
  const reviewRequestCount = context.globalState.get<number>('reviewRequestCount', 0);
  const lastReviewRequestDate = context.globalState.get<number>('lastReviewRequestDate', 0);
  const totalBranchesDeleted = context.globalState.get<number>('totalBranchesDeleted', 0);
  const successfulCleanups = context.globalState.get<number>('successfulCleanups', 0);

  if (hasReviewed || reviewRequestCount >= 3) {
    return;
  }

  const daysSinceLastRequest = (Date.now() - lastReviewRequestDate) / (1000 * 60 * 60 * 24);

  const shouldShowReview =
    (reviewRequestCount === 0 && (successfulCleanups >= 5 || totalBranchesDeleted >= 20)) ||
    (reviewRequestCount === 1 && successfulCleanups >= 10 && daysSinceLastRequest > 30) ||
    (reviewRequestCount === 2 && successfulCleanups >= 20 && daysSinceLastRequest > 60);

  if (shouldShowReview) {
    setTimeout(() => showReviewRequest(context), 2000);
  }
}

async function showReviewRequest(context: vscode.ExtensionContext) {
  const totalDeleted = context.globalState.get<number>('totalBranchesDeleted', 0);
  const messages = [
    `You've cleaned ${totalDeleted} branches. If this extension is useful, a quick review helps others find it.`,
    `${totalDeleted} branches cleaned. Reviews help other developers discover this tool.`,
    `${totalDeleted} branches deleted. If you have a moment, a review would be appreciated.`,
  ];

  const message = messages[Math.floor(Math.random() * messages.length)];

  const result = await vscode.window.showInformationMessage(
    message,
    'Leave a Review',
    'Maybe Later',
    "Don't Ask Again"
  );

  const reviewRequestCount = context.globalState.get<number>('reviewRequestCount', 0);

  if (result === 'Leave a Review') {
    const extensionId = 'YonasValentinMougaardKristensen.git-branch-manager-pro';
    const reviewUrl = `https://marketplace.visualstudio.com/items?itemName=${extensionId}&ssr=false#review-details`;
    vscode.env.openExternal(vscode.Uri.parse(reviewUrl));
    context.globalState.update('hasReviewed', true);
    vscode.window.showInformationMessage('Thanks for your review!');
  } else if (result === "Don't Ask Again") {
    context.globalState.update('hasReviewed', true);
  } else {
    context.globalState.update('reviewRequestCount', reviewRequestCount + 1);
  }

  context.globalState.update('lastReviewRequestDate', Date.now());
}

function incrementUsageCount(context: vscode.ExtensionContext) {
  const usageCount = context.globalState.get<number>('usageCount', 0);
  const hasShownSupport = context.globalState.get<boolean>('hasShownSupportMessage', false);
  const lastShownDate = context.globalState.get<number>('lastSupportMessageDate', 0);

  context.globalState.update('usageCount', usageCount + 1);

  const daysSinceLastShown = (Date.now() - lastShownDate) / (1000 * 60 * 60 * 24);

  if (
    (usageCount === 10 && !hasShownSupport) ||
    (usageCount > 10 && usageCount % 20 === 0 && daysSinceLastShown > 14)
  ) {
    showSupportMessage(context);
  }
}

async function showSupportMessage(context: vscode.ExtensionContext) {
  const usageCount = context.globalState.get<number>('usageCount', 0);
  const messages = [
    `You've used Git Branch Manager ${usageCount} times. If it's saving you time, consider supporting development.`,
    `${usageCount} cleanups completed. Your support helps fund continued development.`,
    `${usageCount} branch operations. Support helps keep this extension maintained.`,
  ];

  const message = messages[Math.floor(Math.random() * messages.length)];

  const result = await vscode.window.showInformationMessage(
    message,
    'Support Development',
    'Maybe Later',
    "Don't Show Again"
  );

  if (result === 'Support Development') {
    vscode.env.openExternal(
      vscode.Uri.parse('https://www.buymeacoffee.com/YonasValentin')
    );
    context.globalState.update('hasShownSupportMessage', true);
  } else if (result === "Don't Show Again") {
    context.globalState.update('hasShownSupportMessage', true);
  }

  context.globalState.update('lastSupportMessageDate', Date.now());
}
