import { describe, expect, test } from 'vitest';
import { isValidGitRef, isValidRepoPath } from './validateRef';

const NL = String.fromCharCode(10);
const CR = String.fromCharCode(13);
const NUL = String.fromCharCode(0);
const BEL = String.fromCharCode(7);
const ESC = String.fromCharCode(27);

describe('isValidGitRef', () => {
  test('accepts a normal branch name', () => {
    expect(isValidGitRef('feature/foo')).toBe(true);
    expect(isValidGitRef('main')).toBe(true);
    expect(isValidGitRef('release/v1.2.3')).toBe(true);
  });

  test('accepts branch names with hyphens, underscores, dots', () => {
    expect(isValidGitRef('my-feature_branch.v2')).toBe(true);
  });

  test('rejects refs starting with - (flag injection)', () => {
    expect(isValidGitRef('-flag')).toBe(false);
    expect(isValidGitRef('--upload-pack=evil')).toBe(false);
  });

  test('rejects empty string', () => {
    expect(isValidGitRef('')).toBe(false);
  });

  test('rejects refs containing newlines', () => {
    expect(isValidGitRef('feature' + NL + 'injected')).toBe(false);
    expect(isValidGitRef('feature' + CR + 'injected')).toBe(false);
  });

  test('rejects refs containing null bytes', () => {
    expect(isValidGitRef('feature' + NUL + 'evil')).toBe(false);
  });

  test('rejects refs containing other control characters', () => {
    expect(isValidGitRef('feature' + BEL + 'x')).toBe(false);
    expect(isValidGitRef('feature' + ESC + 'x')).toBe(false);
  });

  test('rejects refs ending with .lock (git rule)', () => {
    expect(isValidGitRef('feature.lock')).toBe(false);
  });

  test('rejects refs containing .. (git rule)', () => {
    expect(isValidGitRef('feature..main')).toBe(false);
  });

  test('rejects refs containing @{ (git rule)', () => {
    expect(isValidGitRef('feature@{1}')).toBe(false);
  });

  test('rejects refs containing space', () => {
    expect(isValidGitRef('my feature')).toBe(false);
  });

  test('rejects refs containing reserved chars (~ ^ : ? * [ backslash)', () => {
    expect(isValidGitRef('feature~1')).toBe(false);
    expect(isValidGitRef('feature^')).toBe(false);
    expect(isValidGitRef('feature:other')).toBe(false);
    expect(isValidGitRef('feature?')).toBe(false);
    expect(isValidGitRef('feature*')).toBe(false);
    expect(isValidGitRef('feature[1]')).toBe(false);
    expect(isValidGitRef('feature\\')).toBe(false);
  });

  test('rejects unreasonably long refs (>255 chars)', () => {
    expect(isValidGitRef('a'.repeat(256))).toBe(false);
    expect(isValidGitRef('a'.repeat(255))).toBe(true);
  });

  test('accepts remote-prefixed refs (origin/feature)', () => {
    expect(isValidGitRef('origin/feature/x')).toBe(true);
  });
});

describe('isValidRepoPath', () => {
  test('accepts an absolute unix path', () => {
    expect(isValidRepoPath('/Users/me/repo')).toBe(true);
  });

  test('accepts an absolute windows path', () => {
    expect(isValidRepoPath('C:\\Users\\me\\repo')).toBe(true);
  });

  test('rejects empty', () => {
    expect(isValidRepoPath('')).toBe(false);
  });

  test('rejects path with newline (cmd injection mitigation)', () => {
    expect(isValidRepoPath('/repo' + NL + 'echo pwn')).toBe(false);
  });

  test('rejects path with null byte', () => {
    expect(isValidRepoPath('/repo' + NUL + 'evil')).toBe(false);
  });
});
