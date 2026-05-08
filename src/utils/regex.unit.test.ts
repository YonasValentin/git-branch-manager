import { describe, expect, test } from 'vitest';
import { validateRegexPattern, globToRegex, isExcluded, safeRegexTest } from './regex';

describe('validateRegexPattern', () => {
  test('accepts a simple valid pattern', () => {
    expect(validateRegexPattern('^feat/').valid).toBe(true);
  });

  test('rejects pattern over 200 chars', () => {
    const result = validateRegexPattern('a'.repeat(201));
    expect(result.valid).toBe(false);
    expect(result.error).toMatch(/too long/i);
  });

  test('rejects nested + quantifier (a+)+', () => {
    const result = validateRegexPattern('(a+)+');
    expect(result.valid).toBe(false);
    expect(result.error).toMatch(/quantifier/i);
  });

  test('rejects nested * quantifier (a*)*', () => {
    expect(validateRegexPattern('(a*)*').valid).toBe(false);
  });

  test('rejects alternation followed by quantifier (a|b)+', () => {
    expect(validateRegexPattern('(a|b)+').valid).toBe(false);
  });

  test('rejects multiple unbounded wildcards .*.*', () => {
    expect(validateRegexPattern('.*.*').valid).toBe(false);
  });

  test('rejects malformed regex syntax', () => {
    const result = validateRegexPattern('[unclosed');
    expect(result.valid).toBe(false);
    expect(result.error).toMatch(/Invalid regex/i);
  });

  test('accepts boundary length (200 chars)', () => {
    expect(validateRegexPattern('a'.repeat(200)).valid).toBe(true);
  });
});

describe('globToRegex', () => {
  test('matches exact strings', () => {
    expect(globToRegex('main').test('main')).toBe(true);
    expect(globToRegex('main').test('not-main')).toBe(false);
  });

  test('* matches zero or more non-slash chars', () => {
    const r = globToRegex('feat-*');
    expect(r.test('feat-')).toBe(true);
    expect(r.test('feat-foo')).toBe(true);
    expect(r.test('feat-foo-bar')).toBe(true);
  });

  test('* does not cross slash', () => {
    expect(globToRegex('feat/*').test('feat/foo/bar')).toBe(false);
    expect(globToRegex('feat/*').test('feat/foo')).toBe(true);
  });

  test('? matches exactly one non-slash char', () => {
    expect(globToRegex('v?').test('v1')).toBe(true);
    expect(globToRegex('v?').test('v12')).toBe(false);
    expect(globToRegex('v?').test('v')).toBe(false);
  });

  test('escapes regex special chars in literal portion', () => {
    expect(globToRegex('feat.foo').test('feat.foo')).toBe(true);
    expect(globToRegex('feat.foo').test('featXfoo')).toBe(false);
  });
});

describe('isExcluded', () => {
  test('returns true if branch matches any pattern', () => {
    expect(isExcluded('release/v1.0', ['release/*'])).toBe(true);
    expect(isExcluded('main', ['release/*', 'main'])).toBe(true);
  });

  test('returns false if no pattern matches', () => {
    expect(isExcluded('feat/foo', ['release/*'])).toBe(false);
    expect(isExcluded('main', [])).toBe(false);
  });
});

describe('safeRegexTest', () => {
  test('returns matches=true for matching input', () => {
    expect(safeRegexTest('^feat-', 'feat-foo').matches).toBe(true);
  });

  test('returns matches=false for non-matching input', () => {
    expect(safeRegexTest('^feat-', 'main').matches).toBe(false);
  });

  test('returns error for invalid pattern', () => {
    const result = safeRegexTest('(a+)+', 'aaa');
    expect(result.matches).toBe(false);
    expect(result.error).toBeDefined();
  });

  test('returns error when input exceeds maxInputLength', () => {
    const result = safeRegexTest('^a', 'a'.repeat(2000));
    expect(result.matches).toBe(false);
    expect(result.error).toMatch(/Input too long/);
  });
});
