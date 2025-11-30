import * as vscode from 'vscode';
import * as cp from 'child_process';
import { promisify } from 'util';

const exec = promisify(cp.exec);

/**
 * Generates a cryptographic nonce for Content Security Policy.
 * @returns A 32-character alphanumeric string
 */
function getNonce(): string {
  let text = '';
  const possible = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  for (let i = 0; i < 32; i++) {
    text += possible.charAt(Math.floor(Math.random() * possible.length));
  }
  return text;
}

/**
 * Branch information with health metrics and integration data.
 */
interface BranchInfo {
  name: string;
  isMerged: boolean;
  lastCommitDate: Date;
  daysOld: number;
  isCurrentBranch: boolean;
  ahead?: number;
  behind?: number;
  healthScore?: number;
  healthStatus?: 'healthy' | 'warning' | 'critical' | 'danger';
  healthReason?: string;
  prStatus?: PRStatus;
  linkedIssue?: string;
  author?: string;
  hasRemote?: boolean;
  remoteGone?: boolean;
  trackingBranch?: string;
}

/**
 * Pull request status from GitHub/GitLab.
 */
interface PRStatus {
  number: number;
  state: 'open' | 'closed' | 'merged' | 'draft';
  title: string;
  url: string;
  reviewStatus?: 'approved' | 'changes_requested' | 'pending' | 'none';
}

/**
 * Remote branch information for cleanup operations.
 */
interface RemoteBranchInfo {
  name: string;
  remote: string;
  lastCommitDate?: Date;
  daysOld?: number;
  isMerged: boolean;
  isGone: boolean;
  localBranch?: string;
}

/**
 * Git worktree information.
 */
interface WorktreeInfo {
  path: string;
  branch: string;
  isMainWorktree: boolean;
  isLocked: boolean;
  prunable: boolean;
}

/**
 * Git stash entry information.
 */
interface StashInfo {
  index: number;
  message: string;
  branch: string;
  date: Date;
  daysOld: number;
  filesChanged?: number;
  files?: string[];
}

/**
 * Branch template for quick creation.
 */
interface BranchTemplate {
  name: string;
  pattern: string;
  example: string;
}

/**
 * Search and filter state for the branch manager UI.
 */
interface SearchFilterState {
  query: string;
  statusFilters: Set<'merged' | 'stale' | 'orphaned' | 'active'>;
  healthFilters: Set<'healthy' | 'warning' | 'critical' | 'danger'>;
  sortField: 'name' | 'age' | 'health' | 'author';
  sortDirection: 'asc' | 'desc';
}

/**
 * Result of fuzzy matching with highlight information.
 */
interface FuzzyMatchResult {
  score: number;
  matchIndices: number[];
  text: string;
}

const BRANCH_TEMPLATES: BranchTemplate[] = [
  { name: 'Feature', pattern: 'feature/{description}', example: 'feature/add-user-auth' },
  { name: 'Bugfix', pattern: 'bugfix/{description}', example: 'bugfix/fix-login-error' },
  { name: 'Hotfix', pattern: 'hotfix/{description}', example: 'hotfix/critical-payment-fix' },
  { name: 'Release', pattern: 'release/{version}', example: 'release/v1.2.0' },
  { name: 'Experiment', pattern: 'exp/{description}', example: 'exp/new-algorithm' },
];

let globalStatusBarItem: vscode.StatusBarItem | undefined;
let gitHubSession: vscode.AuthenticationSession | undefined;

/**
 * Activates the extension.
 * @param context - Extension context for subscriptions and state
 */
export function activate(context: vscode.ExtensionContext) {
  incrementUsageCount(context);

  const cleanupCommand = vscode.commands.registerCommand('git-branch-manager.cleanup', () => {
    showBranchManager(context);
  });
  context.subscriptions.push(cleanupCommand);

  const quickCleanupCommand = vscode.commands.registerCommand('git-branch-manager.quickCleanup', () => {
    quickCleanup(context);
  });
  context.subscriptions.push(quickCleanupCommand);

  const createBranchCommand = vscode.commands.registerCommand('git-branch-manager.createBranch', () => {
    createBranchFromTemplate();
  });
  context.subscriptions.push(createBranchCommand);

  const cleanRemotesCommand = vscode.commands.registerCommand('git-branch-manager.cleanRemotes', () => {
    cleanRemoteBranches(context);
  });
  context.subscriptions.push(cleanRemotesCommand);

  const manageWorktreesCommand = vscode.commands.registerCommand('git-branch-manager.manageWorktrees', () => {
    showWorktreeManager(context);
  });
  context.subscriptions.push(manageWorktreesCommand);

  const createWorktreeCommand = vscode.commands.registerCommand('git-branch-manager.createWorktree', () => {
    createWorktreeFromBranch();
  });
  context.subscriptions.push(createWorktreeCommand);

  const stashCommand = vscode.commands.registerCommand('git-branch-manager.stash', () => {
    quickStash();
  });
  context.subscriptions.push(stashCommand);

  const stashPopCommand = vscode.commands.registerCommand('git-branch-manager.stashPop', () => {
    quickStashPop();
  });
  context.subscriptions.push(stashPopCommand);

  const statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 100);
  statusBarItem.command = 'git-branch-manager.cleanup';
  globalStatusBarItem = statusBarItem;
  updateStatusBar(statusBarItem);
  statusBarItem.show();
  context.subscriptions.push(statusBarItem);

  const statusBarInterval = setInterval(() => updateStatusBar(statusBarItem), 30000);
  const healthCheckTimeout = setTimeout(() => checkBranchHealth(), 5000);

  context.subscriptions.push({
    dispose: () => {
      clearInterval(statusBarInterval);
      clearTimeout(healthCheckTimeout);
    },
  });
}

/**
 * Updates the global status bar item.
 */
async function updateGlobalStatusBar() {
  if (globalStatusBarItem) {
    await updateStatusBar(globalStatusBarItem);
  }
}

/**
 * Updates the status bar with current branch cleanup count.
 * @param statusBarItem - The status bar item to update
 */
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
      (b) => !b.isCurrentBranch && (b.isMerged || b.daysOld > daysUntilStale || b.remoteGone)
    ).length;

    if (cleanupCount > 0) {
      statusBarItem.text = `$(git-branch) ${cleanupCount} to clean`;
      statusBarItem.tooltip = `${cleanupCount} branches ready for cleanup`;
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
 * Gets the Git root directory for the current workspace.
 * @returns The Git root path or undefined
 */
async function getGitRoot(): Promise<string | undefined> {
  const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
  if (!workspaceFolder) {
    return undefined;
  }

  try {
    const { stdout } = await exec('git rev-parse --show-toplevel', { cwd: workspaceFolder.uri.fsPath });
    return stdout.trim();
  } catch {
    return undefined;
  }
}

/**
 * Gets the current branch name.
 * @param cwd - Working directory
 * @returns Current branch name
 */
async function getCurrentBranch(cwd: string): Promise<string> {
  const { stdout } = await exec('git branch --show-current', { cwd });
  return stdout.trim();
}

/**
 * Determines the base branch for merge comparisons.
 * @param cwd - Working directory
 * @returns Base branch name (main, master, etc.)
 */
async function getBaseBranch(cwd: string): Promise<string> {
  try {
    const { stdout } = await exec('git symbolic-ref refs/remotes/origin/HEAD', { cwd });
    return stdout.trim().replace('refs/remotes/origin/', '');
  } catch {
    const { stdout } = await exec('git branch -r', { cwd });
    if (stdout.includes('origin/main')) return 'main';
    if (stdout.includes('origin/master')) return 'master';
    return 'main';
  }
}

/**
 * Calculates a health score for a branch.
 * @param branch - Branch information
 * @param config - Extension configuration
 * @returns Health score between 0-100
 */
function calculateHealthScore(branch: BranchInfo, daysUntilStale: number): number {
  let score = 100;

  if (branch.isMerged) {
    score -= 40;
  }

  if (branch.daysOld > daysUntilStale * 2) {
    score -= 30;
  } else if (branch.daysOld > daysUntilStale) {
    score -= 20;
  } else if (branch.daysOld > daysUntilStale / 2) {
    score -= 10;
  }

  if (branch.remoteGone) {
    score -= 20;
  }

  if (branch.behind && branch.behind > 50) {
    score -= 10;
  } else if (branch.behind && branch.behind > 20) {
    score -= 5;
  }

  return Math.max(0, Math.min(100, score));
}

/**
 * Determines health status from score.
 * @param score - Health score
 * @returns Status category
 */
function getHealthStatus(score: number): 'healthy' | 'warning' | 'critical' | 'danger' {
  if (score >= 80) return 'healthy';
  if (score >= 60) return 'warning';
  if (score >= 40) return 'critical';
  return 'danger';
}

/**
 * Generates a human-readable health reason.
 * @param branch - Branch information
 * @returns Reason string
 */
function getHealthReason(branch: BranchInfo): string {
  const reasons: string[] = [];
  if (branch.isMerged) reasons.push('merged');
  if (branch.daysOld > 60) reasons.push(`${branch.daysOld}d old`);
  if (branch.remoteGone) reasons.push('remote deleted');
  if (branch.behind && branch.behind > 20) reasons.push(`${branch.behind} behind`);
  return reasons.length > 0 ? reasons.join(', ') : 'active';
}

/**
 * Extracts issue number from branch name.
 * @param branchName - Branch name to parse
 * @returns Issue reference or undefined
 */
function extractIssueFromBranch(branchName: string): string | undefined {
  const patterns = [
    /(?:^|\/)(#?\d+)(?:[-_]|$)/,
    /(?:^|\/)([A-Z]+-\d+)(?:[-_]|$)/i,
    /(?:^|\/)(GH-\d+)(?:[-_]|$)/i,
  ];

  for (const pattern of patterns) {
    const match = branchName.match(pattern);
    if (match) return match[1];
  }
  return undefined;
}

/**
 * Gets comprehensive branch information.
 * @param cwd - Working directory
 * @returns Array of branch information
 */
async function getBranchInfo(cwd: string): Promise<BranchInfo[]> {
  const branches: BranchInfo[] = [];

  try {
    const { stdout: branchCheck } = await exec('git branch', { cwd });
    if (!branchCheck.trim()) return [];

    const currentBranch = await getCurrentBranch(cwd);
    const baseBranch = await getBaseBranch(cwd);

    const config = vscode.workspace.getConfiguration('gitBranchManager');
    const protectedBranches = config.get<string[]>('protectedBranches', [
      'main', 'master', 'develop', 'dev', 'staging', 'production',
    ]);
    const daysUntilStale = config.get<number>('daysUntilStale', 30);

    const { stdout: mergedBranches } = await exec(
      `git branch --merged ${JSON.stringify(baseBranch)} --format="%(refname:short)"`,
      { cwd }
    );
    const mergedSet = new Set(mergedBranches.trim().split('\n').filter((b) => b));

    const { stdout: localBranches } = await exec('git branch --format="%(refname:short)"', { cwd });

    let trackingInfo: Map<string, { remote: string; gone: boolean }> = new Map();
    try {
      const { stdout: trackingOutput } = await exec('git branch -vv', { cwd });
      for (const line of trackingOutput.split('\n')) {
        const match = line.match(/^\*?\s+(\S+)\s+\S+\s+\[([^\]]+)\]/);
        if (match) {
          const branchName = match[1];
          const trackingRef = match[2];
          const isGone = trackingRef.includes(': gone');
          trackingInfo.set(branchName, { remote: trackingRef.split(':')[0], gone: isGone });
        }
      }
    } catch {}

    for (const branch of localBranches.trim().split('\n')) {
      if (!branch || protectedBranches.includes(branch)) continue;

      try {
        const isMerged = mergedSet.has(branch);

        const { stdout: dateStr } = await exec(`git log -1 --format=%ct ${JSON.stringify(branch)}`, { cwd });
        const timestamp = parseInt(dateStr.trim());
        const lastCommitDate = new Date(timestamp * 1000);
        const daysOld = isNaN(timestamp) ? 0 : Math.floor((Date.now() - lastCommitDate.getTime()) / (1000 * 60 * 60 * 24));

        let ahead = 0, behind = 0;
        if (!isMerged && branch !== currentBranch) {
          try {
            const { stdout: revList } = await exec(
              `git rev-list --left-right --count ${JSON.stringify(baseBranch)}...${JSON.stringify(branch)}`,
              { cwd }
            );
            const [behindStr, aheadStr] = revList.trim().split('\t');
            behind = parseInt(behindStr) || 0;
            ahead = parseInt(aheadStr) || 0;
          } catch {}
        }

        let author: string | undefined;
        try {
          const { stdout: authorStr } = await exec(`git log -1 --format=%an ${JSON.stringify(branch)}`, { cwd });
          author = authorStr.trim();
        } catch {}

        const tracking = trackingInfo.get(branch);

        const branchInfo: BranchInfo = {
          name: branch,
          isMerged,
          lastCommitDate,
          daysOld,
          isCurrentBranch: branch === currentBranch,
          ahead,
          behind,
          author,
          linkedIssue: extractIssueFromBranch(branch),
          hasRemote: !!tracking,
          remoteGone: tracking?.gone || false,
          trackingBranch: tracking?.remote,
        };

        branchInfo.healthScore = calculateHealthScore(branchInfo, daysUntilStale);
        branchInfo.healthStatus = getHealthStatus(branchInfo.healthScore);
        branchInfo.healthReason = getHealthReason(branchInfo);

        branches.push(branchInfo);
      } catch (error) {
        console.error(`Error getting info for branch ${branch}:`, error);
      }
    }
  } catch (error) {
    console.error('Error getting branch info:', error);
    return [];
  }

  return branches.sort((a, b) => (a.healthScore || 100) - (b.healthScore || 100));
}

/**
 * Gets remote branch information for cleanup.
 * @param cwd - Working directory
 * @returns Array of remote branch information
 */
async function getRemoteBranchInfo(cwd: string): Promise<RemoteBranchInfo[]> {
  const remoteBranches: RemoteBranchInfo[] = [];

  try {
    await exec('git fetch --prune', { cwd });

    const baseBranch = await getBaseBranch(cwd);
    const config = vscode.workspace.getConfiguration('gitBranchManager');
    const protectedBranches = config.get<string[]>('protectedBranches', [
      'main', 'master', 'develop', 'dev', 'staging', 'production',
    ]);

    const { stdout: mergedRemotes } = await exec(
      `git branch -r --merged origin/${baseBranch} --format="%(refname:short)"`,
      { cwd }
    );
    const mergedSet = new Set(mergedRemotes.trim().split('\n').filter((b) => b));

    const { stdout: remotes } = await exec('git branch -r --format="%(refname:short)"', { cwd });

    for (const remoteBranch of remotes.trim().split('\n')) {
      if (!remoteBranch || remoteBranch.includes('HEAD')) continue;

      const [remote, ...nameParts] = remoteBranch.split('/');
      const branchName = nameParts.join('/');

      if (protectedBranches.includes(branchName)) continue;

      let daysOld = 0;
      let lastCommitDate: Date | undefined;
      try {
        const { stdout: dateStr } = await exec(`git log -1 --format=%ct ${JSON.stringify(remoteBranch)}`, { cwd });
        const timestamp = parseInt(dateStr.trim());
        lastCommitDate = new Date(timestamp * 1000);
        daysOld = isNaN(timestamp) ? 0 : Math.floor((Date.now() - lastCommitDate.getTime()) / (1000 * 60 * 60 * 24));
      } catch {}

      remoteBranches.push({
        name: branchName,
        remote,
        lastCommitDate,
        daysOld,
        isMerged: mergedSet.has(remoteBranch),
        isGone: false,
      });
    }
  } catch (error) {
    console.error('Error getting remote branch info:', error);
  }

  return remoteBranches;
}

/**
 * Gets worktree information.
 * @param cwd - Working directory
 * @returns Array of worktree information
 */
async function getWorktreeInfo(cwd: string): Promise<WorktreeInfo[]> {
  const worktrees: WorktreeInfo[] = [];

  try {
    const { stdout } = await exec('git worktree list --porcelain', { cwd });
    const entries = stdout.trim().split('\n\n');

    for (const entry of entries) {
      if (!entry.trim()) continue;

      const lines = entry.split('\n');
      const worktree: Partial<WorktreeInfo> = {};

      for (const line of lines) {
        if (line.startsWith('worktree ')) {
          worktree.path = line.substring(9);
        } else if (line.startsWith('branch ')) {
          worktree.branch = line.substring(7).replace('refs/heads/', '');
        } else if (line === 'bare') {
          worktree.isMainWorktree = true;
        } else if (line === 'locked') {
          worktree.isLocked = true;
        } else if (line === 'prunable') {
          worktree.prunable = true;
        }
      }

      if (worktree.path) {
        worktrees.push({
          path: worktree.path,
          branch: worktree.branch || '(detached)',
          isMainWorktree: worktree.isMainWorktree || entries.indexOf(entry) === 0,
          isLocked: worktree.isLocked || false,
          prunable: worktree.prunable || false,
        });
      }
    }
  } catch (error) {
    console.error('Error getting worktree info:', error);
  }

  return worktrees;
}

/**
 * Gets all stashes in the repository.
 * @param cwd - Working directory
 * @returns Array of stash information
 */
async function getStashInfo(cwd: string): Promise<StashInfo[]> {
  const stashes: StashInfo[] = [];

  try {
    const { stdout } = await exec('git stash list --format="%gd|%s|%ci"', { cwd });
    if (!stdout.trim()) return [];

    const lines = stdout.trim().split('\n');

    for (const line of lines) {
      const parts = line.split('|');
      if (parts.length < 3) continue;

      const refMatch = parts[0].match(/stash@\{(\d+)\}/);
      if (!refMatch) continue;

      const index = parseInt(refMatch[1]);
      const message = parts[1] || '';
      const dateStr = parts[2] || '';

      const branchMatch = message.match(/^(?:WIP )?[Oo]n ([^:]+):/);
      const branch = branchMatch ? branchMatch[1] : '';

      const date = new Date(dateStr);
      const daysOld = Math.floor((Date.now() - date.getTime()) / (1000 * 60 * 60 * 24));

      let filesChanged: number | undefined;
      try {
        const { stdout: statOutput } = await exec(`git stash show stash@{${index}} --stat`, { cwd });
        const fileMatch = statOutput.match(/(\d+) files? changed/);
        if (fileMatch) filesChanged = parseInt(fileMatch[1]);
      } catch {}

      let files: string[] = [];
      try {
        const { stdout: nameOnly } = await exec(`git stash show stash@{${index}} --name-only`, { cwd });
        files = nameOnly.trim().split('\n').filter(f => f);
      } catch {}

      stashes.push({ index, message, branch, date, daysOld, filesChanged, files });
    }
  } catch (error) {
    console.error('Error getting stash info:', error);
  }

  return stashes;
}

/**
 * Creates a new stash.
 * @param cwd - Working directory
 * @param message - Optional stash message
 * @param includeUntracked - Include untracked files
 * @returns Success status
 */
async function createStash(cwd: string, message?: string, includeUntracked?: boolean): Promise<boolean> {
  try {
    const untrackedFlag = includeUntracked ? '-u ' : '';
    const messageFlag = message ? `-m ${JSON.stringify(message)}` : '';
    await exec(`git stash push ${untrackedFlag}${messageFlag}`.trim(), { cwd });
    return true;
  } catch (error) {
    console.error('Error creating stash:', error);
    return false;
  }
}

/**
 * Applies a stash by index without removing it.
 * @param cwd - Working directory
 * @param index - Stash index
 * @returns Success status
 */
async function applyStash(cwd: string, index: number): Promise<boolean> {
  try {
    await exec(`git stash apply stash@{${index}}`, { cwd });
    return true;
  } catch (error) {
    console.error('Error applying stash:', error);
    return false;
  }
}

/**
 * Pops a stash by index (apply and remove).
 * @param cwd - Working directory
 * @param index - Stash index
 * @returns Success status
 */
async function popStash(cwd: string, index: number): Promise<boolean> {
  try {
    await exec(`git stash pop stash@{${index}}`, { cwd });
    return true;
  } catch (error) {
    console.error('Error popping stash:', error);
    return false;
  }
}

/**
 * Drops a stash by index.
 * @param cwd - Working directory
 * @param index - Stash index
 * @returns Success status
 */
async function dropStash(cwd: string, index: number): Promise<boolean> {
  try {
    await exec(`git stash drop stash@{${index}}`, { cwd });
    return true;
  } catch (error) {
    console.error('Error dropping stash:', error);
    return false;
  }
}

/**
 * Clears all stashes.
 * @param cwd - Working directory
 * @returns Success status
 */
async function clearStashes(cwd: string): Promise<boolean> {
  try {
    await exec('git stash clear', { cwd });
    return true;
  } catch (error) {
    console.error('Error clearing stashes:', error);
    return false;
  }
}

/**
 * Quick stash command handler.
 */
async function quickStash() {
  const gitRoot = await getGitRoot();
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
    await updateGlobalStatusBar();
  } else {
    vscode.window.showErrorMessage('Failed to stash changes. Make sure you have changes to stash.');
  }
}

/**
 * Pop latest stash command handler.
 */
async function quickStashPop() {
  const gitRoot = await getGitRoot();
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
    await updateGlobalStatusBar();
  } else {
    vscode.window.showErrorMessage('Failed to pop stash. There may be conflicts.');
  }
}

/**
 * Creates a branch from a template.
 */
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
    await exec(`git checkout -b ${JSON.stringify(branchName)}`, { cwd: gitRoot });
    vscode.window.showInformationMessage(`Created branch: ${branchName}`);
    await updateGlobalStatusBar();
  } catch (error: any) {
    if (error.message.includes('already exists')) {
      vscode.window.showErrorMessage(`Branch '${branchName}' already exists`);
    } else {
      vscode.window.showErrorMessage(`Failed to create branch: ${error.message}`);
    }
  }
}

/**
 * Creates a worktree from a branch.
 */
async function createWorktreeFromBranch() {
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
async function showWorktreeManager(context: vscode.ExtensionContext) {
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

/**
 * Cleans remote branches.
 * @param context - Extension context
 */
async function cleanRemoteBranches(context: vscode.ExtensionContext) {
  const gitRoot = await getGitRoot();
  if (!gitRoot) {
    vscode.window.showErrorMessage('Not in a Git repository');
    return;
  }

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
          await exec(`git push ${branch.remote} --delete ${JSON.stringify(branch.name)}`, { cwd: gitRoot });
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

/**
 * Quick cleanup of merged branches.
 * @param context - Extension context
 */
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

  const message = `Delete ${toDelete.length} merged branch${toDelete.length > 1 ? 'es' : ''}?\n\n` +
    toDelete.map((b) => `• ${b.name}`).join('\n');

  const result = await vscode.window.showWarningMessage(message, { modal: true }, 'Delete All', 'View Details');

  if (result === 'Delete All') {
    await deleteMultipleBranches(gitRoot, toDelete.map((b) => b.name), context);
    if (context && toDelete.length > 0) {
      incrementUsageCount(context);
    }
    await updateGlobalStatusBar();
  } else if (result === 'View Details') {
    vscode.commands.executeCommand('git-branch-manager.cleanup');
  }
}

/**
 * Shows the main branch manager UI.
 * @param context - Extension context
 */
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
          vscode.window.showInformationMessage('Git repository initialized.');
          setTimeout(() => showBranchManager(context), 500);
        } catch {
          vscode.window.showErrorMessage('Failed to initialize Git repository');
        }
      }
    }
    return;
  }

  const branches = await getBranchInfo(gitRoot);
  const remoteBranches = await getRemoteBranchInfo(gitRoot);
  const worktrees = await getWorktreeInfo(gitRoot);
  const stashes = await getStashInfo(gitRoot);

  const config = vscode.workspace.getConfiguration('gitBranchManager');
  const protectedBranches = config.get<string[]>('protectedBranches', [
    'main', 'master', 'develop', 'dev', 'staging', 'production',
  ]);

  if (branches.length === 0) {
    try {
      await exec('git log -1', { cwd: gitRoot });
    } catch {
      const result = await vscode.window.showInformationMessage(
        'Your repository has no branches yet.',
        'Create Main Branch',
        'Create Custom Branch',
        'Cancel'
      );

      if (result === 'Create Main Branch') {
        try {
          await exec('git checkout -b main', { cwd: gitRoot });
          vscode.window.showInformationMessage('Created main branch.');
          setTimeout(() => showBranchManager(context), 500);
        } catch (error: any) {
          if (error.message.includes('does not have any commits yet')) {
            vscode.window.showErrorMessage('Please make an initial commit first.');
          } else {
            vscode.window.showErrorMessage('Failed to create main branch.');
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
    { enableScripts: true, retainContextWhenHidden: true }
  );

  const nonce = getNonce();
  panel.webview.html = getWebviewContent(branches, remoteBranches, worktrees, stashes, protectedBranches, panel.webview.cspSource, nonce);

  panel.webview.onDidReceiveMessage(
    async (message) => {
      switch (message.command) {
        case 'deleteBranch':
          const deleteResult = await deleteBranch(gitRoot, message.branch, context);
          if (deleteResult) {
            incrementUsageCount(context);
            await refreshPanel();
          }
          break;

        case 'deleteMultiple':
          await deleteMultipleBranches(gitRoot, message.branches, context);
          if (message.branches.length > 0) {
            incrementUsageCount(context);
          }
          await refreshPanel();
          break;

        case 'confirmDeleteMultiple':
          const confirmResult = await vscode.window.showWarningMessage(
            `Delete ${message.branches.length} ${message.type} branch${message.branches.length > 1 ? 'es' : ''}?`,
            { modal: true },
            'Delete',
            'Cancel'
          );
          if (confirmResult === 'Delete') {
            await deleteMultipleBranches(gitRoot, message.branches, context);
            if (message.branches.length > 0) {
              incrementUsageCount(context);
            }
            await refreshPanel();
          }
          break;

        case 'deleteRemoteBranch':
          try {
            await exec(`git push origin --delete ${JSON.stringify(message.branch)}`, { cwd: gitRoot });
            vscode.window.showInformationMessage(`Deleted remote branch: ${message.branch}`);
            await refreshPanel();
          } catch (error: any) {
            vscode.window.showErrorMessage(`Failed to delete remote branch: ${error.message}`);
          }
          break;

        case 'showNoMergedBranches':
          vscode.window.showInformationMessage('No merged branches to clean.');
          break;

        case 'createBranch':
          panel.dispose();
          vscode.commands.executeCommand('git-branch-manager.createBranch');
          break;

        case 'createWorktree':
          panel.dispose();
          vscode.commands.executeCommand('git-branch-manager.createWorktree');
          break;

        case 'refresh':
          await refreshPanel();
          break;

        case 'openSupport':
          vscode.env.openExternal(vscode.Uri.parse('https://www.buymeacoffee.com/YonasValentin'));
          break;

        case 'openGithub':
          vscode.env.openExternal(vscode.Uri.parse('https://github.com/YonasValentin/git-branch-manager/issues'));
          break;

        case 'openSponsor':
          vscode.env.openExternal(vscode.Uri.parse('https://github.com/sponsors/YonasValentin'));
          break;

        case 'switchBranch':
          await switchBranch(gitRoot, message.branch);
          await refreshPanel();
          break;

        case 'pruneRemotes':
          try {
            await exec('git fetch --prune', { cwd: gitRoot });
            vscode.window.showInformationMessage('Pruned stale remote references');
            await refreshPanel();
          } catch (error: any) {
            vscode.window.showErrorMessage(`Failed to prune: ${error.message}`);
          }
          break;

        case 'createStash':
          const stashOptions: vscode.QuickPickItem[] = [
            { label: 'Stash changes', description: 'Stash tracked files only' },
            { label: 'Stash all', description: 'Include untracked files' },
            { label: 'Stash with message', description: 'Add a custom message' },
          ];
          const stashChoice = await vscode.window.showQuickPick(stashOptions, {
            placeHolder: 'How would you like to stash?',
          });
          if (stashChoice) {
            let stashMsg: string | undefined;
            let includeUntracked = false;
            if (stashChoice.label === 'Stash all') {
              includeUntracked = true;
            } else if (stashChoice.label === 'Stash with message') {
              stashMsg = await vscode.window.showInputBox({
                prompt: 'Enter stash message',
                placeHolder: 'WIP: description of changes',
              });
              if (stashMsg === undefined) break;
            }
            const cwd = gitRoot as string;
            const success = await createStash(cwd, stashMsg, includeUntracked);
            if (success) {
              vscode.window.showInformationMessage('Changes stashed successfully');
              await refreshPanel();
            } else {
              vscode.window.showErrorMessage('Failed to stash changes. Make sure you have changes to stash.');
            }
          }
          break;

        case 'applyStash':
          try {
            const cwd = gitRoot as string;
            const success = await applyStash(cwd, message.index);
            if (success) {
              vscode.window.showInformationMessage('Stash applied successfully');
              await refreshPanel();
            } else {
              vscode.window.showErrorMessage('Failed to apply stash. There may be conflicts.');
            }
          } catch (error: any) {
            vscode.window.showErrorMessage(`Failed to apply stash: ${error.message}`);
          }
          break;

        case 'popStash':
          try {
            const cwd = gitRoot as string;
            const success = await popStash(cwd, message.index);
            if (success) {
              vscode.window.showInformationMessage('Stash popped successfully');
              await refreshPanel();
            } else {
              vscode.window.showErrorMessage('Failed to pop stash. There may be conflicts.');
            }
          } catch (error: any) {
            vscode.window.showErrorMessage(`Failed to pop stash: ${error.message}`);
          }
          break;

        case 'dropStash':
          const confirmDrop = await vscode.window.showWarningMessage(
            `Drop stash@{${message.index}}? This cannot be undone.`,
            { modal: true },
            'Drop'
          );
          if (confirmDrop === 'Drop') {
            const cwd = gitRoot as string;
            const success = await dropStash(cwd, message.index);
            if (success) {
              vscode.window.showInformationMessage('Stash dropped');
              await refreshPanel();
            } else {
              vscode.window.showErrorMessage('Failed to drop stash');
            }
          }
          break;

        case 'clearStashes':
          const confirmClear = await vscode.window.showWarningMessage(
            'Clear all stashes? This cannot be undone.',
            { modal: true },
            'Clear All'
          );
          if (confirmClear === 'Clear All') {
            const cwd = gitRoot as string;
            const success = await clearStashes(cwd);
            if (success) {
              vscode.window.showInformationMessage('All stashes cleared');
              await refreshPanel();
            } else {
              vscode.window.showErrorMessage('Failed to clear stashes');
            }
          }
          break;
      }

      async function refreshPanel() {
        const cwd = gitRoot as string;
        const newBranches = await getBranchInfo(cwd);
        const newRemotes = await getRemoteBranchInfo(cwd);
        const newWorktrees = await getWorktreeInfo(cwd);
        const newStashes = await getStashInfo(cwd);
        const newNonce = getNonce();
        panel.webview.html = getWebviewContent(newBranches, newRemotes, newWorktrees, newStashes, protectedBranches, panel.webview.cspSource, newNonce);
        await updateGlobalStatusBar();
      }
    },
    undefined,
    context.subscriptions
  );
}

/**
 * Switches to a branch.
 * @param cwd - Working directory
 * @param branchName - Branch to switch to
 */
async function switchBranch(cwd: string, branchName: string) {
  const result = await vscode.window.showQuickPick(['Yes', 'No'], {
    placeHolder: `Switch to branch "${branchName}"?`,
  });

  if (result !== 'Yes') return;

  try {
    await exec(`git checkout ${JSON.stringify(branchName)}`, { cwd });
    vscode.window.showInformationMessage(`Switched to branch: ${branchName}`);
  } catch (error: any) {
    vscode.window.showErrorMessage(`Failed to switch branch: ${error.message}`);
  }
}

/**
 * Deletes a single branch.
 * @param cwd - Working directory
 * @param branchName - Branch to delete
 * @param context - Extension context
 * @returns Success status
 */
async function deleteBranch(cwd: string, branchName: string, context?: vscode.ExtensionContext): Promise<boolean> {
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
    await exec(`git branch -D -- ${JSON.stringify(branchName)}`, { cwd });
    vscode.window.showInformationMessage(`Deleted branch: ${branchName}`);

    if (context) {
      const totalDeleted = context.globalState.get<number>('totalBranchesDeleted', 0);
      context.globalState.update('totalBranchesDeleted', totalDeleted + 1);
    }
    return true;
  } catch (error: any) {
    vscode.window.showErrorMessage(`Failed to delete branch ${branchName}: ${error.message}`);
    return false;
  }
}

/**
 * Deletes multiple branches.
 * @param cwd - Working directory
 * @param branches - Branches to delete
 * @param context - Extension context
 */
async function deleteMultipleBranches(cwd: string, branches: string[], context?: vscode.ExtensionContext) {
  const result = await vscode.window.withProgress(
    { location: vscode.ProgressLocation.Notification, title: 'Deleting branches', cancellable: false },
    async (progress) => {
      let deleted = 0, failed = 0;

      for (let i = 0; i < branches.length; i++) {
        progress.report({ increment: 100 / branches.length, message: branches[i] });

        try {
          await exec(`git branch -D -- ${JSON.stringify(branches[i])}`, { cwd });
          deleted++;
        } catch {
          failed++;
        }
      }

      return { deleted, failed };
    }
  );

  if (result.failed === 0) {
    vscode.window.showInformationMessage(`Deleted ${result.deleted} branch${result.deleted > 1 ? 'es' : ''}`);
  } else {
    vscode.window.showWarningMessage(`Deleted ${result.deleted}, failed ${result.failed}`);
  }

  if (context && result.deleted > 0) {
    const totalDeleted = context.globalState.get<number>('totalBranchesDeleted', 0);
    const successfulCleanups = context.globalState.get<number>('successfulCleanups', 0);

    context.globalState.update('totalBranchesDeleted', totalDeleted + result.deleted);
    context.globalState.update('successfulCleanups', successfulCleanups + 1);

    await checkAndShowReviewRequest(context);
  }
}

/**
 * Checks branch health and shows notifications.
 */
async function checkBranchHealth() {
  const config = vscode.workspace.getConfiguration('gitBranchManager');
  if (!config.get('showNotifications', true)) return;

  const gitRoot = await getGitRoot();
  if (!gitRoot) return;

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
 * Formats age in human-readable format.
 * @param days - Number of days
 * @returns Formatted string
 */
function formatAge(days: number): string {
  if (isNaN(days) || days < 0) return 'unknown';
  if (days === 0) return 'today';
  if (days === 1) return 'yesterday';
  if (days < 7) return `${days}d ago`;
  if (days < 30) return `${Math.floor(days / 7)}w ago`;
  if (days < 365) return `${Math.floor(days / 30)}mo ago`;
  return `${Math.floor(days / 365)}y ago`;
}

/**
 * Escapes HTML special characters.
 * @param str - String to escape
 * @returns Escaped string
 */
function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * Gets the health status color.
 * @param status - Health status
 * @returns CSS color variable
 */
function getHealthColor(status?: string): string {
  switch (status) {
    case 'healthy': return 'var(--vscode-testing-iconPassed)';
    case 'warning': return 'var(--vscode-editorWarning-foreground)';
    case 'critical': return 'var(--vscode-editorError-foreground)';
    case 'danger': return 'var(--vscode-inputValidation-errorBorder)';
    default: return 'var(--vscode-foreground)';
  }
}

/**
 * Generates the webview HTML content.
 */
function getWebviewContent(
  branches: BranchInfo[],
  remoteBranches: RemoteBranchInfo[],
  worktrees: WorktreeInfo[],
  stashes: StashInfo[],
  protectedBranches: string[],
  cspSource: string,
  nonce: string
): string {
  const config = vscode.workspace.getConfiguration('gitBranchManager');
  const daysUntilStale = config.get<number>('daysUntilStale', 30);

  const merged = branches.filter((b) => b.isMerged && !b.isCurrentBranch);
  const stale = branches.filter((b) => !b.isMerged && b.daysOld > daysUntilStale && !b.isCurrentBranch);
  const orphaned = branches.filter((b) => b.remoteGone && !b.isCurrentBranch && !b.isMerged);
  const active = branches.filter((b) => !b.isMerged && b.daysOld <= daysUntilStale && !b.isCurrentBranch && !b.remoteGone);

  const mergedRemotes = remoteBranches.filter((b) => b.isMerged);

  const avgHealth = branches.length > 0
    ? Math.round(branches.reduce((sum, b) => sum + (b.healthScore || 100), 0) / branches.length)
    : 100;

  return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${cspSource} 'unsafe-inline'; script-src 'nonce-${nonce}';">
    <title>Branch Manager</title>
    <style>
        body { font-family: var(--vscode-font-family); font-size: 13px; color: var(--vscode-foreground); background: var(--vscode-editor-background); padding: 12px; margin: 0; }
        .header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 12px; padding-bottom: 8px; border-bottom: 1px solid var(--vscode-panel-border); }
        h1 { margin: 0; font-size: 14px; font-weight: 600; }
        .header-actions { display: flex; gap: 6px; }
        .tabs { display: flex; gap: 2px; margin-bottom: 12px; border-bottom: 1px solid var(--vscode-panel-border); }
        .tab { padding: 6px 12px; cursor: pointer; border: none; background: none; color: var(--vscode-foreground); opacity: 0.7; border-bottom: 2px solid transparent; }
        .tab:hover { opacity: 1; }
        .tab.active { opacity: 1; border-bottom-color: var(--vscode-focusBorder); }
        .tab-content { display: none; }
        .tab-content.active { display: block; }
        .health-bar { display: flex; align-items: center; gap: 12px; margin-bottom: 16px; padding: 8px 12px; background: var(--vscode-editor-inactiveSelectionBackground); border-radius: 4px; }
        .health-score { font-size: 24px; font-weight: 600; }
        .health-label { font-size: 11px; opacity: 0.7; }
        .stats-bar { display: flex; gap: 16px; font-size: 12px; opacity: 0.8; flex: 1; }
        .stats-bar .warn { color: var(--vscode-editorWarning-foreground); }
        .section { margin-bottom: 16px; }
        .section-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 6px; font-weight: 500; }
        .section-header label { display: flex; align-items: center; gap: 6px; cursor: pointer; }
        .branch-list { list-style: none; padding: 0; margin: 0; }
        .branch-item { display: flex; align-items: center; gap: 8px; padding: 4px 8px; margin-bottom: 1px; background: var(--vscode-list-inactiveSelectionBackground); border-radius: 3px; }
        .branch-item:hover { background: var(--vscode-list-hoverBackground); }
        .branch-name { flex: 1; font-weight: 500; display: flex; align-items: center; gap: 6px; }
        .branch-meta { font-size: 11px; opacity: 0.6; margin-right: 8px; }
        .health-dot { width: 8px; height: 8px; border-radius: 50%; }
        .badge { font-size: 10px; padding: 1px 4px; background: var(--vscode-badge-background); color: var(--vscode-badge-foreground); border-radius: 3px; }
        .badge.issue { background: var(--vscode-textLink-foreground); color: var(--vscode-editor-background); }
        .badge.orphan { background: var(--vscode-inputValidation-errorBackground); }
        button { background: var(--vscode-button-background); color: var(--vscode-button-foreground); border: none; padding: 3px 10px; border-radius: 3px; cursor: pointer; font-size: 11px; }
        button:hover:not(:disabled) { background: var(--vscode-button-hoverBackground); }
        button:disabled { opacity: 0.5; cursor: not-allowed; }
        button.secondary { background: var(--vscode-button-secondaryBackground); color: var(--vscode-button-secondaryForeground); }
        button.secondary:hover:not(:disabled) { background: var(--vscode-button-secondaryHoverBackground); }
        button.danger { background: var(--vscode-inputValidation-errorBackground); color: var(--vscode-inputValidation-errorForeground); border: 1px solid var(--vscode-inputValidation-errorBorder); }
        .empty-msg { opacity: 0.5; padding: 16px 0; }
        details.protected { margin-top: 16px; font-size: 11px; opacity: 0.6; }
        details.protected summary { cursor: pointer; }
        details.protected p { margin: 8px 0 0 0; }
        .footer { margin-top: 16px; font-size: 11px; opacity: 0.5; display: flex; gap: 12px; }
        .footer a { color: var(--vscode-textLink-foreground); text-decoration: none; }
        .footer a:hover { text-decoration: underline; }
        input[type="checkbox"] { width: 14px; height: 14px; cursor: pointer; }
        .worktree-item { display: flex; align-items: center; gap: 8px; padding: 6px 8px; background: var(--vscode-list-inactiveSelectionBackground); border-radius: 3px; margin-bottom: 2px; }
        .worktree-path { font-size: 11px; opacity: 0.6; }
        .stash-item { background: var(--vscode-list-inactiveSelectionBackground); border-radius: 3px; margin-bottom: 4px; }
        .stash-item[open] { background: var(--vscode-list-activeSelectionBackground); }
        .stash-summary { display: flex; align-items: center; gap: 12px; padding: 8px; cursor: pointer; list-style: none; }
        .stash-summary::-webkit-details-marker { display: none; }
        .stash-summary::before { content: '▶'; font-size: 10px; opacity: 0.5; transition: transform 0.15s; }
        .stash-item[open] .stash-summary::before { transform: rotate(90deg); }
        .stash-summary:hover { background: var(--vscode-list-hoverBackground); }
        .stash-info { flex: 1; display: flex; flex-direction: column; gap: 2px; }
        .stash-ref { font-size: 11px; opacity: 0.6; font-family: var(--vscode-editor-font-family); }
        .stash-message { font-weight: 500; }
        .stash-meta { display: flex; gap: 12px; font-size: 11px; opacity: 0.6; }
        .stash-actions { display: flex; gap: 4px; }
        .stash-files { padding: 8px 12px 12px 24px; border-top: 1px solid var(--vscode-panel-border); }
        .stash-file { font-family: var(--vscode-editor-font-family); font-size: 12px; padding: 2px 0; opacity: 0.8; }
        .stash-file::before { content: ''; display: inline-block; width: 12px; height: 12px; margin-right: 6px; background: var(--vscode-symbolIcon-fileForeground); mask: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 16 16'%3E%3Cpath d='M13 4H8.41L6 1.59A2 2 0 005.17 1H3a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2V6a2 2 0 00-2-2z'/%3E%3C/svg%3E") center/contain no-repeat; vertical-align: middle; }
        .search-container { margin-bottom: 12px; }
        .search-input-wrapper { position: relative; display: flex; align-items: center; }
        .search-input { width: 100%; padding: 6px 30px 6px 28px; background: var(--vscode-input-background); border: 1px solid var(--vscode-input-border, transparent); color: var(--vscode-input-foreground); border-radius: 4px; font-size: 13px; outline: none; }
        .search-input:focus { border-color: var(--vscode-focusBorder); }
        .search-input::placeholder { color: var(--vscode-input-placeholderForeground); }
        .search-icon { position: absolute; left: 8px; opacity: 0.6; pointer-events: none; }
        .search-clear { position: absolute; right: 6px; background: none; border: none; color: var(--vscode-foreground); opacity: 0.6; cursor: pointer; padding: 2px 4px; display: none; }
        .search-clear:hover { opacity: 1; }
        .search-input:not(:placeholder-shown) + .search-icon + .search-clear { display: block; }
        .filter-bar { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 8px; align-items: center; }
        .filter-chips { display: flex; flex-wrap: wrap; gap: 4px; }
        .filter-chip { padding: 3px 10px; border-radius: 12px; background: var(--vscode-button-secondaryBackground); color: var(--vscode-button-secondaryForeground); border: 1px solid transparent; font-size: 11px; cursor: pointer; transition: all 0.15s; }
        .filter-chip:hover { background: var(--vscode-button-secondaryHoverBackground); }
        .filter-chip[aria-pressed="true"] { background: var(--vscode-button-background); color: var(--vscode-button-foreground); border-color: var(--vscode-focusBorder); }
        .filter-chip.merged[aria-pressed="true"] { background: var(--vscode-editorWarning-foreground); color: var(--vscode-editor-background); }
        .filter-chip.stale[aria-pressed="true"] { background: var(--vscode-editorInfo-foreground); color: var(--vscode-editor-background); }
        .filter-chip.orphaned[aria-pressed="true"] { background: var(--vscode-editorError-foreground); color: var(--vscode-editor-background); }
        .filter-chip.active[aria-pressed="true"] { background: var(--vscode-testing-iconPassed); color: var(--vscode-editor-background); }
        .sort-dropdown { padding: 3px 8px; background: var(--vscode-dropdown-background); color: var(--vscode-dropdown-foreground); border: 1px solid var(--vscode-dropdown-border, transparent); border-radius: 4px; font-size: 11px; cursor: pointer; margin-left: auto; }
        .sort-dropdown:focus { border-color: var(--vscode-focusBorder); outline: none; }
        .result-count { font-size: 11px; opacity: 0.6; margin-left: 8px; }
        .no-results { padding: 24px; text-align: center; opacity: 0.6; }
        .no-results-icon { font-size: 32px; margin-bottom: 8px; }
        .highlight { background: var(--vscode-editor-findMatchHighlightBackground); border-radius: 2px; }
        .branch-item.hidden { display: none; }
    </style>
</head>
<body>
    <div class="header">
        <h1>Branch Manager</h1>
        <div class="header-actions">
            <button id="create-branch-btn" class="secondary">New Branch</button>
            <button id="refresh-btn" class="secondary">Refresh</button>
        </div>
    </div>

    <div class="tabs">
        <button class="tab active" data-tab="local">Local</button>
        <button class="tab" data-tab="remote">Remote</button>
        <button class="tab" data-tab="worktrees">Worktrees (${worktrees.length})</button>
        <button class="tab" data-tab="stashes">Stashes${stashes.length > 0 ? ` (${stashes.length})` : ''}</button>
    </div>

    <div id="local" class="tab-content active">
        <div class="search-container">
            <div class="search-input-wrapper">
                <input type="text" class="search-input" id="branch-search" placeholder="Search branches..." aria-label="Search branches">
                <span class="search-icon">⌕</span>
                <button class="search-clear" id="search-clear" aria-label="Clear search">✕</button>
            </div>
            <div class="filter-bar">
                <div class="filter-chips">
                    <button class="filter-chip merged" data-filter="merged" aria-pressed="false">Merged (${merged.length})</button>
                    <button class="filter-chip stale" data-filter="stale" aria-pressed="false">Stale (${stale.length})</button>
                    <button class="filter-chip orphaned" data-filter="orphaned" aria-pressed="false">Orphaned (${orphaned.length})</button>
                    <button class="filter-chip active" data-filter="active" aria-pressed="false">Active (${active.length})</button>
                </div>
                <select class="sort-dropdown" id="sort-select" aria-label="Sort branches">
                    <option value="health-asc">Health ↑</option>
                    <option value="health-desc">Health ↓</option>
                    <option value="name-asc">Name A-Z</option>
                    <option value="name-desc">Name Z-A</option>
                    <option value="age-asc">Newest first</option>
                    <option value="age-desc">Oldest first</option>
                </select>
                <span class="result-count" id="result-count"></span>
            </div>
        </div>
        <div id="no-results" class="no-results" style="display: none;">
            <div class="no-results-icon">🔍</div>
            <div>No branches match your search</div>
            <button class="secondary" id="clear-filters-btn" style="margin-top: 8px;">Clear Filters</button>
        </div>

        <div class="health-bar">
            <div>
                <div class="health-score" style="color: ${avgHealth >= 70 ? 'var(--vscode-testing-iconPassed)' : avgHealth >= 40 ? 'var(--vscode-editorWarning-foreground)' : 'var(--vscode-editorError-foreground)'}">${avgHealth}</div>
                <div class="health-label">Health Score</div>
            </div>
            <div class="stats-bar">
                <span><strong>${branches.length}</strong> total</span>
                <span class="${merged.length > 0 ? 'warn' : ''}"><strong>${merged.length}</strong> merged</span>
                <span class="${stale.length > 0 ? 'warn' : ''}"><strong>${stale.length}</strong> stale</span>
                <span class="${orphaned.length > 0 ? 'warn' : ''}"><strong>${orphaned.length}</strong> orphaned</span>
                <span><strong>${active.length}</strong> active</span>
            </div>
        </div>

        ${merged.length > 0 ? `
        <div class="section">
            <div class="section-header">
                <label><input type="checkbox" id="selectAllMerged" class="select-all" data-type="merged"> Merged (${merged.length})</label>
                <button class="danger" id="deleteMergedBtn" disabled>Delete Selected</button>
            </div>
            <ul class="branch-list">
                ${merged.map((b) => `
                <li class="branch-item" data-branch="${escapeHtml(b.name)}" data-status="merged" data-health="${b.healthStatus || 'healthy'}" data-age="${b.daysOld}" data-author="${escapeHtml(b.author || '')}">
                    <input type="checkbox" class="merged-checkbox" data-branch="${escapeHtml(b.name)}">
                    <span class="health-dot" style="background: ${getHealthColor(b.healthStatus)}" title="${b.healthReason || ''}"></span>
                    <span class="branch-name">${escapeHtml(b.name)}${b.linkedIssue ? ` <span class="badge issue">${escapeHtml(b.linkedIssue)}</span>` : ''}</span>
                    <span class="branch-meta">${formatAge(b.daysOld)}${b.author ? ` by ${escapeHtml(b.author)}` : ''}</span>
                    <button class="danger delete-btn" data-branch="${escapeHtml(b.name)}">Delete</button>
                </li>
                `).join('')}
            </ul>
        </div>
        ` : ''}

        ${orphaned.length > 0 ? `
        <div class="section">
            <div class="section-header">
                <label><input type="checkbox" id="selectAllOrphaned" class="select-all" data-type="orphaned"> Orphaned (${orphaned.length}) <span class="badge orphan">remote deleted</span></label>
                <button class="danger" id="deleteOrphanedBtn" disabled>Delete Selected</button>
            </div>
            <ul class="branch-list">
                ${orphaned.map((b) => `
                <li class="branch-item" data-branch="${escapeHtml(b.name)}" data-status="orphaned" data-health="${b.healthStatus || 'healthy'}" data-age="${b.daysOld}" data-author="${escapeHtml(b.author || '')}">
                    <input type="checkbox" class="orphaned-checkbox" data-branch="${escapeHtml(b.name)}">
                    <span class="health-dot" style="background: ${getHealthColor(b.healthStatus)}" title="${b.healthReason || ''}"></span>
                    <span class="branch-name">${escapeHtml(b.name)}</span>
                    <span class="branch-meta">${formatAge(b.daysOld)}</span>
                    <button class="danger delete-btn" data-branch="${escapeHtml(b.name)}">Delete</button>
                </li>
                `).join('')}
            </ul>
        </div>
        ` : ''}

        ${stale.length > 0 ? `
        <div class="section">
            <div class="section-header">
                <label><input type="checkbox" id="selectAllStale" class="select-all" data-type="stale"> Stale (${stale.length})</label>
                <button class="danger" id="deleteStaleBtn" disabled>Delete Selected</button>
            </div>
            <ul class="branch-list">
                ${stale.map((b) => `
                <li class="branch-item" data-branch="${escapeHtml(b.name)}" data-status="stale" data-health="${b.healthStatus || 'healthy'}" data-age="${b.daysOld}" data-author="${escapeHtml(b.author || '')}">
                    <input type="checkbox" class="stale-checkbox" data-branch="${escapeHtml(b.name)}">
                    <span class="health-dot" style="background: ${getHealthColor(b.healthStatus)}" title="${b.healthReason || ''}"></span>
                    <span class="branch-name">${escapeHtml(b.name)}${b.linkedIssue ? ` <span class="badge issue">${escapeHtml(b.linkedIssue)}</span>` : ''}</span>
                    <span class="branch-meta">${formatAge(b.daysOld)}${b.ahead || b.behind ? ` <span class="badge">${b.ahead ? `+${b.ahead}` : ''}${b.behind ? `-${b.behind}` : ''}</span>` : ''}</span>
                    <button class="danger delete-btn" data-branch="${escapeHtml(b.name)}">Delete</button>
                </li>
                `).join('')}
            </ul>
        </div>
        ` : ''}

        ${active.length > 0 ? `
        <div class="section">
            <div class="section-header">
                <label>Active (${active.length})</label>
            </div>
            <ul class="branch-list">
                ${active.map((b) => `
                <li class="branch-item" data-branch="${escapeHtml(b.name)}" data-status="active" data-health="${b.healthStatus || 'healthy'}" data-age="${b.daysOld}" data-author="${escapeHtml(b.author || '')}">
                    <span class="health-dot" style="background: ${getHealthColor(b.healthStatus)}" title="${b.healthReason || ''}"></span>
                    <span class="branch-name">${escapeHtml(b.name)}${b.linkedIssue ? ` <span class="badge issue">${escapeHtml(b.linkedIssue)}</span>` : ''}</span>
                    <span class="branch-meta">${formatAge(b.daysOld)}${b.ahead || b.behind ? ` <span class="badge">${b.ahead ? `+${b.ahead}` : ''}${b.behind ? `-${b.behind}` : ''}</span>` : ''}</span>
                    <button class="secondary switch-btn" data-branch="${escapeHtml(b.name)}">Switch</button>
                </li>
                `).join('')}
            </ul>
        </div>
        ` : ''}

        ${merged.length === 0 && stale.length === 0 && orphaned.length === 0 ? `<p class="empty-msg">No branches need cleanup.</p>` : ''}
    </div>

    <div id="remote" class="tab-content">
        <div class="section">
            <div class="section-header">
                <label>Remote Branches</label>
                <button class="secondary" id="prune-btn">Prune Stale</button>
            </div>
            ${mergedRemotes.length > 0 ? `
            <p style="margin-bottom: 8px; opacity: 0.7;">${mergedRemotes.length} merged remote branch${mergedRemotes.length > 1 ? 'es' : ''} can be deleted</p>
            <ul class="branch-list">
                ${mergedRemotes.slice(0, 20).map((b) => `
                <li class="branch-item">
                    <span class="branch-name">${b.remote}/${escapeHtml(b.name)}</span>
                    <span class="branch-meta">${b.daysOld ? formatAge(b.daysOld) : ''}</span>
                    <button class="danger delete-remote-btn" data-branch="${escapeHtml(b.name)}">Delete</button>
                </li>
                `).join('')}
            </ul>
            ${mergedRemotes.length > 20 ? `<p style="opacity: 0.6; margin-top: 8px;">...and ${mergedRemotes.length - 20} more</p>` : ''}
            ` : `<p class="empty-msg">No remote branches need cleanup.</p>`}
        </div>
    </div>

    <div id="worktrees" class="tab-content">
        <div class="section">
            <div class="section-header">
                <label>Worktrees</label>
                <button class="secondary" id="create-worktree-btn">Create Worktree</button>
            </div>
            ${worktrees.length > 0 ? `
            <ul class="branch-list">
                ${worktrees.map((w) => `
                <div class="worktree-item">
                    <span class="branch-name">${escapeHtml(w.branch)}${w.isMainWorktree ? ' <span class="badge">main</span>' : ''}${w.isLocked ? ' <span class="badge">locked</span>' : ''}</span>
                    <span class="worktree-path">${escapeHtml(w.path)}</span>
                </div>
                `).join('')}
            </ul>
            ` : `<p class="empty-msg">No worktrees. Create one to work on multiple branches simultaneously.</p>`}
        </div>
    </div>

    <div id="stashes" class="tab-content">
        <div class="section">
            <div class="section-header">
                <label>Stashes</label>
                <button class="secondary" id="create-stash-btn">Stash Changes</button>
            </div>
            ${stashes.length > 0 ? `
            <ul class="branch-list">
                ${stashes.map((s) => `
                <details class="stash-item">
                    <summary class="stash-summary">
                        <div class="stash-info">
                            <span class="stash-ref">stash@{${s.index}}</span>
                            <span class="stash-message">${escapeHtml(s.message)}</span>
                        </div>
                        <div class="stash-meta">
                            <span>${s.filesChanged ? `${s.filesChanged} file${s.filesChanged > 1 ? 's' : ''}` : ''}</span>
                            <span>${formatAge(s.daysOld)}</span>
                        </div>
                        <div class="stash-actions">
                            <button class="secondary apply-stash-btn" data-index="${s.index}">Apply</button>
                            <button class="secondary pop-stash-btn" data-index="${s.index}">Pop</button>
                            <button class="danger drop-stash-btn" data-index="${s.index}">Drop</button>
                        </div>
                    </summary>
                    ${s.files && s.files.length > 0 ? `
                    <div class="stash-files">
                        ${s.files.map(f => `<div class="stash-file">${escapeHtml(f)}</div>`).join('')}
                    </div>
                    ` : ''}
                </details>
                `).join('')}
            </ul>
            ${stashes.length > 1 ? `<button class="danger" id="clear-stashes-btn" style="margin-top: 12px;">Clear All Stashes</button>` : ''}
            ` : `<p class="empty-msg">No stashes. Use "Stash Changes" to save uncommitted work.</p>`}
        </div>
    </div>

    ${protectedBranches.length > 0 ? `
    <details class="protected">
        <summary>Protected: ${protectedBranches.map(b => escapeHtml(b)).join(', ')}</summary>
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

        // Search and Filter State
        const searchState = {
            query: '',
            statusFilters: new Set(),
            sortField: 'health',
            sortDirection: 'asc'
        };

        // Fuzzy match with highlighting
        function fuzzyMatch(text, query) {
            if (!query) return { match: true, score: 0, indices: [] };
            const textLower = text.toLowerCase();
            const queryLower = query.toLowerCase();
            let queryIdx = 0, textIdx = 0, score = 0;
            const indices = [];
            let consecutive = 0;

            while (queryIdx < queryLower.length && textIdx < textLower.length) {
                if (queryLower[queryIdx] === textLower[textIdx]) {
                    indices.push(textIdx);
                    score += 1;
                    consecutive++;
                    score += consecutive * 0.5;
                    if (textIdx === 0 || text[textIdx - 1] === '-' || text[textIdx - 1] === '/' || text[textIdx - 1] === '_') {
                        score += 3;
                    }
                    queryIdx++;
                } else {
                    consecutive = 0;
                }
                textIdx++;
            }
            return queryIdx === queryLower.length ? { match: true, score, indices } : { match: false, score: 0, indices: [] };
        }

        // Highlight matched characters
        function highlightMatch(text, indices) {
            if (!indices.length) return text;
            let result = '';
            let lastIndex = 0;
            for (const idx of indices) {
                result += text.slice(lastIndex, idx);
                result += '<mark class="highlight">' + text[idx] + '</mark>';
                lastIndex = idx + 1;
            }
            result += text.slice(lastIndex);
            return result;
        }

        // Apply filters and search
        function applyFiltersAndSearch() {
            const items = document.querySelectorAll('#local .branch-item');
            const sections = document.querySelectorAll('#local .section');
            let visibleCount = 0;
            let totalCount = items.length;

            items.forEach(item => {
                const branch = item.dataset.branch || '';
                const status = item.dataset.status || '';
                const author = item.dataset.author || '';

                // Check status filter
                let statusMatch = searchState.statusFilters.size === 0 || searchState.statusFilters.has(status);

                // Check search query
                let searchMatch = true;
                let matchResult = { match: true, indices: [] };
                if (searchState.query) {
                    matchResult = fuzzyMatch(branch, searchState.query);
                    const authorMatch = fuzzyMatch(author, searchState.query);
                    searchMatch = matchResult.match || authorMatch.match;
                }

                const visible = statusMatch && searchMatch;
                item.classList.toggle('hidden', !visible);

                if (visible) {
                    visibleCount++;
                }

                // Update branch name with highlighting or restore original
                const nameEl = item.querySelector('.branch-name');
                if (nameEl) {
                    const originalName = decode(branch);
                    const badges = nameEl.querySelectorAll('.badge');
                    const badgeHtml = Array.from(badges).map(b => b.outerHTML).join('');
                    if (searchState.query && matchResult.match && matchResult.indices.length > 0) {
                        nameEl.innerHTML = highlightMatch(originalName, matchResult.indices) + (badgeHtml ? ' ' + badgeHtml : '');
                    } else {
                        // Restore original name without highlights
                        nameEl.innerHTML = originalName + (badgeHtml ? ' ' + badgeHtml : '');
                    }
                }
            });

            // Update result count
            const countEl = document.getElementById('result-count');
            if (countEl) {
                if (searchState.query || searchState.statusFilters.size > 0) {
                    countEl.textContent = visibleCount + ' of ' + totalCount;
                } else {
                    countEl.textContent = '';
                }
            }

            // Show/hide no results message
            const noResults = document.getElementById('no-results');
            const healthBar = document.querySelector('#local .health-bar');
            if (noResults && healthBar) {
                if (visibleCount === 0 && (searchState.query || searchState.statusFilters.size > 0)) {
                    noResults.style.display = 'block';
                    healthBar.style.display = 'none';
                    sections.forEach(s => s.style.display = 'none');
                } else {
                    noResults.style.display = 'none';
                    healthBar.style.display = 'flex';
                    sections.forEach(s => s.style.display = 'block');
                }
            }

            // Hide sections that have no visible items
            sections.forEach(section => {
                const visibleItems = section.querySelectorAll('.branch-item:not(.hidden)');
                if (visibleItems.length === 0 && visibleCount > 0) {
                    section.style.display = 'none';
                }
            });
        }

        // Sort branches
        function sortBranches() {
            const lists = document.querySelectorAll('#local .branch-list');
            lists.forEach(list => {
                const items = Array.from(list.querySelectorAll('.branch-item'));
                items.sort((a, b) => {
                    let aVal, bVal;
                    switch (searchState.sortField) {
                        case 'name':
                            aVal = (a.dataset.branch || '').toLowerCase();
                            bVal = (b.dataset.branch || '').toLowerCase();
                            return searchState.sortDirection === 'asc' ? aVal.localeCompare(bVal) : bVal.localeCompare(aVal);
                        case 'age':
                            aVal = parseInt(a.dataset.age) || 0;
                            bVal = parseInt(b.dataset.age) || 0;
                            return searchState.sortDirection === 'asc' ? aVal - bVal : bVal - aVal;
                        case 'health':
                        default:
                            const healthOrder = { danger: 0, critical: 1, warning: 2, healthy: 3 };
                            aVal = healthOrder[a.dataset.health] ?? 3;
                            bVal = healthOrder[b.dataset.health] ?? 3;
                            return searchState.sortDirection === 'asc' ? aVal - bVal : bVal - aVal;
                    }
                });
                items.forEach(item => list.appendChild(item));
            });
        }

        // Debounce helper
        function debounce(fn, delay) {
            let timer;
            return function(...args) {
                clearTimeout(timer);
                timer = setTimeout(() => fn.apply(this, args), delay);
            };
        }

        // Search input handler
        const searchInput = document.getElementById('branch-search');
        const debouncedSearch = debounce(() => {
            searchState.query = searchInput?.value || '';
            applyFiltersAndSearch();
        }, 150);

        searchInput?.addEventListener('input', debouncedSearch);

        // Clear search button
        document.getElementById('search-clear')?.addEventListener('click', () => {
            if (searchInput) searchInput.value = '';
            searchState.query = '';
            applyFiltersAndSearch();
        });

        // Clear filters button
        document.getElementById('clear-filters-btn')?.addEventListener('click', () => {
            if (searchInput) searchInput.value = '';
            searchState.query = '';
            searchState.statusFilters.clear();
            document.querySelectorAll('.filter-chip').forEach(chip => chip.setAttribute('aria-pressed', 'false'));
            applyFiltersAndSearch();
        });

        // Filter chips
        document.querySelectorAll('.filter-chip').forEach(chip => {
            chip.addEventListener('click', () => {
                const filter = chip.dataset.filter;
                const isPressed = chip.getAttribute('aria-pressed') === 'true';
                chip.setAttribute('aria-pressed', !isPressed);
                if (isPressed) {
                    searchState.statusFilters.delete(filter);
                } else {
                    searchState.statusFilters.add(filter);
                }
                applyFiltersAndSearch();
            });
        });

        // Sort dropdown
        document.getElementById('sort-select')?.addEventListener('change', e => {
            const [field, dir] = e.target.value.split('-');
            searchState.sortField = field;
            searchState.sortDirection = dir;
            sortBranches();
        });

        // Keyboard shortcut for search focus
        document.addEventListener('keydown', e => {
            if ((e.metaKey || e.ctrlKey) && e.key === 'f') {
                e.preventDefault();
                searchInput?.focus();
                searchInput?.select();
            }
            if (e.key === 'Escape' && document.activeElement === searchInput) {
                searchInput.blur();
            }
        });

        document.querySelectorAll('.tab').forEach(tab => {
            tab.addEventListener('click', () => {
                document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
                document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
                tab.classList.add('active');
                document.getElementById(tab.dataset.tab)?.classList.add('active');
            });
        });

        function updateCounts() {
            ['merged', 'stale', 'orphaned'].forEach(type => {
                const checked = document.querySelectorAll('.' + type + '-checkbox:checked').length;
                const btn = document.getElementById('delete' + type.charAt(0).toUpperCase() + type.slice(1) + 'Btn');
                if (btn) btn.disabled = checked === 0;
            });
        }

        document.getElementById('refresh-btn')?.addEventListener('click', () => vscode.postMessage({ command: 'refresh' }));
        document.getElementById('create-branch-btn')?.addEventListener('click', () => vscode.postMessage({ command: 'createBranch' }));
        document.getElementById('create-worktree-btn')?.addEventListener('click', () => vscode.postMessage({ command: 'createWorktree' }));
        document.getElementById('prune-btn')?.addEventListener('click', () => vscode.postMessage({ command: 'pruneRemotes' }));

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

        ['Merged', 'Stale', 'Orphaned'].forEach(type => {
            document.getElementById('delete' + type + 'Btn')?.addEventListener('click', () => {
                const checkboxes = document.querySelectorAll('.' + type.toLowerCase() + '-checkbox:checked');
                const branches = Array.from(checkboxes).map(cb => decode(cb.dataset.branch));
                if (branches.length > 0) {
                    vscode.postMessage({ command: 'confirmDeleteMultiple', branches, type: type.toLowerCase() });
                }
            });
        });

        document.querySelectorAll('.delete-btn').forEach(btn => {
            btn.addEventListener('click', e => vscode.postMessage({ command: 'deleteBranch', branch: decode(e.target.dataset.branch) }));
        });

        document.querySelectorAll('.delete-remote-btn').forEach(btn => {
            btn.addEventListener('click', e => vscode.postMessage({ command: 'deleteRemoteBranch', branch: decode(e.target.dataset.branch) }));
        });

        document.querySelectorAll('.switch-btn').forEach(btn => {
            btn.addEventListener('click', e => vscode.postMessage({ command: 'switchBranch', branch: decode(e.target.dataset.branch) }));
        });

        document.getElementById('create-stash-btn')?.addEventListener('click', () => vscode.postMessage({ command: 'createStash' }));
        document.getElementById('clear-stashes-btn')?.addEventListener('click', () => vscode.postMessage({ command: 'clearStashes' }));

        document.querySelectorAll('.apply-stash-btn').forEach(btn => {
            btn.addEventListener('click', e => vscode.postMessage({ command: 'applyStash', index: parseInt(e.target.dataset.index) }));
        });

        document.querySelectorAll('.pop-stash-btn').forEach(btn => {
            btn.addEventListener('click', e => vscode.postMessage({ command: 'popStash', index: parseInt(e.target.dataset.index) }));
        });

        document.querySelectorAll('.drop-stash-btn').forEach(btn => {
            btn.addEventListener('click', e => vscode.postMessage({ command: 'dropStash', index: parseInt(e.target.dataset.index) }));
        });

        document.getElementById('sponsor-link')?.addEventListener('click', e => { e.preventDefault(); vscode.postMessage({ command: 'openSponsor' }); });
        document.getElementById('coffee-link')?.addEventListener('click', e => { e.preventDefault(); vscode.postMessage({ command: 'openSupport' }); });
        document.getElementById('github-link')?.addEventListener('click', e => { e.preventDefault(); vscode.postMessage({ command: 'openGithub' }); });
    })();
    </script>
</body>
</html>`;
}

export function deactivate() {}

/**
 * Checks and shows review request based on usage.
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
    `You've used Git Branch Manager ${usageCount} times. Your support helps fund development.`,
    'Support Development',
    'Maybe Later',
    "Don't Show Again"
  );

  if (result === 'Support Development') {
    vscode.env.openExternal(vscode.Uri.parse('https://www.buymeacoffee.com/YonasValentin'));
    context.globalState.update('hasShownSupportMessage', true);
  } else if (result === "Don't Show Again") {
    context.globalState.update('hasShownSupportMessage', true);
  }

  context.globalState.update('lastSupportMessageDate', Date.now());
}
