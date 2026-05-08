import { describe, expect, test } from 'vitest';
import {
  buildInitialData,
  hashColor,
  initials,
  mapBranchStatus,
  PROTECTED_NAMES,
} from './buildInitialData';
import type { BranchInfo, BranchNote } from '../types';

const baseBranch = (over: Partial<BranchInfo> = {}): BranchInfo => ({
  name: 'feature/x',
  isMerged: false,
  lastCommitDate: new Date('2026-01-01T00:00:00Z'),
  daysOld: 5,
  isCurrentBranch: false,
  ahead: 0,
  behind: 0,
  remoteGone: false,
  ...over,
});

describe('hashColor', () => {
  test('returns the same color for the same input (deterministic)', () => {
    expect(hashColor('Alice')).toBe(hashColor('Alice'));
  });

  test('returns a hex color string', () => {
    expect(hashColor('Bob')).toMatch(/^#[0-9a-f]{6}$/i);
  });

  test('returns a value from a fixed palette of 8 colors', () => {
    const palette = new Set<string>();
    for (const name of ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i', 'j', 'k', 'l']) {
      palette.add(hashColor(name));
    }
    // Palette has 8 colors total
    expect(palette.size).toBeLessThanOrEqual(8);
  });

  test('handles empty string without crashing', () => {
    expect(hashColor('')).toMatch(/^#[0-9a-f]{6}$/i);
  });
});

describe('initials', () => {
  test('two-word name produces FL', () => {
    expect(initials('Alice Smith')).toBe('AS');
  });

  test('three-word name uses first and last initial', () => {
    expect(initials('Alice Maud Smith')).toBe('AS');
  });

  test('single-word name takes first two letters uppercase', () => {
    expect(initials('alice')).toBe('AL');
  });

  test('handles single-character name', () => {
    expect(initials('A')).toBe('A');
  });

  test('strips leading/trailing whitespace', () => {
    expect(initials('  Bob Jones  ')).toBe('BJ');
  });
});

describe('mapBranchStatus', () => {
  test('isMerged → "merged"', () => {
    expect(mapBranchStatus({ isMerged: true, remoteGone: false, daysOld: 1 }, 30)).toBe('merged');
  });

  test('remoteGone && !isMerged → "orphaned"', () => {
    expect(mapBranchStatus({ isMerged: false, remoteGone: true, daysOld: 1 }, 30)).toBe('orphaned');
  });

  test('daysOld > staleDays && !merged && !gone → "stale"', () => {
    expect(mapBranchStatus({ isMerged: false, remoteGone: false, daysOld: 31 }, 30)).toBe('stale');
  });

  test('daysOld === staleDays is NOT stale (boundary)', () => {
    expect(mapBranchStatus({ isMerged: false, remoteGone: false, daysOld: 30 }, 30)).toBe('active');
  });

  test('default → "active"', () => {
    expect(mapBranchStatus({ isMerged: false, remoteGone: false, daysOld: 0 }, 30)).toBe('active');
  });

  test('merged trumps remoteGone (a merged-and-gone branch reports merged, not orphaned)', () => {
    expect(mapBranchStatus({ isMerged: true, remoteGone: true, daysOld: 99 }, 30)).toBe('merged');
  });
});

describe('buildInitialData', () => {
  test('returns empty wire shape from empty inputs', () => {
    const out = buildInitialData([], [], [], [], [], [], new Map(), 'main', 'main', 'my-repo', 30);
    expect(out.repo.name).toBe('my-repo');
    expect(out.repo.currentBranch).toBe('main');
    expect(out.repo.defaultBranch).toBe('main');
    expect(out.repo.staleDays).toBe(30);
    expect(out.branches).toEqual([]);
    expect(out.remoteBranches).toEqual([]);
    expect(out.worktrees).toEqual([]);
    expect(out.stashes).toEqual([]);
    expect(out.cleanupRules).toEqual([]);
    expect(out.recoveryLog).toEqual([]);
    expect(out.authors).toEqual({});
  });

  test('repo.protectedBranches is the canonical list', () => {
    const out = buildInitialData([], [], [], [], [], [], new Map(), 'main', 'main', 'r', 30);
    expect(out.repo.protectedBranches).toEqual(PROTECTED_NAMES);
  });

  test('marks branches in the protected list as isProtected', () => {
    const branches = [baseBranch({ name: 'main' }), baseBranch({ name: 'feature/x' })];
    const out = buildInitialData(branches, [], [], [], [], [], new Map(), 'main', 'main', 'r', 30);
    expect(out.branches[0]?.isProtected).toBe(true);
    expect(out.branches[1]?.isProtected).toBe(false);
  });

  test('forwards isCurrent from BranchInfo.isCurrentBranch', () => {
    const branches = [baseBranch({ name: 'main', isCurrentBranch: true })];
    const out = buildInitialData(branches, [], [], [], [], [], new Map(), 'main', 'main', 'r', 30);
    expect(out.branches[0]?.isCurrent).toBe(true);
  });

  test('joins branch notes from the notes map (round-trip — was hardcoded null)', () => {
    const branches = [baseBranch({ name: 'feature/foo' })];
    const notes = new Map<string, BranchNote>([
      ['feature/foo', { branch: 'feature/foo', note: 'remember to update CHANGELOG', updatedAt: 0 }],
    ]);
    const out = buildInitialData(branches, [], [], [], [], [], notes, 'main', 'main', 'r', 30);
    expect(out.branches[0]?.note).toBe('remember to update CHANGELOG');
  });

  test('returns null note when no entry exists in the map', () => {
    const branches = [baseBranch({ name: 'feature/foo' })];
    const out = buildInitialData(branches, [], [], [], [], [], new Map(), 'main', 'main', 'r', 30);
    expect(out.branches[0]?.note).toBeNull();
  });

  test('derives authors map from unique branch authors with initials and color', () => {
    const branches = [
      baseBranch({ name: 'a', author: 'Alice Smith' }),
      baseBranch({ name: 'b', author: 'Alice Smith' }), // dupe
      baseBranch({ name: 'c', author: 'Bob Jones' }),
      baseBranch({ name: 'd' }), // no author
    ];
    const out = buildInitialData(branches, [], [], [], [], [], new Map(), 'main', 'main', 'r', 30);
    expect(Object.keys(out.authors).sort()).toEqual(['Alice Smith', 'Bob Jones']);
    expect(out.authors['Alice Smith']?.initials).toBe('AS');
    expect(out.authors['Alice Smith']?.color).toMatch(/^#[0-9a-f]{6}$/i);
  });

  test('falls back to "Unknown" when branch has no author', () => {
    const branches = [baseBranch({ name: 'feature/x', author: undefined })];
    const out = buildInitialData(branches, [], [], [], [], [], new Map(), 'main', 'main', 'r', 30);
    expect(out.branches[0]?.author).toBe('Unknown');
  });

  test('computes status using mapBranchStatus with the staleDays parameter', () => {
    const branches = [
      baseBranch({ name: 'a', isMerged: true }),
      baseBranch({ name: 'b', remoteGone: true }),
      baseBranch({ name: 'c', daysOld: 60 }),
      baseBranch({ name: 'd', daysOld: 5 }),
    ];
    const out = buildInitialData(branches, [], [], [], [], [], new Map(), 'main', 'main', 'r', 30);
    expect(out.branches[0]?.status).toBe('merged');
    expect(out.branches[1]?.status).toBe('orphaned');
    expect(out.branches[2]?.status).toBe('stale');
    expect(out.branches[3]?.status).toBe('active');
  });

  test('preserves ahead/behind from BranchInfo, defaulting missing values to 0', () => {
    const branches = [
      baseBranch({ name: 'a', ahead: 3, behind: 7 }),
      baseBranch({ name: 'b' }), // no ahead/behind
    ];
    const out = buildInitialData(branches, [], [], [], [], [], new Map(), 'main', 'main', 'r', 30);
    expect(out.branches[0]?.ahead).toBe(3);
    expect(out.branches[0]?.behind).toBe(7);
    expect(out.branches[1]?.ahead).toBe(0);
    expect(out.branches[1]?.behind).toBe(0);
  });

  test('uses fallback "main" when defaultBranch is empty string', () => {
    const out = buildInitialData([], [], [], [], [], [], new Map(), 'topic', '', 'r', 30);
    expect(out.repo.defaultBranch).toBe('main');
  });

  test('passes cleanup rules through unchanged', () => {
    const rules = [
      { id: 'r1', name: 'merged', enabled: true, conditions: { merged: true }, action: 'delete' as const },
    ];
    const out = buildInitialData([], [], [], [], rules, [], new Map(), 'main', 'main', 'r', 30);
    expect(out.cleanupRules).toEqual(rules);
  });
});
