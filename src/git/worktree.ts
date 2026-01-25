import { exec } from './core';
import { WorktreeInfo } from '../types';

/**
 * Gets worktree information.
 * @param cwd - Working directory
 * @returns Array of worktree information
 */
export async function getWorktreeInfo(cwd: string): Promise<WorktreeInfo[]> {
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
