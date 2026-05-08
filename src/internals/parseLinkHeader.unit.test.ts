import { describe, expect, test } from 'vitest';
import { parseLinkHeader } from './parseLinkHeader';

describe('parseLinkHeader', () => {
  test('returns empty object for undefined', () => {
    expect(parseLinkHeader(undefined)).toEqual({});
  });

  test('returns empty object for empty string', () => {
    expect(parseLinkHeader('')).toEqual({});
  });

  test('parses a single rel="next" link', () => {
    const value = '<https://api.github.com/repos/o/r/pulls?page=2>; rel="next"';
    expect(parseLinkHeader(value)).toEqual({
      next: 'https://api.github.com/repos/o/r/pulls?page=2',
    });
  });

  test('parses multiple links from a comma-separated header (GitHub format)', () => {
    const value = [
      '<https://api.github.com/repos/o/r/pulls?page=2>; rel="next"',
      '<https://api.github.com/repos/o/r/pulls?page=10>; rel="last"',
      '<https://api.github.com/repos/o/r/pulls?page=1>; rel="first"',
    ].join(', ');
    const out = parseLinkHeader(value);
    expect(out.next).toBe('https://api.github.com/repos/o/r/pulls?page=2');
    expect(out.last).toBe('https://api.github.com/repos/o/r/pulls?page=10');
    expect(out.first).toBe('https://api.github.com/repos/o/r/pulls?page=1');
  });

  test('handles single quotes around rel value', () => {
    expect(parseLinkHeader("<https://x/?p=2>; rel='next'")).toEqual({ next: 'https://x/?p=2' });
  });

  test('handles unquoted rel value', () => {
    expect(parseLinkHeader('<https://x/?p=2>; rel=next')).toEqual({ next: 'https://x/?p=2' });
  });

  test('returns empty object when no rel parameter is present', () => {
    expect(parseLinkHeader('<https://x/>')).toEqual({});
  });

  test('only includes the four standard rel values (next/prev/first/last)', () => {
    const value = '<https://x/?p=2>; rel="something-custom"';
    expect(parseLinkHeader(value)).toEqual({});
  });

  test('handles URLs containing commas (URL-encoded)', () => {
    const value = '<https://x/?q=a%2Cb&page=2>; rel="next"';
    expect(parseLinkHeader(value).next).toBe('https://x/?q=a%2Cb&page=2');
  });

  test('handles URLs containing semicolons (encoded)', () => {
    const value = '<https://x/?q=a%3Bb>; rel="next"';
    expect(parseLinkHeader(value).next).toBe('https://x/?q=a%3Bb');
  });

  test('tolerates extra whitespace', () => {
    expect(parseLinkHeader('  <https://x/?p=2>  ;  rel="next"  ').next).toBe('https://x/?p=2');
  });
});
