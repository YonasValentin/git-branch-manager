import { describe, expect, test, vi } from 'vitest';
import { dispatchWebviewMessage, type WebviewMessageDeps } from './dispatchWebviewMessage';
import type { CleanupRule } from '../types';

function makeDeps(overrides: Partial<WebviewMessageDeps> = {}): WebviewMessageDeps {
  const fakeContext = {
    globalState: {
      get: vi.fn().mockReturnValue(0),
      update: vi.fn().mockResolvedValue(undefined),
    },
    workspaceState: {
      get: vi.fn().mockReturnValue(undefined),
      update: vi.fn().mockResolvedValue(undefined),
    },
  };
  return {
    context: fakeContext as unknown as WebviewMessageDeps['context'],
    gitRoot: '/repo',
    ui: {
      showInfo: vi.fn(),
      showWarning: vi.fn(),
      showError: vi.fn(),
      showInputBox: vi.fn().mockResolvedValue(undefined),
      showWarningModal: vi.fn().mockResolvedValue(undefined),
      showInfoModal: vi.fn().mockResolvedValue(undefined),
    },
    env: {
      openExternal: vi.fn().mockResolvedValue(true),
      executeCommand: vi.fn().mockResolvedValue(undefined),
      clipboardRead: vi.fn().mockResolvedValue(''),
      clipboardWrite: vi.fn().mockResolvedValue(undefined),
    },
    git: {
      deleteBranchForce: vi.fn().mockResolvedValue(undefined),
      checkout: vi.fn().mockResolvedValue(undefined),
      rename: vi.fn().mockResolvedValue(undefined),
      compare: vi.fn().mockResolvedValue({}),
      timeline: vi.fn().mockResolvedValue([]),
      branchInfo: vi.fn().mockResolvedValue([]),
      createStash: vi.fn().mockResolvedValue(undefined),
      applyStash: vi.fn().mockResolvedValue(undefined),
      popStash: vi.fn().mockResolvedValue(undefined),
      dropStash: vi.fn().mockResolvedValue(undefined),
      clearStashes: vi.fn().mockResolvedValue(undefined),
    },
    storage: {
      saveBranchNote: vi.fn().mockResolvedValue(undefined),
      getCleanupRules: vi.fn().mockReturnValue([]),
      saveCleanupRules: vi.fn().mockResolvedValue(undefined),
      evaluateCleanupRule: vi.fn().mockReturnValue([]),
      removeRecoveryEntry: vi.fn().mockResolvedValue(undefined),
      restoreFromLog: vi.fn().mockResolvedValue({ success: true }),
    },
    hooks: {
      createBranchFromTemplate: vi.fn().mockResolvedValue(undefined),
      createWorktreeFromBranch: vi.fn().mockResolvedValue(undefined),
      getGitHubToken: vi.fn().mockResolvedValue('token'),
      recordBranchDeleted: vi.fn().mockResolvedValue(undefined),
      selectRepository: vi.fn().mockResolvedValue(undefined),
      setActiveRepository: vi.fn().mockResolvedValue(undefined),
      discoverRepositories: vi.fn().mockResolvedValue(undefined),
      getRepositoriesCount: vi.fn().mockReturnValue(2),
      branchTreeRefresh: vi.fn(),
      openDiff: vi.fn().mockResolvedValue(undefined),
    },
    post: vi.fn(),
    updateWebview: vi.fn().mockResolvedValue(undefined),
    updateStatusBar: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

describe('dispatchWebviewMessage — input validation', () => {
  test('returns silently for null message', async () => {
    const deps = makeDeps();
    await dispatchWebviewMessage(null, deps);
    expect(deps.git.deleteBranchForce).not.toHaveBeenCalled();
  });

  test('returns silently for non-object message', async () => {
    const deps = makeDeps();
    await dispatchWebviewMessage('not-an-object', deps);
    expect(deps.git.deleteBranchForce).not.toHaveBeenCalled();
  });

  test('returns silently for missing command field', async () => {
    const deps = makeDeps();
    await dispatchWebviewMessage({ branchName: 'foo' }, deps);
    expect(deps.git.deleteBranchForce).not.toHaveBeenCalled();
  });

  test('returns silently for non-string command field', async () => {
    const deps = makeDeps();
    await dispatchWebviewMessage({ command: 123 }, deps);
    expect(deps.git.deleteBranchForce).not.toHaveBeenCalled();
  });

  test('returns silently for unknown command', async () => {
    const deps = makeDeps();
    await dispatchWebviewMessage({ command: 'mystery' }, deps);
    expect(deps.git.deleteBranchForce).not.toHaveBeenCalled();
  });
});

describe('dispatchWebviewMessage — delete', () => {
  test('deletes branch, shows info, records, refreshes', async () => {
    const deps = makeDeps();
    await dispatchWebviewMessage({ command: 'delete', branchName: 'feat/foo' }, deps);
    expect(deps.git.deleteBranchForce).toHaveBeenCalledWith('/repo', 'feat/foo');
    expect(deps.ui.showInfo).toHaveBeenCalledWith('Deleted branch: feat/foo');
    expect(deps.hooks.recordBranchDeleted).toHaveBeenCalledWith(1);
    expect(deps.updateWebview).toHaveBeenCalled();
    expect(deps.updateStatusBar).toHaveBeenCalled();
  });

  test('rejects invalid branch ref (flag injection)', async () => {
    const deps = makeDeps();
    await dispatchWebviewMessage({ command: 'delete', branchName: '-evil' }, deps);
    expect(deps.git.deleteBranchForce).not.toHaveBeenCalled();
    expect(deps.ui.showError).toHaveBeenCalled();
  });

  test('shows error when git.deleteBranchForce throws', async () => {
    const deps = makeDeps({
      git: { ...makeDeps().git, deleteBranchForce: vi.fn().mockRejectedValue(new Error('not found')) },
    });
    await dispatchWebviewMessage({ command: 'delete', branchName: 'feat/foo' }, deps);
    expect(deps.ui.showError).toHaveBeenCalled();
    expect(deps.hooks.recordBranchDeleted).not.toHaveBeenCalled();
  });
});

describe('dispatchWebviewMessage — deleteMultiple', () => {
  test('deletes all branches, records total success', async () => {
    const deps = makeDeps();
    await dispatchWebviewMessage(
      { command: 'deleteMultiple', branchNames: ['a', 'b', 'c'] },
      deps,
    );
    expect(deps.git.deleteBranchForce).toHaveBeenCalledTimes(3);
    expect(deps.hooks.recordBranchDeleted).toHaveBeenCalledWith(3);
    expect(deps.ui.showInfo).toHaveBeenCalledWith('Deleted 3 branches');
  });

  test('shows warning for failed branches but continues', async () => {
    const deleteFn = vi.fn()
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new Error('fail'))
      .mockResolvedValueOnce(undefined);
    const deps = makeDeps({ git: { ...makeDeps().git, deleteBranchForce: deleteFn } });
    await dispatchWebviewMessage(
      { command: 'deleteMultiple', branchNames: ['a', 'b', 'c'] },
      deps,
    );
    expect(deleteFn).toHaveBeenCalledTimes(3);
    expect(deps.ui.showInfo).toHaveBeenCalledWith('Deleted 2 branches');
    expect(deps.ui.showWarning).toHaveBeenCalledWith('Failed to delete 1 branches');
    expect(deps.hooks.recordBranchDeleted).toHaveBeenCalledWith(2);
  });
});

describe('dispatchWebviewMessage — switch', () => {
  test('checks out branch, shows info, refreshes', async () => {
    const deps = makeDeps();
    await dispatchWebviewMessage({ command: 'switch', branchName: 'main' }, deps);
    expect(deps.git.checkout).toHaveBeenCalledWith('/repo', 'main');
    expect(deps.ui.showInfo).toHaveBeenCalledWith('Switched to branch: main');
  });

  test('rejects invalid ref', async () => {
    const deps = makeDeps();
    await dispatchWebviewMessage({ command: 'switch', branchName: '-flag' }, deps);
    expect(deps.git.checkout).not.toHaveBeenCalled();
    expect(deps.ui.showError).toHaveBeenCalled();
  });
});

describe('dispatchWebviewMessage — stash operations', () => {
  test('createStash with input prompts user, creates stash', async () => {
    const deps = makeDeps({
      ui: { ...makeDeps().ui, showInputBox: vi.fn().mockResolvedValue('WIP work') },
    });
    await dispatchWebviewMessage({ command: 'createStash' }, deps);
    expect(deps.ui.showInputBox).toHaveBeenCalled();
    expect(deps.git.createStash).toHaveBeenCalledWith('/repo', 'WIP work');
    expect(deps.ui.showInfo).toHaveBeenCalledWith('Created stash');
  });

  test('createStash skipped when user dismisses prompt', async () => {
    const deps = makeDeps();
    await dispatchWebviewMessage({ command: 'createStash' }, deps);
    expect(deps.git.createStash).not.toHaveBeenCalled();
  });

  test('createStash with empty input passes undefined to git', async () => {
    const deps = makeDeps({
      ui: { ...makeDeps().ui, showInputBox: vi.fn().mockResolvedValue('') },
    });
    await dispatchWebviewMessage({ command: 'createStash' }, deps);
    expect(deps.git.createStash).toHaveBeenCalledWith('/repo', undefined);
  });

  test('applyStash uses the index', async () => {
    const deps = makeDeps();
    await dispatchWebviewMessage({ command: 'applyStash', index: 2 }, deps);
    expect(deps.git.applyStash).toHaveBeenCalledWith('/repo', 2);
    expect(deps.ui.showInfo).toHaveBeenCalledWith('Applied stash 2');
  });

  test('popStash uses the index', async () => {
    const deps = makeDeps();
    await dispatchWebviewMessage({ command: 'popStash', index: 0 }, deps);
    expect(deps.git.popStash).toHaveBeenCalledWith('/repo', 0);
  });

  test('dropStash uses the index', async () => {
    const deps = makeDeps();
    await dispatchWebviewMessage({ command: 'dropStash', index: 1 }, deps);
    expect(deps.git.dropStash).toHaveBeenCalledWith('/repo', 1);
  });

  test('clearStashes only clears after modal confirm', async () => {
    const deps = makeDeps({
      ui: { ...makeDeps().ui, showWarningModal: vi.fn().mockResolvedValue('Clear All') },
    });
    await dispatchWebviewMessage({ command: 'clearStashes' }, deps);
    expect(deps.git.clearStashes).toHaveBeenCalledWith('/repo');
  });

  test('clearStashes does not clear when user dismisses modal', async () => {
    const deps = makeDeps();
    await dispatchWebviewMessage({ command: 'clearStashes' }, deps);
    expect(deps.git.clearStashes).not.toHaveBeenCalled();
  });

  test('rejects non-numeric index', async () => {
    const deps = makeDeps();
    await dispatchWebviewMessage({ command: 'applyStash', index: 'two' }, deps);
    expect(deps.git.applyStash).not.toHaveBeenCalled();
    expect(deps.ui.showError).toHaveBeenCalled();
  });
});

describe('dispatchWebviewMessage — compareBranches', () => {
  test('compares and posts result with mapped commit shape', async () => {
    const deps = makeDeps({
      git: {
        ...makeDeps().git,
        compare: vi.fn().mockResolvedValue({
          commitsA: [{ hash: 'abc', message: 'foo', author: 'me', date: '1d', daysOld: 1 }],
          commitsB: [],
          files: [{ path: 'src/foo.ts', status: 'M' }],
        }),
      },
    });
    await dispatchWebviewMessage(
      { command: 'compareBranches', branchA: 'main', branchB: 'feat/x' },
      deps,
    );
    expect(deps.git.compare).toHaveBeenCalledWith('/repo', 'main', 'feat/x');
    expect(deps.post).toHaveBeenCalledWith({
      command: 'comparisonResult',
      data: {
        ahead: [{ hash: 'abc', message: 'foo', author: 'me', date: '1d' }],
        behind: [],
        files: [{ path: 'src/foo.ts', status: 'M', additions: 0, deletions: 0 }],
      },
    });
  });

  test('rejects invalid branchA ref', async () => {
    const deps = makeDeps();
    await dispatchWebviewMessage(
      { command: 'compareBranches', branchA: '-evil', branchB: 'main' },
      deps,
    );
    expect(deps.git.compare).not.toHaveBeenCalled();
    expect(deps.ui.showError).toHaveBeenCalled();
  });
});

describe('dispatchWebviewMessage — getTimeline', () => {
  test('posts timeline result', async () => {
    const commits = [{ hash: 'abc', message: 'foo', author: 'me', date: '1d', daysOld: 1 }];
    const deps = makeDeps({
      git: { ...makeDeps().git, timeline: vi.fn().mockResolvedValue(commits) },
    });
    await dispatchWebviewMessage({ command: 'getTimeline', branchName: 'feat/x' }, deps);
    expect(deps.git.timeline).toHaveBeenCalledWith('/repo', 'feat/x', 5);
    expect(deps.post).toHaveBeenCalledWith({
      command: 'timelineResult',
      data: { branchName: 'feat/x', commits },
    });
  });

  test('silent failure on timeline error', async () => {
    const deps = makeDeps({
      git: { ...makeDeps().git, timeline: vi.fn().mockRejectedValue(new Error('bad')) },
    });
    await dispatchWebviewMessage({ command: 'getTimeline', branchName: 'feat/x' }, deps);
    expect(deps.ui.showError).not.toHaveBeenCalled();
  });
});

describe('dispatchWebviewMessage — renameBranch', () => {
  test('prompts for new name, renames', async () => {
    const deps = makeDeps({
      ui: { ...makeDeps().ui, showInputBox: vi.fn().mockResolvedValue('feat/new') },
    });
    await dispatchWebviewMessage(
      { command: 'renameBranch', oldName: 'feat/old' },
      deps,
    );
    expect(deps.git.rename).toHaveBeenCalledWith('/repo', 'feat/old', 'feat/new');
    expect(deps.ui.showInfo).toHaveBeenCalledWith('Renamed feat/old to feat/new');
  });

  test('skips rename when prompt dismissed', async () => {
    const deps = makeDeps();
    await dispatchWebviewMessage(
      { command: 'renameBranch', oldName: 'feat/old' },
      deps,
    );
    expect(deps.git.rename).not.toHaveBeenCalled();
  });
});

describe('dispatchWebviewMessage — batchRename', () => {
  test('rejects invalid regex pattern', async () => {
    const deps = makeDeps();
    await dispatchWebviewMessage(
      {
        command: 'batchRename',
        pattern: '[invalid(',
        replacement: 'new',
        branches: ['feat/foo'],
      },
      deps,
    );
    expect(deps.ui.showError).toHaveBeenCalled();
    expect(deps.git.rename).not.toHaveBeenCalled();
  });

  test('shows info if no branches match pattern', async () => {
    const deps = makeDeps();
    await dispatchWebviewMessage(
      {
        command: 'batchRename',
        pattern: '^bug-',
        replacement: 'fix-',
        branches: ['feat/foo', 'feat/bar'],
      },
      deps,
    );
    expect(deps.ui.showInfo).toHaveBeenCalledWith('No branches matched the pattern');
  });

  test('renames matching branches after modal confirm', async () => {
    const deps = makeDeps({
      ui: { ...makeDeps().ui, showInfoModal: vi.fn().mockResolvedValue('Rename All') },
    });
    await dispatchWebviewMessage(
      {
        command: 'batchRename',
        pattern: '^feat/',
        replacement: 'feature/',
        branches: ['feat/foo', 'feat/bar', 'main'],
      },
      deps,
    );
    expect(deps.git.rename).toHaveBeenCalledTimes(2);
    expect(deps.git.rename).toHaveBeenCalledWith('/repo', 'feat/foo', 'feature/foo');
    expect(deps.git.rename).toHaveBeenCalledWith('/repo', 'feat/bar', 'feature/bar');
    expect(deps.ui.showInfo).toHaveBeenCalledWith('Renamed 2 branches');
  });

  test('rolls up many failures into one warning', async () => {
    const ren = vi.fn()
      .mockRejectedValue(new Error('boom'));
    const deps = makeDeps({
      ui: { ...makeDeps().ui, showInfoModal: vi.fn().mockResolvedValue('Rename All') },
      git: { ...makeDeps().git, rename: ren },
    });
    await dispatchWebviewMessage(
      {
        command: 'batchRename',
        pattern: '^feat/',
        replacement: 'feature/',
        branches: ['feat/a', 'feat/b', 'feat/c', 'feat/d', 'feat/e'],
      },
      deps,
    );
    const warningCall = (deps.ui.showWarning as unknown as { mock: { calls: unknown[][] } }).mock.calls[0];
    expect(warningCall).toBeDefined();
    expect(warningCall![0]).toMatch(/Failed to rename 5 branches/);
    expect(warningCall![0]).toMatch(/\+2 more/);
  });
});

describe('dispatchWebviewMessage — deleteRemote', () => {
  test('deletes remote branch with full name', async () => {
    const deps = makeDeps();
    await dispatchWebviewMessage(
      { command: 'deleteRemote', remote: 'origin', branch: 'feat/x' },
      deps,
    );
    expect(deps.git.deleteBranchForce).toHaveBeenCalledWith('/repo', 'origin/feat/x');
  });

  test('rejects invalid branch ref', async () => {
    const deps = makeDeps();
    await dispatchWebviewMessage(
      { command: 'deleteRemote', remote: 'origin', branch: '-evil' },
      deps,
    );
    expect(deps.git.deleteBranchForce).not.toHaveBeenCalled();
  });
});

describe('dispatchWebviewMessage — deleteMultipleRemotes', () => {
  test('deletes valid remote branches, ignores malformed entries', async () => {
    const deps = makeDeps();
    await dispatchWebviewMessage(
      {
        command: 'deleteMultipleRemotes',
        branches: [
          { remote: 'origin', name: 'feat/a' },
          { remote: 'origin', name: 'feat/b' },
          { invalid: true },
        ],
      },
      deps,
    );
    expect(deps.git.deleteBranchForce).toHaveBeenCalledTimes(2);
    expect(deps.ui.showInfo).toHaveBeenCalledWith('Deleted 2 remote branches');
  });

  test('skips when branches is not an array', async () => {
    const deps = makeDeps();
    await dispatchWebviewMessage(
      { command: 'deleteMultipleRemotes', branches: 'not-an-array' },
      deps,
    );
    expect(deps.git.deleteBranchForce).not.toHaveBeenCalled();
  });
});

describe('dispatchWebviewMessage — branch notes', () => {
  test('promptBranchNote prompts and saves', async () => {
    const deps = makeDeps({
      ui: { ...makeDeps().ui, showInputBox: vi.fn().mockResolvedValue('a note') },
    });
    await dispatchWebviewMessage(
      { command: 'promptBranchNote', branch: 'feat/x' },
      deps,
    );
    expect(deps.storage.saveBranchNote).toHaveBeenCalledWith(
      deps.context, '/repo', 'feat/x', 'a note',
    );
  });

  test('saveNote saves with branchName field', async () => {
    const deps = makeDeps();
    await dispatchWebviewMessage(
      { command: 'saveNote', branchName: 'feat/x', note: 'hello' },
      deps,
    );
    expect(deps.storage.saveBranchNote).toHaveBeenCalledWith(
      deps.context, '/repo', 'feat/x', 'hello',
    );
  });

  test('saveBranchNote falls back to branch field for legacy callers', async () => {
    const deps = makeDeps();
    await dispatchWebviewMessage(
      { command: 'saveBranchNote', branch: 'feat/x', note: 'hello' },
      deps,
    );
    expect(deps.storage.saveBranchNote).toHaveBeenCalledWith(
      deps.context, '/repo', 'feat/x', 'hello',
    );
  });

  test('saveNote treats non-string note as empty string', async () => {
    const deps = makeDeps();
    await dispatchWebviewMessage(
      { command: 'saveNote', branchName: 'feat/x', note: 123 },
      deps,
    );
    expect(deps.storage.saveBranchNote).toHaveBeenCalledWith(
      deps.context, '/repo', 'feat/x', '',
    );
  });
});

describe('dispatchWebviewMessage — cleanup rules', () => {
  const validRule: CleanupRule = {
    id: 'r1',
    name: 'Old branches',
    enabled: true,
    conditions: { merged: true },
  };

  test('saveCleanupRules persists valid array', async () => {
    const deps = makeDeps();
    await dispatchWebviewMessage(
      { command: 'saveCleanupRules', rules: [validRule] },
      deps,
    );
    expect(deps.storage.saveCleanupRules).toHaveBeenCalledWith(
      deps.context, '/repo', [validRule],
    );
  });

  test('saveCleanupRules rejects malformed payload', async () => {
    const deps = makeDeps();
    await dispatchWebviewMessage(
      { command: 'saveCleanupRules', rules: [{ id: 'incomplete' }] },
      deps,
    );
    expect(deps.storage.saveCleanupRules).not.toHaveBeenCalled();
    expect(deps.ui.showError).toHaveBeenCalled();
  });

  test('evaluateRule posts matching branch names', async () => {
    const deps = makeDeps({
      git: { ...makeDeps().git, branchInfo: vi.fn().mockResolvedValue([{ name: 'feat/foo' }, { name: 'feat/bar' }]) },
      storage: { ...makeDeps().storage, evaluateCleanupRule: vi.fn().mockReturnValue([{ name: 'feat/foo' }]) },
    });
    await dispatchWebviewMessage(
      { command: 'evaluateRule', rule: validRule },
      deps,
    );
    expect(deps.post).toHaveBeenCalledWith({
      command: 'ruleEvaluationResult',
      matches: ['feat/foo'],
    });
  });

  test('evaluateRule ignores rule with non-string id', async () => {
    const deps = makeDeps();
    await dispatchWebviewMessage(
      { command: 'evaluateRule', rule: { name: 'incomplete' } },
      deps,
    );
    expect(deps.post).not.toHaveBeenCalled();
  });

  test('exportRules writes to clipboard', async () => {
    const deps = makeDeps({
      storage: { ...makeDeps().storage, getCleanupRules: vi.fn().mockReturnValue([validRule]) },
    });
    await dispatchWebviewMessage({ command: 'exportRules' }, deps);
    expect(deps.env.clipboardWrite).toHaveBeenCalledWith(JSON.stringify([validRule], null, 2));
    expect(deps.ui.showInfo).toHaveBeenCalledWith('Exported 1 rule(s) to clipboard');
  });

  test('importRules rejects invalid JSON', async () => {
    const deps = makeDeps({
      env: { ...makeDeps().env, clipboardRead: vi.fn().mockResolvedValue('not json') },
    });
    await dispatchWebviewMessage({ command: 'importRules' }, deps);
    expect(deps.storage.saveCleanupRules).not.toHaveBeenCalled();
    expect(deps.ui.showError).toHaveBeenCalledWith('Clipboard does not contain valid JSON');
  });

  test('importRules rejects non-array JSON', async () => {
    const deps = makeDeps({
      env: { ...makeDeps().env, clipboardRead: vi.fn().mockResolvedValue('{"id":"x"}') },
    });
    await dispatchWebviewMessage({ command: 'importRules' }, deps);
    expect(deps.storage.saveCleanupRules).not.toHaveBeenCalled();
    expect(deps.ui.showError).toHaveBeenCalled();
  });

  test('importRules saves valid imported rules and shows info', async () => {
    const deps = makeDeps({
      env: { ...makeDeps().env, clipboardRead: vi.fn().mockResolvedValue(JSON.stringify([validRule])) },
    });
    await dispatchWebviewMessage({ command: 'importRules' }, deps);
    expect(deps.storage.saveCleanupRules).toHaveBeenCalledWith(
      deps.context, '/repo', [validRule],
    );
    expect(deps.ui.showInfo).toHaveBeenCalledWith('Imported 1 rule(s)');
  });

  test('importRules confirms before replacing existing rules', async () => {
    const deps = makeDeps({
      env: { ...makeDeps().env, clipboardRead: vi.fn().mockResolvedValue(JSON.stringify([validRule])) },
      storage: { ...makeDeps().storage, getCleanupRules: vi.fn().mockReturnValue([validRule]) },
      ui: { ...makeDeps().ui, showWarningModal: vi.fn().mockResolvedValue(undefined) },
    });
    await dispatchWebviewMessage({ command: 'importRules' }, deps);
    expect(deps.ui.showWarningModal).toHaveBeenCalled();
    expect(deps.storage.saveCleanupRules).not.toHaveBeenCalled();
  });
});

describe('dispatchWebviewMessage — auth + side flows', () => {
  test('connectGitHub fetches token and refreshes on success', async () => {
    const deps = makeDeps();
    await dispatchWebviewMessage({ command: 'connectGitHub' }, deps);
    expect(deps.hooks.getGitHubToken).toHaveBeenCalledWith(false);
    expect(deps.ui.showInfo).toHaveBeenCalledWith('Connected to GitHub');
  });

  test('connectGitHub does not refresh when no token returned', async () => {
    const deps = makeDeps({
      hooks: { ...makeDeps().hooks, getGitHubToken: vi.fn().mockResolvedValue(undefined) },
    });
    await dispatchWebviewMessage({ command: 'connectGitHub' }, deps);
    expect(deps.updateWebview).not.toHaveBeenCalled();
  });

  test('createBranch invokes hook', async () => {
    const deps = makeDeps();
    await dispatchWebviewMessage({ command: 'createBranch' }, deps);
    expect(deps.hooks.createBranchFromTemplate).toHaveBeenCalled();
  });

  test('createWorktree invokes hook', async () => {
    const deps = makeDeps();
    await dispatchWebviewMessage({ command: 'createWorktree' }, deps);
    expect(deps.hooks.createWorktreeFromBranch).toHaveBeenCalled();
  });

  test('openSupport opens buy-me-a-coffee', async () => {
    const deps = makeDeps();
    await dispatchWebviewMessage({ command: 'openSupport' }, deps);
    expect(deps.env.openExternal).toHaveBeenCalledWith(
      'https://www.buymeacoffee.com/YonasValentin',
    );
  });

  test('openSponsor opens GitHub Sponsors', async () => {
    const deps = makeDeps();
    await dispatchWebviewMessage({ command: 'openSponsor' }, deps);
    expect(deps.env.openExternal).toHaveBeenCalledWith(
      'https://github.com/sponsors/YonasValentin',
    );
  });

  test('openGithub opens issues page', async () => {
    const deps = makeDeps();
    await dispatchWebviewMessage({ command: 'openGithub' }, deps);
    expect(deps.env.openExternal).toHaveBeenCalledWith(
      'https://github.com/YonasValentin/git-branch-manager/issues',
    );
  });

  test('dismissSponsor sets globalState flag', async () => {
    const deps = makeDeps();
    await dispatchWebviewMessage({ command: 'dismissSponsor' }, deps);
    expect(deps.context.globalState.update).toHaveBeenCalledWith('sponsorBannerDismissed', true);
  });

  test('openUrl opens valid URL', async () => {
    const deps = makeDeps();
    await dispatchWebviewMessage(
      { command: 'openUrl', url: 'https://example.com' },
      deps,
    );
    expect(deps.env.openExternal).toHaveBeenCalledWith('https://example.com');
  });

  test('openUrl ignores non-string url', async () => {
    const deps = makeDeps();
    await dispatchWebviewMessage({ command: 'openUrl', url: 123 }, deps);
    expect(deps.env.openExternal).not.toHaveBeenCalled();
  });

  test('refresh invokes updateWebview', async () => {
    const deps = makeDeps();
    await dispatchWebviewMessage({ command: 'refresh' }, deps);
    expect(deps.updateWebview).toHaveBeenCalled();
  });
});

describe('dispatchWebviewMessage — switchRepository', () => {
  test('discovers repos when none loaded yet, then selects', async () => {
    const deps = makeDeps({
      hooks: {
        ...makeDeps().hooks,
        getRepositoriesCount: vi.fn().mockReturnValue(0),
        selectRepository: vi.fn().mockResolvedValue('/other-repo'),
      },
    });
    await dispatchWebviewMessage({ command: 'switchRepository' }, deps);
    expect(deps.hooks.discoverRepositories).toHaveBeenCalled();
    expect(deps.hooks.setActiveRepository).toHaveBeenCalledWith('/other-repo');
    expect(deps.hooks.branchTreeRefresh).toHaveBeenCalled();
  });

  test('skips discover when repos already loaded', async () => {
    const deps = makeDeps({
      hooks: { ...makeDeps().hooks, selectRepository: vi.fn().mockResolvedValue('/other-repo') },
    });
    await dispatchWebviewMessage({ command: 'switchRepository' }, deps);
    expect(deps.hooks.discoverRepositories).not.toHaveBeenCalled();
    expect(deps.hooks.setActiveRepository).toHaveBeenCalledWith('/other-repo');
  });

  test('does nothing when user cancels selection', async () => {
    const deps = makeDeps();
    await dispatchWebviewMessage({ command: 'switchRepository' }, deps);
    expect(deps.hooks.setActiveRepository).not.toHaveBeenCalled();
  });
});

describe('dispatchWebviewMessage — recovery log', () => {
  test('restoreBranch calls restoreFromLog and refreshes', async () => {
    const deps = makeDeps();
    await dispatchWebviewMessage(
      { command: 'restoreBranch', branchName: 'feat/x', commitHash: 'abc123' },
      deps,
    );
    expect(deps.storage.restoreFromLog).toHaveBeenCalledWith(
      deps.context, '/repo', 'feat/x', 'abc123',
    );
    expect(deps.updateWebview).toHaveBeenCalled();
  });

  test('restoreBranch shows error on failure', async () => {
    const deps = makeDeps({
      storage: {
        ...makeDeps().storage,
        restoreFromLog: vi.fn().mockResolvedValue({ success: false, error: 'no such commit' }),
      },
    });
    await dispatchWebviewMessage(
      { command: 'restoreBranch', branchName: 'feat/x', commitHash: 'abc123' },
      deps,
    );
    expect(deps.ui.showError).toHaveBeenCalledWith('Failed to restore: no such commit');
  });

  test('clearRecoveryEntry removes entry', async () => {
    const deps = makeDeps();
    await dispatchWebviewMessage(
      { command: 'clearRecoveryEntry', branchName: 'feat/x', commitHash: 'abc123' },
      deps,
    );
    expect(deps.storage.removeRecoveryEntry).toHaveBeenCalledWith(
      deps.context, '/repo', 'feat/x', 'abc123',
    );
  });
});

describe('dispatchWebviewMessage — openDiff', () => {
  test('forwards branchA, branchB, filePath, gitRoot to hook', async () => {
    const deps = makeDeps();
    await dispatchWebviewMessage(
      {
        command: 'openDiff',
        branchA: 'feat/x',
        branchB: 'main',
        filePath: 'src/foo.ts',
      },
      deps,
    );
    expect(deps.hooks.openDiff).toHaveBeenCalledWith(
      'feat/x', 'main', 'src/foo.ts', '/repo',
    );
  });

  test('rejects invalid branch refs', async () => {
    const deps = makeDeps();
    await dispatchWebviewMessage(
      {
        command: 'openDiff',
        branchA: '-flag',
        branchB: 'main',
        filePath: 'src/foo.ts',
      },
      deps,
    );
    expect(deps.hooks.openDiff).not.toHaveBeenCalled();
  });
});

describe('dispatchWebviewMessage — setTheme', () => {
  test('persists "light" to workspaceState', async () => {
    const deps = makeDeps();
    await dispatchWebviewMessage({ command: 'setTheme', theme: 'light' }, deps);
    expect(deps.context.workspaceState.update).toHaveBeenCalledWith('theme', 'light');
  });

  test('persists "dark" to workspaceState', async () => {
    const deps = makeDeps();
    await dispatchWebviewMessage({ command: 'setTheme', theme: 'dark' }, deps);
    expect(deps.context.workspaceState.update).toHaveBeenCalledWith('theme', 'dark');
  });

  test('ignores invalid theme values', async () => {
    const deps = makeDeps();
    await dispatchWebviewMessage({ command: 'setTheme', theme: 'sepia' }, deps);
    expect(deps.context.workspaceState.update).not.toHaveBeenCalled();
  });

  test('ignores missing theme field', async () => {
    const deps = makeDeps();
    await dispatchWebviewMessage({ command: 'setTheme' }, deps);
    expect(deps.context.workspaceState.update).not.toHaveBeenCalled();
  });
});
