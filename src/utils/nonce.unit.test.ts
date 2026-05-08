import { describe, expect, test } from 'vitest';
import { getNonce } from './nonce';

describe('getNonce', () => {
  test('returns a 32-character hex string', () => {
    const nonce = getNonce();
    expect(nonce).toMatch(/^[0-9a-f]{32}$/);
  });

  test('uses only hex characters', () => {
    const nonce = getNonce();
    expect(nonce).toMatch(/^[0-9a-f]+$/);
  });

  test('produces unique values across 1000 invocations', () => {
    const set = new Set<string>();
    for (let i = 0; i < 1000; i++) {
      set.add(getNonce());
    }
    expect(set.size).toBe(1000);
  });
});
