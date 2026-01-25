/**
 * VS Code command handlers module.
 * @module commands
 */

// Stash commands
export { quickStash, quickStashPop } from './stash';

// Worktree commands
export { createWorktreeFromBranch, showWorktreeManager } from './worktree';

// Branch commands
export {
  createBranchFromTemplate,
  quickCleanup,
  switchBranch,
  deleteBranch,
  deleteMultipleBranches,
  checkBranchHealth
} from './branch';

// Remote commands
export { cleanRemoteBranches } from './remote';
