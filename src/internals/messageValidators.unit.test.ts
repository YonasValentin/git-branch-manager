import { describe, expect, test } from 'vitest';
import { reqStr, reqStrArray, reqNum, isCleanupRuleArray } from './messageValidators';

describe('reqStr', () => {
  test('returns the string when given a non-empty string', () => {
    expect(reqStr('feature/foo', 'branchName')).toBe('feature/foo');
  });

  test('throws when value is undefined', () => {
    expect(() => reqStr(undefined, 'branchName')).toThrow(/branchName/);
  });

  test('throws when value is null', () => {
    expect(() => reqStr(null, 'branchName')).toThrow(/branchName/);
  });

  test('throws when value is empty string (would silently pass undefined-equivalent into git)', () => {
    expect(() => reqStr('', 'branchName')).toThrow(/branchName/);
  });

  test('throws when value is a number', () => {
    expect(() => reqStr(42, 'branchName')).toThrow(/branchName/);
  });

  test('throws when value is an object', () => {
    expect(() => reqStr({ name: 'x' }, 'branchName')).toThrow(/branchName/);
  });
});

describe('reqStrArray', () => {
  test('returns the array when all elements are strings', () => {
    expect(reqStrArray(['a', 'b', 'c'], 'branchNames')).toEqual(['a', 'b', 'c']);
  });

  test('returns empty array unchanged', () => {
    expect(reqStrArray([], 'branchNames')).toEqual([]);
  });

  test('throws when value is not an array', () => {
    expect(() => reqStrArray('not-an-array', 'branchNames')).toThrow(/branchNames/);
  });

  test('throws when array contains a non-string', () => {
    expect(() => reqStrArray(['a', 42, 'c'], 'branchNames')).toThrow(/branchNames/);
  });

  test('throws when value is undefined', () => {
    expect(() => reqStrArray(undefined, 'branchNames')).toThrow(/branchNames/);
  });
});

describe('reqNum', () => {
  test('returns the number for valid integers', () => {
    expect(reqNum(0, 'index')).toBe(0);
    expect(reqNum(7, 'index')).toBe(7);
    expect(reqNum(-3, 'index')).toBe(-3);
  });

  test('returns the number for valid floats', () => {
    expect(reqNum(1.5, 'rate')).toBe(1.5);
  });

  test('throws on NaN (would corrupt downstream array indexing)', () => {
    expect(() => reqNum(NaN, 'index')).toThrow(/index/);
  });

  test('throws on Infinity', () => {
    expect(() => reqNum(Infinity, 'index')).toThrow(/index/);
  });

  test('throws on a numeric string', () => {
    expect(() => reqNum('42', 'index')).toThrow(/index/);
  });

  test('throws on undefined', () => {
    expect(() => reqNum(undefined, 'index')).toThrow(/index/);
  });
});

describe('isCleanupRuleArray', () => {
  test('returns true for a valid CleanupRule array', () => {
    const rules = [
      { id: 'r1', name: 'merged', enabled: true, conditions: { merged: true }, action: 'delete' },
    ];
    expect(isCleanupRuleArray(rules)).toBe(true);
  });

  test('returns true for an empty array', () => {
    expect(isCleanupRuleArray([])).toBe(true);
  });

  test('returns false when not an array', () => {
    expect(isCleanupRuleArray('not array')).toBe(false);
    expect(isCleanupRuleArray(null)).toBe(false);
    expect(isCleanupRuleArray(undefined)).toBe(false);
    expect(isCleanupRuleArray({})).toBe(false);
  });

  test('returns false when an element is missing required string fields', () => {
    expect(isCleanupRuleArray([{ enabled: true }])).toBe(false);
    expect(isCleanupRuleArray([{ id: 'r1', enabled: true }])).toBe(false); // missing name
    expect(isCleanupRuleArray([{ id: 'r1', name: 'x' }])).toBe(false); // missing enabled
  });

  test('returns false when an element has wrong-typed enabled', () => {
    expect(isCleanupRuleArray([{ id: 'r1', name: 'x', enabled: 'yes' }])).toBe(false);
  });

  test('returns false when one element of many is invalid', () => {
    const mixed = [
      { id: 'r1', name: 'good', enabled: true },
      { id: 'r2', name: 'bad', enabled: 1 }, // wrong type
    ];
    expect(isCleanupRuleArray(mixed)).toBe(false);
  });
});
