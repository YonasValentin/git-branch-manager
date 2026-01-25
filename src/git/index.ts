/**
 * Git operations module.
 * @module git
 */

// Core utilities
export { exec, getGitRoot, getCurrentBranch, getBaseBranch } from './core';

// Health scoring
export { calculateHealthScore, getHealthStatus, getHealthReason, extractIssueFromBranch } from './health';

// Branch operations
export {
  getBranchInfo,
  getRemoteBranchInfo,
  getAllBranchNames,
  renameBranch,
  deleteBranchForce,
  compareBranches
} from './branches';

// Stash operations
export {
  getStashInfo,
  createStash,
  applyStash,
  popStash,
  dropStash,
  clearStashes
} from './stash';

// Worktree operations
export { getWorktreeInfo } from './worktree';

// GitHub integration
export { getGitHubInfo, fetchGitHubPRs } from './github';
