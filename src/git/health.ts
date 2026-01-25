import { BranchInfo } from '../types';

/**
 * Calculates a health score for a branch.
 * @param branch - Branch information
 * @param daysUntilStale - Configuration for stale threshold
 * @returns Health score between 0-100
 */
export function calculateHealthScore(branch: BranchInfo, daysUntilStale: number): number {
  let score = 100;

  if (branch.isMerged) {
    score -= 40;
  }

  if (branch.daysOld > daysUntilStale * 2) {
    score -= 30;
  } else if (branch.daysOld > daysUntilStale) {
    score -= 20;
  } else if (branch.daysOld > daysUntilStale / 2) {
    score -= 10;
  }

  if (branch.remoteGone) {
    score -= 20;
  }

  if (branch.behind && branch.behind > 50) {
    score -= 10;
  } else if (branch.behind && branch.behind > 20) {
    score -= 5;
  }

  return Math.max(0, Math.min(100, score));
}

/**
 * Determines health status from score.
 * @param score - Health score
 * @returns Status category
 */
export function getHealthStatus(score: number): 'healthy' | 'warning' | 'critical' | 'danger' {
  if (score >= 80) return 'healthy';
  if (score >= 60) return 'warning';
  if (score >= 40) return 'critical';
  return 'danger';
}

/**
 * Generates a human-readable health reason.
 * @param branch - Branch information
 * @returns Reason string
 */
export function getHealthReason(branch: BranchInfo): string {
  const reasons: string[] = [];
  if (branch.isMerged) reasons.push('merged');
  if (branch.daysOld > 60) reasons.push(`${branch.daysOld}d old`);
  if (branch.remoteGone) reasons.push('remote deleted');
  if (branch.behind && branch.behind > 20) reasons.push(`${branch.behind} behind`);
  return reasons.length > 0 ? reasons.join(', ') : 'active';
}

/**
 * Extracts issue number from branch name.
 * @param branchName - Branch name to parse
 * @returns Issue reference or undefined
 */
export function extractIssueFromBranch(branchName: string): string | undefined {
  const patterns = [
    /(?:^|\/)(#?\d+)(?:[-_]|$)/,
    /(?:^|\/)([A-Z]+-\d+)(?:[-_]|$)/i,
    /(?:^|\/)(GH-\d+)(?:[-_]|$)/i,
  ];

  for (const pattern of patterns) {
    const match = branchName.match(pattern);
    if (match) return match[1];
  }
  return undefined;
}
