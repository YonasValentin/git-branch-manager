// Shared data types for the webview React app.
// These mirror the design's data model and are produced by buildInitialData() in extension.ts.

export interface PRInfo {
  number: number;
  state: 'open' | 'closed' | 'merged' | 'draft';
  title: string;
  ci: 'passing' | 'failing' | 'pending' | 'none';
  checks: string;
  reviews: 'approved' | 'changes_requested' | 'pending' | 'none';
}

export interface RepoBranch {
  name: string;
  isCurrent: boolean;
  isMerged: boolean;
  isProtected: boolean;
  status: 'active' | 'merged' | 'stale' | 'orphaned';
  daysOld: number;
  lastCommitDate: string;
  author: string;
  ahead: number;
  behind: number;
  commits: number;
  note: string | null;
  issue: string | null;
  remoteGone: boolean;
  pr: PRInfo | null;
}

export interface RepoRemote {
  name: string;
  daysOld: number;
  isMerged: boolean;
  isGone: boolean;
  author: string;
  localBranch: string | null;
  ahead: number;
  behind: number;
}

export interface RepoWorktree {
  path: string;
  branch: string;
  isMain: boolean;
  isLocked: boolean;
  prunable: boolean;
  lastActivity: string;
}

export interface RepoStash {
  index: number;
  message: string;
  branch: string;
  date: string;
  filesChanged: number;
  files: string[];
}

export interface CleanupConditions {
  merged?: boolean;
  olderThanDays?: number;
  pattern?: string;
  noRemote?: boolean;
}

export interface CleanupRule {
  id: string;
  name: string;
  enabled: boolean;
  conditions: CleanupConditions;
  action: 'delete' | 'archive' | 'notify';
}

export interface RecoveryEntry {
  branchName: string;
  commitHash: string;
  deletedAt: string;
  deletedBy: string;
}

export interface AuthorInfo {
  name: string;
  initials: string;
  color: string;
}

export interface BranchTemplate {
  name: string;
  pattern: string;
  example: string;
  color: string;
}

export interface CommitInfo {
  hash: string;
  message: string;
  author: string;
  date: string;
}

export interface FileChange {
  path: string;
  status: 'A' | 'M' | 'D' | 'R';
  additions: number;
  deletions: number;
}

export interface CompareResult {
  ahead: CommitInfo[];
  behind: CommitInfo[];
  files: FileChange[];
}

export interface RepoInfo {
  name: string;
  path: string;
  currentBranch: string;
  remote: string;
  remoteUrl: string;
  defaultBranch: string;
  protectedBranches: string[];
  staleDays: number;
}

export interface InitialData {
  repo: RepoInfo;
  authors: Record<string, AuthorInfo>;
  branches: RepoBranch[];
  remoteBranches: RepoRemote[];
  worktrees: RepoWorktree[];
  stashes: RepoStash[];
  cleanupRules: CleanupRule[];
  recoveryLog: RecoveryEntry[];
  theme?: 'dark' | 'light';
}

export interface ToastData {
  id: number;
  title: string;
  detail?: string;
  canUndo?: boolean;
  tone?: 'default' | 'danger';
}

declare global {
  interface Window {
    INITIAL_DATA: InitialData;
  }
}
