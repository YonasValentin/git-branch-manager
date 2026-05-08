// The wire contract bridge: extension's git-derived types → webview's typed
// `InitialData` payload. Every webview view depends on this mapping being
// consistent and complete.

import type {
  BranchInfo,
  RemoteBranchInfo,
  WorktreeInfo,
  StashInfo,
  CleanupRule,
  DeletedBranchEntry,
  BranchNote,
} from '../types';
import type { AuthorInfo, InitialData } from '../webview/types';
import { formatAge } from '../utils';
import { mapPR } from './mapPR';

export const PROTECTED_NAMES = ['main', 'master', 'develop', 'dev', 'staging', 'production'];

const PALETTE = ['#34d399', '#22d3ee', '#a78bfa', '#fbbf24', '#f87171', '#60a5fa', '#fb923c', '#e879f9'];

export function hashColor(str: string): string {
  let h = 5381;
  for (let i = 0; i < str.length; i++) {
    h = ((h << 5) + h) ^ str.charCodeAt(i);
  }
  return PALETTE[Math.abs(h) % PALETTE.length] ?? PALETTE[0]!;
}

export function initials(name: string): string {
  const parts = name.trim().split(/\s+/);
  const first = parts[0];
  const last = parts[parts.length - 1];
  if (parts.length >= 2 && first && last && first[0] && last[0]) {
    return (first[0] + last[0]).toUpperCase();
  }
  return name.trim().slice(0, 2).toUpperCase();
}

export function mapBranchStatus(
  b: Pick<BranchInfo, 'isMerged' | 'remoteGone' | 'daysOld'>,
  staleDays: number,
): 'active' | 'stale' | 'merged' | 'orphaned' {
  if (b.isMerged) return 'merged';
  if (b.remoteGone) return 'orphaned';
  if (b.daysOld > staleDays) return 'stale';
  return 'active';
}

export function buildInitialData(
  branches: BranchInfo[],
  remoteBranches: RemoteBranchInfo[],
  worktrees: WorktreeInfo[],
  stashes: StashInfo[],
  cleanupRules: CleanupRule[],
  recoveryLog: DeletedBranchEntry[],
  branchNotes: Map<string, BranchNote>,
  currentBranch: string,
  defaultBranch: string,
  repoName: string,
  staleDays: number,
): InitialData {
  const authorNames = Array.from(
    new Set(branches.map((b) => b.author).filter((a): a is string => Boolean(a))),
  );
  const authors: Record<string, AuthorInfo> = {};
  for (const name of authorNames) {
    authors[name] = { name, initials: initials(name), color: hashColor(name) };
  }

  return {
    repo: {
      name: repoName,
      path: '',
      currentBranch,
      remote: 'origin',
      remoteUrl: '',
      defaultBranch: defaultBranch || 'main',
      protectedBranches: PROTECTED_NAMES,
      staleDays,
    },
    authors,
    branches: branches.map((b) => ({
      name: b.name,
      isCurrent: b.isCurrentBranch,
      isProtected: PROTECTED_NAMES.includes(b.name),
      isMerged: b.isMerged,
      status: mapBranchStatus(b, staleDays),
      daysOld: b.daysOld,
      lastCommitDate: formatAge(b.daysOld),
      author: b.author ?? 'Unknown',
      ahead: b.ahead ?? 0,
      behind: b.behind ?? 0,
      commits: 0,
      note: branchNotes.get(b.name)?.note ?? null,
      issue: b.linkedIssue ?? null,
      remoteGone: b.remoteGone ?? false,
      pr: mapPR(b.prStatus),
    })),
    remoteBranches: remoteBranches.map((r) => ({
      name: r.name,
      daysOld: r.daysOld ?? 0,
      isMerged: r.isMerged,
      isGone: r.isGone,
      author: 'Unknown',
      localBranch: r.localBranch ?? null,
      ahead: 0,
      behind: 0,
    })),
    worktrees: worktrees.map((w) => ({
      path: w.path,
      branch: w.branch,
      isMain: w.isMainWorktree,
      isLocked: w.isLocked,
      prunable: w.prunable,
      lastActivity: 'unknown',
    })),
    stashes: stashes.map((s) => ({
      index: s.index,
      message: s.message,
      branch: s.branch,
      date: formatAge(s.daysOld),
      filesChanged: s.filesChanged ?? 0,
      files: s.files ?? [],
    })),
    cleanupRules,
    recoveryLog: recoveryLog.map((r) => ({
      branchName: r.branchName,
      commitHash: r.commitHash,
      deletedAt: formatAge(Math.floor((Date.now() - r.deletedAt) / 86_400_000)),
      deletedBy: r.deletedBy ?? 'you',
    })),
  };
}
