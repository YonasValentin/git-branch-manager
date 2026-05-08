import { describe, expect, test } from 'vitest';
import { buildGitEnv } from './gitEnv';

describe('buildGitEnv', () => {
  test('preserves PATH and HOME from parent', () => {
    const env = buildGitEnv({ PATH: '/usr/bin', HOME: '/home/u' });
    expect(env.PATH).toBe('/usr/bin');
    expect(env.HOME).toBe('/home/u');
  });

  test('always sets GIT_TERMINAL_PROMPT=0 (prevents extension hang)', () => {
    const env = buildGitEnv({});
    expect(env.GIT_TERMINAL_PROMPT).toBe('0');
  });

  test('overrides parent GIT_TERMINAL_PROMPT even if set to 1', () => {
    const env = buildGitEnv({ GIT_TERMINAL_PROMPT: '1' });
    expect(env.GIT_TERMINAL_PROMPT).toBe('0');
  });

  test('strips GIT_DIR (would override the cwd we pinned)', () => {
    const env = buildGitEnv({ GIT_DIR: '/wrong/repo/.git', PATH: '/usr/bin' });
    expect(env.GIT_DIR).toBeUndefined();
    expect(env.PATH).toBe('/usr/bin');
  });

  test('strips GIT_WORK_TREE', () => {
    const env = buildGitEnv({ GIT_WORK_TREE: '/wrong/repo' });
    expect(env.GIT_WORK_TREE).toBeUndefined();
  });

  test('strips GIT_INDEX_FILE', () => {
    const env = buildGitEnv({ GIT_INDEX_FILE: '/tmp/wrong-index' });
    expect(env.GIT_INDEX_FILE).toBeUndefined();
  });

  test('strips GIT_CONFIG', () => {
    const env = buildGitEnv({ GIT_CONFIG: '/tmp/evil-config' });
    expect(env.GIT_CONFIG).toBeUndefined();
  });

  test('strips GIT_CONFIG_COUNT and other GIT_CONFIG_* variants (env-config injection)', () => {
    const env = buildGitEnv({
      GIT_CONFIG_COUNT: '1',
      GIT_CONFIG_KEY_0: 'core.fsmonitor',
      GIT_CONFIG_VALUE_0: '/tmp/evil-binary',
    });
    expect(env.GIT_CONFIG_COUNT).toBeUndefined();
    expect(env.GIT_CONFIG_KEY_0).toBeUndefined();
    expect(env.GIT_CONFIG_VALUE_0).toBeUndefined();
  });

  test('does NOT strip benign vars that happen to start with GITHUB_ etc.', () => {
    const env = buildGitEnv({ GITHUB_TOKEN: 'secret', GITLAB_TOKEN: 'secret' });
    expect(env.GITHUB_TOKEN).toBe('secret');
    expect(env.GITLAB_TOKEN).toBe('secret');
  });

  test('does NOT mutate the input env', () => {
    const parent = { GIT_DIR: '/repo/.git', PATH: '/usr/bin' };
    buildGitEnv(parent);
    expect(parent.GIT_DIR).toBe('/repo/.git');
    expect(parent.PATH).toBe('/usr/bin');
  });

  test('returns a fresh object (caller can mutate without affecting future calls)', () => {
    const a = buildGitEnv({ PATH: '/a' });
    const b = buildGitEnv({ PATH: '/b' });
    expect(a.PATH).toBe('/a');
    expect(b.PATH).toBe('/b');
    expect(a).not.toBe(b);
  });
});
