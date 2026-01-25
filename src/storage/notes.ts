import * as vscode from 'vscode';
import { BranchNote } from '../types';

/**
 * Gets branch notes from extension storage.
 * @param context - Extension context
 * @param repoPath - Repository path for scoping
 * @returns Map of branch name to note
 */
export function getBranchNotes(
  context: vscode.ExtensionContext,
  repoPath: string
): Map<string, BranchNote> {
  const key = `branchNotes:${repoPath}`;
  const stored = context.workspaceState.get<Record<string, BranchNote>>(key, {});
  return new Map(Object.entries(stored));
}

/**
 * Saves a branch note to extension storage.
 * @param context - Extension context
 * @param repoPath - Repository path for scoping
 * @param branch - Branch name
 * @param note - Note content (empty to delete)
 */
export async function saveBranchNote(
  context: vscode.ExtensionContext,
  repoPath: string,
  branch: string,
  note: string
): Promise<void> {
  const key = `branchNotes:${repoPath}`;
  const stored = context.workspaceState.get<Record<string, BranchNote>>(key, {});
  if (note.trim()) {
    stored[branch] = { branch, note: note.trim(), updatedAt: Date.now() };
  } else {
    delete stored[branch];
  }
  await context.workspaceState.update(key, stored);
}
