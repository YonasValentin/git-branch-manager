import * as vscode from 'vscode';
import { CleanupRule, BranchInfo } from '../types';
import { safeRegexTest } from '../utils/regex';

/**
 * Gets cleanup rules from extension storage.
 * @param context - Extension context
 * @returns Array of cleanup rules
 */
export function getCleanupRules(context: vscode.ExtensionContext): CleanupRule[] {
  return context.globalState.get<CleanupRule[]>('cleanupRules', []);
}

/**
 * Saves cleanup rules to extension storage.
 * @param context - Extension context
 * @param rules - Rules to save
 */
export async function saveCleanupRules(
  context: vscode.ExtensionContext,
  rules: CleanupRule[]
): Promise<void> {
  await context.globalState.update('cleanupRules', rules);
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
