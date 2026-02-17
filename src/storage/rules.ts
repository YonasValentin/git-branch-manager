import * as vscode from 'vscode';
import { CleanupRule, BranchInfo } from '../types';
import { safeRegexTest } from '../utils/regex';

/**
 * Gets cleanup rules from extension storage, scoped to a repository.
 * @param context - Extension context
 * @param repoPath - Repository path for scoping (canonical git root)
 * @returns Array of cleanup rules
 */
export function getCleanupRules(context: vscode.ExtensionContext, repoPath: string): CleanupRule[] {
  const key = `cleanupRules:${repoPath}`;
  return context.workspaceState.get<CleanupRule[]>(key, []);
}

/**
 * Saves cleanup rules to extension storage, scoped to a repository.
 * @param context - Extension context
 * @param repoPath - Repository path for scoping (canonical git root)
 * @param rules - Rules to save
 */
export async function saveCleanupRules(
  context: vscode.ExtensionContext,
  repoPath: string,
  rules: CleanupRule[]
): Promise<void> {
  const key = `cleanupRules:${repoPath}`;
  await context.workspaceState.update(key, rules);
}

/**
 * Evaluates which branches match a cleanup rule.
 * @param branches - All branches
 * @param rule - Rule to evaluate
 * @returns Matching branches
 */
export function evaluateCleanupRule(
  branches: BranchInfo[],
  rule: CleanupRule
): BranchInfo[] {
  return branches.filter(b => {
    if (b.isCurrentBranch) return false;
    if (rule.conditions.merged !== undefined && b.isMerged !== rule.conditions.merged) return false;
    if (rule.conditions.olderThanDays && b.daysOld < rule.conditions.olderThanDays) return false;
    if (rule.conditions.noRemote && b.hasRemote) return false;
    if (rule.conditions.pattern) {
      const result = safeRegexTest(rule.conditions.pattern, b.name);
      if (result.error) {
        console.warn(`Skipping rule: invalid regex pattern - ${result.error}`);
        return false;
      }
      if (!result.matches) return false;
    }
    return true;
  });
}
