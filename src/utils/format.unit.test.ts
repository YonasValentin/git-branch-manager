import { describe, expect, test } from 'vitest';
import { formatAge } from './format';

describe('formatAge', () => {
  test('returns "today" for 0 days', () => {
    expect(formatAge(0)).toBe('today');
  });

  test('returns "yesterday" for 1 day', () => {
    expect(formatAge(1)).toBe('yesterday');
  });

  test('returns "Nd ago" for days < 7', () => {
    expect(formatAge(2)).toBe('2d ago');
    expect(formatAge(6)).toBe('6d ago');
  });

  test('returns "Nw ago" for days < 30', () => {
    expect(formatAge(7)).toBe('1w ago');
    expect(formatAge(14)).toBe('2w ago');
    expect(formatAge(29)).toBe('4w ago');
  });

  test('returns "Nmo ago" for days < 365', () => {
    expect(formatAge(30)).toBe('1mo ago');
    expect(formatAge(60)).toBe('2mo ago');
    expect(formatAge(364)).toBe('12mo ago');
  });

  test('returns "Ny ago" for days >= 365', () => {
    expect(formatAge(365)).toBe('1y ago');
    expect(formatAge(730)).toBe('2y ago');
  });

  test('returns "unknown" for negative days', () => {
    expect(formatAge(-1)).toBe('unknown');
  });

  test('returns "unknown" for NaN', () => {
    expect(formatAge(NaN)).toBe('unknown');
  });
});
