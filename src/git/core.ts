import * as cp from 'child_process';
import { promisify } from 'util';

/**
 * Promisified execFile for secure git command execution.
 */
const execFileAsync = promisify(cp.execFile);

/**
 * Executes a git command securely using execFile (no shell interpretation).
 * @security Arguments passed as array, preventing shell injection.
 * @param args - Git command arguments, e.g. ['branch', '-D', '--', branchName]
 * @param cwd - Working directory
 * @returns stdout trimmed
 */
export async function gitCommand(args: string[], cwd: string): Promise<string> {
  const { stdout } = await execFileAsync('git', args, { cwd });
  return stdout.trim();
}

/**
 * Export execFile for callers that need full {stdout, stderr} object.
 */
export { execFileAsync as execFile };

/**
 * Gets the Git root directory for the current workspace.
 * @returns The Git root path or undefined
 */
export async function getGitRoot(workspacePath: string): Promise<string | undefined> {
  try {
    return await gitCommand(['rev-parse', '--show-toplevel'], workspacePath);
  } catch {
    return undefined;
  }
}

/**
 * Gets the current branch name.
 * @param cwd - Working directory
 * @returns Current branch name
 */
export async function getCurrentBranch(cwd: string): Promise<string> {
  return await gitCommand(['branch', '--show-current'], cwd);
}

/**
 * Determines the base branch for merge comparisons.
 * @param cwd - Working directory
 * @returns Base branch name (main, master, etc.)
 */
export async function getBaseBranch(cwd: string): Promise<string> {
  try {
    const stdout = await gitCommand(['symbolic-ref', 'refs/remotes/origin/HEAD'], cwd);
    return stdout.replace('refs/remotes/origin/', '');
  } catch {
    const stdout = await gitCommand(['branch', '-r'], cwd);
    if (stdout.includes('origin/main')) return 'main';
    if (stdout.includes('origin/master')) return 'master';
    return 'main';
  }
}
