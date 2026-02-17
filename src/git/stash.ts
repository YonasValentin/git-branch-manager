import { gitCommand } from './core';
import { StashInfo } from '../types';

/**
 * Retrieves stash entries with file change details.
 * File lists are fetched in parallel batches to minimize latency.
 */
export async function getStashInfo(cwd: string): Promise<StashInfo[]> {
  const stashes: StashInfo[] = [];

  try {
    const stdout = await gitCommand(['stash', 'list', '--format=%gd|%s|%ci'], cwd);
    if (!stdout) return [];

    const lines = stdout.split('\n');
    const entries: { index: number; message: string; branch: string; date: Date; daysOld: number }[] = [];

    for (const line of lines) {
      const parts = line.split('|');
      if (parts.length < 3) continue;

      const refMatch = parts[0].match(/stash@\{(\d+)\}/);
      if (!refMatch) continue;

      const index = parseInt(refMatch[1]);
      const message = parts[1] || '';
      const branchMatch = message.match(/^(?:WIP )?[Oo]n ([^:]+):/);
      const date = new Date(parts[2] || '');

      entries.push({
        index,
        message,
        branch: branchMatch?.[1] || '',
        date,
        daysOld: Math.floor((Date.now() - date.getTime()) / (1000 * 60 * 60 * 24)),
      });
    }

    // Parallel file list fetch
    const BATCH_SIZE = 5;
    for (let i = 0; i < entries.length; i += BATCH_SIZE) {
      const batch = entries.slice(i, i + BATCH_SIZE);
      const results = await Promise.all(
        batch.map(async (entry) => {
          let filesChanged: number | undefined;
          let files: string[] = [];

          try {
            const nameOnly = await gitCommand(['stash', 'show', `stash@{${entry.index}}`, '--name-only'], cwd);
            files = nameOnly.split('\n').filter(Boolean);
            filesChanged = files.length;
          } catch {
            try {
              const stat = await gitCommand(['stash', 'show', `stash@{${entry.index}}`, '--stat'], cwd);
              const match = stat.match(/(\d+) files? changed/);
              if (match) filesChanged = parseInt(match[1]);
            } catch {}
          }

          return { ...entry, filesChanged, files };
        })
      );
      stashes.push(...results);
    }
  } catch (err) {
    console.error('getStashInfo failed:', err);
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
export async function createStash(cwd: string, message?: string, includeUntracked?: boolean): Promise<boolean> {
  try {
    const args = ['stash', 'push'];
    if (includeUntracked) args.push('-u');
    if (message) {
      args.push('-m', message);
    }
    await gitCommand(args, cwd);
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
export async function applyStash(cwd: string, index: number): Promise<boolean> {
  try {
    await gitCommand(['stash', 'apply', `stash@{${index}}`], cwd);
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
export async function popStash(cwd: string, index: number): Promise<boolean> {
  try {
    await gitCommand(['stash', 'pop', `stash@{${index}}`], cwd);
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
export async function dropStash(cwd: string, index: number): Promise<boolean> {
  try {
    await gitCommand(['stash', 'drop', `stash@{${index}}`], cwd);
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
export async function clearStashes(cwd: string): Promise<boolean> {
  try {
    await gitCommand(['stash', 'clear'], cwd);
    return true;
  } catch (error) {
    console.error('Error clearing stashes:', error);
    return false;
  }
}
