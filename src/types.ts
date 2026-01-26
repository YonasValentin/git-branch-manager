/**
 * Branch information with health metrics and integration data.
 */
export interface BranchInfo {
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
export interface PRStatus {
  number: number;
  state: 'open' | 'closed' | 'merged' | 'draft';
  title: string;
  url: string;
  reviewStatus?: 'approved' | 'changes_requested' | 'pending' | 'none';
}

/**
 * Remote branch information for cleanup operations.
 */
export interface RemoteBranchInfo {
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
export interface WorktreeInfo {
  path: string;
  branch: string;
  isMainWorktree: boolean;
  isLocked: boolean;
  prunable: boolean;
}

/**
 * Git stash entry information.
 */
export interface StashInfo {
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
export interface BranchTemplate {
  name: string;
  pattern: string;
  example: string;
}

/**
 * Search and filter state for the branch manager UI.
 */
export interface SearchFilterState {
  query: string;
  statusFilters: Set<'merged' | 'stale' | 'orphaned' | 'active'>;
  healthFilters: Set<'healthy' | 'warning' | 'critical' | 'danger'>;
  sortField: 'name' | 'age' | 'health' | 'author';
  sortDirection: 'asc' | 'desc';
}

/**
 * Result of fuzzy matching with highlight information.
 */
export interface FuzzyMatchResult {
  score: number;
  matchIndices: number[];
  text: string;
}

/**
 * Commit information for branch comparison.
 */
export interface CommitInfo {
  hash: string;
  message: string;
  author: string;
  date: string;
  daysOld: number;
}

/**
 * File change information for branch comparison.
 */
export interface FileChange {
  path: string;
  status: 'A' | 'M' | 'D' | 'R';
}

/**
 * Branch comparison result.
 */
export interface ComparisonResult {
  branchA: string;
  branchB: string;
  ahead: number;
  behind: number;
  commitsA: CommitInfo[];
  commitsB: CommitInfo[];
  files: FileChange[];
  mergeBase: string;
}

/**
 * Branch note stored locally.
 */
export interface BranchNote {
  branch: string;
  note: string;
  updatedAt: number;
}

/**
 * Auto-cleanup rule configuration.
 */
export interface CleanupRule {
  id: string;
  name: string;
  enabled: boolean;
  conditions: {
    merged?: boolean;
    olderThanDays?: number;
    pattern?: string;
    noRemote?: boolean;
  };
  action: 'delete' | 'archive' | 'notify';
}

/**
 * Entry in the recovery log for deleted branches.
 * Stores all information needed to restore a branch.
 */
export interface DeletedBranchEntry {
  /** Original branch name */
  branchName: string;
  /** Commit hash the branch pointed to at deletion time */
  commitHash: string;
  /** Unix timestamp of deletion */
  deletedAt: number;
  /** Optional: who deleted it (for multi-user scenarios) */
  deletedBy?: string;
  /** Optional: reason or note about deletion */
  reason?: string;
}
