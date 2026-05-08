import { describe, expect, test, vi, beforeEach } from 'vitest';
import * as vscode from 'vscode';
import { getBranchNotes, saveBranchNote } from './notes';
import { getCleanupRules, saveCleanupRules, evaluateCleanupRule } from './rules';
import { getRecoveryLog, addRecoveryEntry, removeRecoveryEntry, clearRecoveryLog } from './recovery';
import type { BranchInfo, CleanupRule, DeletedBranchEntry } from '../types';

vi.mock('vscode', () => ({}), { virtual: true });

function makeContext(): vscode.ExtensionContext {
  const store = new Map<string, unknown>();
  const memento = {
    get: <T>(key: string, defaultValue?: T): T => (store.has(key) ? (store.get(key) as T) : (defaultValue as T)),
    update: async (key: string, value: unknown): Promise<void> => {
      store.set(key, value);
    },
    keys: () => Array.from(store.keys()),
  };
  return { workspaceState: memento, globalState: memento } as unknown as vscode.ExtensionContext;
}

describe('saveBranchNote / getBranchNotes', () => {
  let ctx: vscode.ExtensionContext;
  beforeEach(() => { ctx = makeContext(); });

  test('round-trips a note', async () => {
    await saveBranchNote(ctx, '/repo', 'feat/x', 'remember to rebase');
    const notes = getBranchNotes(ctx, '/repo');
    expect(notes.get('feat/x')!.note).toBe('remember to rebase');
  });

  test('trims whitespace from note', async () => {
    await saveBranchNote(ctx, '/repo', 'feat/x', '   spaced   ');
    expect(getBranchNotes(ctx, '/repo').get('feat/x')!.note).toBe('spaced');
  });

  test('empty note deletes the entry', async () => {
    await saveBranchNote(ctx, '/repo', 'feat/x', 'note');
    await saveBranchNote(ctx, '/repo', 'feat/x', '');
    expect(getBranchNotes(ctx, '/repo').has('feat/x')).toBe(false);
  });

  test('per-repo namespacing', async () => {
    await saveBranchNote(ctx, '/repo-a', 'feat/x', 'A');
    await saveBranchNote(ctx, '/repo-b', 'feat/x', 'B');
    expect(getBranchNotes(ctx, '/repo-a').get('feat/x')!.note).toBe('A');
    expect(getBranchNotes(ctx, '/repo-b').get('feat/x')!.note).toBe('B');
  });

  test('returns empty Map for unknown repo', () => {
    expect(getBranchNotes(ctx, '/never-saved').size).toBe(0);
  });
});

describe('saveCleanupRules / getCleanupRules', () => {
  let ctx: vscode.ExtensionContext;
  beforeEach(() => { ctx = makeContext(); });

  const rule: CleanupRule = {
    id: 'r1',
    name: 'Old merged',
    enabled: true,
    conditions: { merged: true, olderThanDays: 30 },
  };

  test('round-trips rules', async () => {
    await saveCleanupRules(ctx, '/repo', [rule]);
    const rules = getCleanupRules(ctx, '/repo');
    expect(rules).toEqual([rule]);
  });

  test('returns empty array for unknown repo', () => {
    expect(getCleanupRules(ctx, '/never')).toEqual([]);
  });

  test('per-repo namespacing', async () => {
    await saveCleanupRules(ctx, '/a', [rule]);
    await saveCleanupRules(ctx, '/b', []);
    expect(getCleanupRules(ctx, '/a')).toEqual([rule]);
    expect(getCleanupRules(ctx, '/b')).toEqual([]);
  });

  test('overwrites previous rules', async () => {
    await saveCleanupRules(ctx, '/repo', [rule]);
    await saveCleanupRules(ctx, '/repo', []);
    expect(getCleanupRules(ctx, '/repo')).toEqual([]);
  });
});

describe('evaluateCleanupRule', () => {
  function makeBranch(overrides: Partial<BranchInfo> = {}): BranchInfo {
    return {
      name: 'feat/x',
      isCurrentBranch: false,
      isMerged: false,
      daysOld: 0,
      ahead: 0,
      behind: 0,
      hasRemote: true,
      ...overrides,
    } as BranchInfo;
  }

  test('excludes the current branch', () => {
    const branches = [makeBranch({ name: 'main', isCurrentBranch: true, isMerged: true })];
    const rule: CleanupRule = { id: 'r', name: 'r', enabled: true, conditions: { merged: true } };
    expect(evaluateCleanupRule(branches, rule)).toEqual([]);
  });

  test('matches by merged condition', () => {
    const branches = [
      makeBranch({ name: 'feat/a', isMerged: true }),
      makeBranch({ name: 'feat/b', isMerged: false }),
    ];
    const rule: CleanupRule = { id: 'r', name: 'r', enabled: true, conditions: { merged: true } };
    const result = evaluateCleanupRule(branches, rule);
    expect(result.map((b) => b.name)).toEqual(['feat/a']);
  });

  test('matches by olderThanDays', () => {
    const branches = [
      makeBranch({ name: 'feat/a', daysOld: 100 }),
      makeBranch({ name: 'feat/b', daysOld: 5 }),
    ];
    const rule: CleanupRule = { id: 'r', name: 'r', enabled: true, conditions: { olderThanDays: 30 } };
    const result = evaluateCleanupRule(branches, rule);
    expect(result.map((b) => b.name)).toEqual(['feat/a']);
  });

  test('matches by noRemote', () => {
    const branches = [
      makeBranch({ name: 'feat/a', hasRemote: true }),
      makeBranch({ name: 'feat/b', hasRemote: false }),
    ];
    const rule: CleanupRule = { id: 'r', name: 'r', enabled: true, conditions: { noRemote: true } };
    const result = evaluateCleanupRule(branches, rule);
    expect(result.map((b) => b.name)).toEqual(['feat/b']);
  });

  test('matches by pattern', () => {
    const branches = [
      makeBranch({ name: 'feat/old' }),
      makeBranch({ name: 'main' }),
    ];
    const rule: CleanupRule = { id: 'r', name: 'r', enabled: true, conditions: { pattern: '^feat/' } };
    expect(evaluateCleanupRule(branches, rule).map((b) => b.name)).toEqual(['feat/old']);
  });

  test('skips invalid regex pattern silently', () => {
    const branches = [makeBranch()];
    const rule: CleanupRule = { id: 'r', name: 'r', enabled: true, conditions: { pattern: '(a+)+' } };
    expect(evaluateCleanupRule(branches, rule)).toEqual([]);
  });

  test('combines multiple conditions (AND)', () => {
    const branches = [
      makeBranch({ name: 'feat/a', isMerged: true, daysOld: 100 }),
      makeBranch({ name: 'feat/b', isMerged: true, daysOld: 5 }),
      makeBranch({ name: 'feat/c', isMerged: false, daysOld: 100 }),
    ];
    const rule: CleanupRule = {
      id: 'r', name: 'r', enabled: true,
      conditions: { merged: true, olderThanDays: 30 },
    };
    expect(evaluateCleanupRule(branches, rule).map((b) => b.name)).toEqual(['feat/a']);
  });
});

describe('recovery log', () => {
  let ctx: vscode.ExtensionContext;
  beforeEach(() => { ctx = makeContext(); });

  const entry = (n: number): DeletedBranchEntry => ({
    branchName: `feat/${n}`,
    commitHash: `hash${n}`,
    deletedAt: Date.now() - n * 1000,
  });

  test('returns empty array for unknown repo', () => {
    expect(getRecoveryLog(ctx, '/r')).toEqual([]);
  });

  test('addRecoveryEntry prepends newest entry', async () => {
    await addRecoveryEntry(ctx, '/r', entry(1));
    await addRecoveryEntry(ctx, '/r', entry(2));
    const log = getRecoveryLog(ctx, '/r');
    expect(log[0]!.branchName).toBe('feat/2');
    expect(log[1]!.branchName).toBe('feat/1');
  });

  test('caps at 50 entries (FIFO)', async () => {
    for (let i = 0; i < 60; i++) {
      await addRecoveryEntry(ctx, '/r', entry(i));
    }
    const log = getRecoveryLog(ctx, '/r');
    expect(log).toHaveLength(50);
    expect(log[0]!.branchName).toBe('feat/59');
  });

  test('removeRecoveryEntry removes only matching entry', async () => {
    await addRecoveryEntry(ctx, '/r', entry(1));
    await addRecoveryEntry(ctx, '/r', entry(2));
    await removeRecoveryEntry(ctx, '/r', 'feat/1', 'hash1');
    const log = getRecoveryLog(ctx, '/r');
    expect(log).toHaveLength(1);
    expect(log[0]!.branchName).toBe('feat/2');
  });

  test('removeRecoveryEntry no-op when not found', async () => {
    await addRecoveryEntry(ctx, '/r', entry(1));
    await removeRecoveryEntry(ctx, '/r', 'never', 'never');
    expect(getRecoveryLog(ctx, '/r')).toHaveLength(1);
  });

  test('clearRecoveryLog empties the log', async () => {
    await addRecoveryEntry(ctx, '/r', entry(1));
    await addRecoveryEntry(ctx, '/r', entry(2));
    await clearRecoveryLog(ctx, '/r');
    expect(getRecoveryLog(ctx, '/r')).toEqual([]);
  });

  test('per-repo namespacing', async () => {
    await addRecoveryEntry(ctx, '/a', entry(1));
    await addRecoveryEntry(ctx, '/b', entry(2));
    expect(getRecoveryLog(ctx, '/a')).toHaveLength(1);
    expect(getRecoveryLog(ctx, '/b')).toHaveLength(1);
    expect(getRecoveryLog(ctx, '/a')[0]!.branchName).toBe('feat/1');
    expect(getRecoveryLog(ctx, '/b')[0]!.branchName).toBe('feat/2');
  });
});
