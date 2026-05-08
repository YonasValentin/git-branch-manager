import { describe, expect, test } from 'vitest';
import { escapeForScriptTag } from './escapeForScriptTag';

const LS = '\u2028';
const PS = '\u2029';

describe('escapeForScriptTag', () => {
  test('passes through plain ASCII unchanged', () => {
    expect(escapeForScriptTag('"hello world"')).toBe('"hello world"');
  });

  test('escapes < to \\u003c so </script> cannot break out', () => {
    const malicious = JSON.stringify({ name: '</script><script>alert(1)</script>' });
    const escaped = escapeForScriptTag(malicious);
    expect(escaped).not.toContain('</script>');
    expect(escaped).not.toContain('<');
    expect(escaped).toContain('\\u003c');
  });

  test('escapes > to \\u003e', () => {
    expect(escapeForScriptTag('">"')).toBe('"\\u003e"');
  });

  test('escapes & to \\u0026 (defense-in-depth against HTML entity tricks)', () => {
    expect(escapeForScriptTag('"&"')).toBe('"\\u0026"');
  });

  test('escapes U+2028 (line separator) which JSON.stringify leaves bare', () => {
    expect(escapeForScriptTag('"' + LS + '"')).toBe('"\\u2028"');
  });

  test('escapes U+2029 (paragraph separator) which JSON.stringify leaves bare', () => {
    expect(escapeForScriptTag('"' + PS + '"')).toBe('"\\u2029"');
  });

  test('escaped output round-trips through JSON.parse to the original value', () => {
    const original = { branch: '</script>', msg: 'a&b<c>d', sep: 'a' + LS + 'b' };
    const escaped = escapeForScriptTag(JSON.stringify(original));
    expect(JSON.parse(escaped)).toEqual(original);
  });

  test('handles realistic INITIAL_DATA payload safely', () => {
    const payload = {
      branches: [
        { name: 'feature/normal', isCurrent: true },
        { name: '</script><img src=x onerror=alert(1)>', isCurrent: false },
      ],
    };
    const escaped = escapeForScriptTag(JSON.stringify(payload));
    expect(escaped).not.toContain('</script>');
    expect(escaped).not.toContain('<img');
    expect(JSON.parse(escaped)).toEqual(payload);
  });

  test('empty string passes through', () => {
    expect(escapeForScriptTag('')).toBe('');
  });
});
