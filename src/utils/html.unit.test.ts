import { describe, expect, test } from 'vitest';
import { escapeHtml, getHealthColor } from './html';

describe('escapeHtml', () => {
  test('escapes &', () => {
    expect(escapeHtml('AT&T')).toBe('AT&amp;T');
  });

  test('escapes <', () => {
    expect(escapeHtml('a<b')).toBe('a&lt;b');
  });

  test('escapes >', () => {
    expect(escapeHtml('a>b')).toBe('a&gt;b');
  });

  test('escapes "', () => {
    expect(escapeHtml('say "hi"')).toBe('say &quot;hi&quot;');
  });

  test("escapes '", () => {
    expect(escapeHtml("it's")).toBe('it&#39;s');
  });

  test('escapes & before < to avoid double-escaping', () => {
    expect(escapeHtml('<')).toBe('&lt;');
    expect(escapeHtml('&lt;')).toBe('&amp;lt;');
  });

  test('preserves harmless chars', () => {
    expect(escapeHtml('hello world')).toBe('hello world');
  });

  test('handles full XSS payload', () => {
    const dangerous = '<script>alert("xss")</script>';
    const escaped = escapeHtml(dangerous);
    expect(escaped).not.toContain('<script>');
    expect(escaped).toContain('&lt;script&gt;');
  });
});

describe('getHealthColor', () => {
  test('returns passing color for healthy', () => {
    expect(getHealthColor('healthy')).toBe('var(--vscode-testing-iconPassed)');
  });

  test('returns warning color for warning', () => {
    expect(getHealthColor('warning')).toBe('var(--vscode-editorWarning-foreground)');
  });

  test('returns error color for critical', () => {
    expect(getHealthColor('critical')).toBe('var(--vscode-editorError-foreground)');
  });

  test('returns danger border color for danger', () => {
    expect(getHealthColor('danger')).toBe('var(--vscode-inputValidation-errorBorder)');
  });

  test('returns default foreground for unknown', () => {
    expect(getHealthColor('mystery')).toBe('var(--vscode-foreground)');
  });

  test('returns default foreground for undefined', () => {
    expect(getHealthColor(undefined)).toBe('var(--vscode-foreground)');
  });
});
