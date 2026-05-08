import { describe, expect, test } from 'vitest';
import { isInboundMessage } from './messageGuard';

describe('isInboundMessage', () => {
  test('returns true for { command: "X" }', () => {
    expect(isInboundMessage({ command: 'X' })).toBe(true);
  });

  test('returns true for valid object with extra fields', () => {
    expect(isInboundMessage({ command: 'X', data: { y: 1 }, branchName: 'feature' })).toBe(true);
  });

  test('returns false for null', () => {
    expect(isInboundMessage(null)).toBe(false);
  });

  test('returns false for undefined', () => {
    expect(isInboundMessage(undefined)).toBe(false);
  });

  test('returns false for a primitive (string)', () => {
    expect(isInboundMessage('command')).toBe(false);
  });

  test('returns false for a primitive (number)', () => {
    expect(isInboundMessage(42)).toBe(false);
  });

  test('returns false for an object missing command', () => {
    expect(isInboundMessage({ data: { y: 1 } })).toBe(false);
  });

  test('returns false when command is non-string', () => {
    expect(isInboundMessage({ command: 42 })).toBe(false);
    expect(isInboundMessage({ command: null })).toBe(false);
    expect(isInboundMessage({ command: undefined })).toBe(false);
  });

  test('returns false for an array (typeof === "object" but not a message)', () => {
    // Note: arrays in JS satisfy `typeof === "object"`. Make sure we don't
    // accidentally accept them when they happen to have a numeric `command`.
    const arr: unknown = [];
    expect(isInboundMessage(arr)).toBe(false);
  });
});
