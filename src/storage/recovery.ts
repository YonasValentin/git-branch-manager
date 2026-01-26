import * as vscode from 'vscode';
import { DeletedBranchEntry } from '../types';

const MAX_RECOVERY_ENTRIES = 50; // Prevent unbounded growth

/**
 * Gets the recovery log from extension storage.
 * @param context - Extension context
 * @param repoPath - Repository path for scoping
 * @returns Array of deleted branch entries, newest first
 */
export function getRecoveryLog(
  context: vscode.ExtensionContext,
  repoPath: string
): DeletedBranchEntry[] {
  const key = `recoveryLog:${repoPath}`;
  return context.workspaceState.get<DeletedBranchEntry[]>(key, []);
}

/**
 * Adds a deleted branch entry to the recovery log.
 * @param context - Extension context
 * @param repoPath - Repository path for scoping
 * @param entry - Deleted branch entry to add
 */
export async function addRecoveryEntry(
  context: vscode.ExtensionContext,
  repoPath: string,
  entry: DeletedBranchEntry
): Promise<void> {
  const key = `recoveryLog:${repoPath}`;
  const log = context.workspaceState.get<DeletedBranchEntry[]>(key, []);

  // Add new entry at the beginning (newest first)
  log.unshift(entry);

  // Trim to max entries to prevent unbounded growth
  if (log.length > MAX_RECOVERY_ENTRIES) {
    log.length = MAX_RECOVERY_ENTRIES;
  }

  await context.workspaceState.update(key, log);
}

/**
 * Removes an entry from the recovery log (after successful restore).
 * @param context - Extension context
 * @param repoPath - Repository path for scoping
 * @param branchName - Branch name to remove
 * @param commitHash - Commit hash to match (for uniqueness)
 */
export async function removeRecoveryEntry(
  context: vscode.ExtensionContext,
  repoPath: string,
  branchName: string,
  commitHash: string
): Promise<void> {
  const key = `recoveryLog:${repoPath}`;
  const log = context.workspaceState.get<DeletedBranchEntry[]>(key, []);

  const filtered = log.filter(
    entry => !(entry.branchName === branchName && entry.commitHash === commitHash)
  );

  await context.workspaceState.update(key, filtered);
}

/**
 * Clears the entire recovery log for a repository.
 * @param context - Extension context
 * @param repoPath - Repository path for scoping
 */
export async function clearRecoveryLog(
  context: vscode.ExtensionContext,
  repoPath: string
): Promise<void> {
  const key = `recoveryLog:${repoPath}`;
  await context.workspaceState.update(key, []);
}
