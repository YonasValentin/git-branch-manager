import * as cp from 'child_process';
import { promisify } from 'util';

/**
 * Promisified exec for git commands.
 * Maintained for backwards compatibility with existing extension patterns.
 */
export const exec = promisify(cp.exec);

/**
 * Gets the Git root directory for the current workspace.
 * @returns The Git root path or undefined
 */
export async function getGitRoot(workspacePath: string): Promise<string | undefined> {
  try {
    const { stdout } = await exec('git rev-parse --show-toplevel', { cwd: workspacePath });
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
export async function getCurrentBranch(cwd: string): Promise<string> {
  const { stdout } = await exec('git branch --show-current', { cwd });
  return stdout.trim();
}

/**
 * Determines the base branch for merge comparisons.
 * @param cwd - Working directory
 * @returns Base branch name (main, master, etc.)
 */
export async function getBaseBranch(cwd: string): Promise<string> {
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
