import { describe, expect, test } from 'vitest';
import { calculateHealthScore, getHealthStatus, getHealthReason, extractIssueFromBranch } from './health';
import type { BranchInfo } from '../types';

function makeBranch(overrides: Partial<BranchInfo> = {}): BranchInfo {
  return {
    name: 'feat/x',
    isCurrentBranch: false,
    isMerged: false,
    daysOld: 0,
    ahead: 0,
    behind: 0,
    ...overrides,
  } as BranchInfo;
}

describe('calculateHealthScore', () => {
  test('returns 100 for fresh, unmerged branch', () => {
    expect(calculateHealthScore(makeBranch(), 30)).toBe(100);
  });

  test('subtracts 40 when merged', () => {
    expect(calculateHealthScore(makeBranch({ isMerged: true }), 30)).toBe(60);
  });

  test('subtracts 30 for branch older than 2x stale threshold', () => {
    expect(calculateHealthScore(makeBranch({ daysOld: 70 }), 30)).toBe(70);
  });

  test('subtracts 20 for branch older than stale threshold', () => {
    expect(calculateHealthScore(makeBranch({ daysOld: 35 }), 30)).toBe(80);
  });

  test('subtracts 10 for branch older than half stale threshold', () => {
    expect(calculateHealthScore(makeBranch({ daysOld: 20 }), 30)).toBe(90);
  });

  test('subtracts 20 for remoteGone', () => {
    expect(calculateHealthScore(makeBranch({ remoteGone: true }), 30)).toBe(80);
  });

  test('subtracts 10 for behind > 50', () => {
    expect(calculateHealthScore(makeBranch({ behind: 100 }), 30)).toBe(90);
  });

  test('subtracts 5 for behind > 20', () => {
    expect(calculateHealthScore(makeBranch({ behind: 30 }), 30)).toBe(95);
  });

  test('clamps to minimum 0', () => {
    const branch = makeBranch({ isMerged: true, daysOld: 100, remoteGone: true, behind: 100 });
    expect(calculateHealthScore(branch, 30)).toBe(0);
  });

  test('clamps to maximum 100', () => {
    expect(calculateHealthScore(makeBranch(), 30)).toBe(100);
  });
});

describe('getHealthStatus', () => {
  test('returns healthy for >= 80', () => {
    expect(getHealthStatus(100)).toBe('healthy');
    expect(getHealthStatus(80)).toBe('healthy');
  });

  test('returns warning for 60-79', () => {
    expect(getHealthStatus(79)).toBe('warning');
    expect(getHealthStatus(60)).toBe('warning');
  });

  test('returns critical for 40-59', () => {
    expect(getHealthStatus(59)).toBe('critical');
    expect(getHealthStatus(40)).toBe('critical');
  });

  test('returns danger for < 40', () => {
    expect(getHealthStatus(39)).toBe('danger');
    expect(getHealthStatus(0)).toBe('danger');
  });
});

describe('getHealthReason', () => {
  test('returns "active" for healthy branch', () => {
    expect(getHealthReason(makeBranch())).toBe('active');
  });

  test('reports merged status', () => {
    expect(getHealthReason(makeBranch({ isMerged: true }))).toContain('merged');
  });

  test('reports age when > 60 days', () => {
    expect(getHealthReason(makeBranch({ daysOld: 90 }))).toContain('90d old');
  });

  test('reports remote deleted', () => {
    expect(getHealthReason(makeBranch({ remoteGone: true }))).toContain('remote deleted');
  });

  test('reports behind count when > 20', () => {
    expect(getHealthReason(makeBranch({ behind: 30 }))).toContain('30 behind');
  });

  test('combines multiple reasons with comma', () => {
    const reason = getHealthReason(makeBranch({ isMerged: true, remoteGone: true }));
    expect(reason).toContain('merged');
    expect(reason).toContain('remote deleted');
    expect(reason).toMatch(/, /);
  });
});

describe('extractIssueFromBranch', () => {
  test('extracts numeric issue from feat/123-foo', () => {
    expect(extractIssueFromBranch('feat/123-foo')).toBe('123');
  });

  test('extracts numeric issue with # prefix', () => {
    expect(extractIssueFromBranch('feat/#456-bar')).toBe('#456');
  });

  test('extracts JIRA-style key (PROJ-123)', () => {
    expect(extractIssueFromBranch('feat/PROJ-123-foo')).toBe('PROJ-123');
  });

  test('extracts GH-style key (GH-789)', () => {
    expect(extractIssueFromBranch('feat/GH-789-bar')).toBe('GH-789');
  });

  test('returns undefined when no issue ID matches', () => {
    expect(extractIssueFromBranch('main')).toBeUndefined();
    expect(extractIssueFromBranch('feature/no-issue')).toBeUndefined();
  });

  test('extracts from start of branch name', () => {
    expect(extractIssueFromBranch('123-foo')).toBe('123');
  });
});
