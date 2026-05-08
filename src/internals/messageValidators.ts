// Runtime validators for messages crossing the webview→extension trust boundary.
// Throw on malformed payloads so we never silently pass `undefined` into git ops.

import type { CleanupRule } from '../types';

export function reqStr(value: unknown, field: string): string {
  if (typeof value !== 'string' || value.length === 0) {
    throw new Error(`Webview message missing required string field: ${field}`);
  }
  return value;
}

export function reqStrArray(value: unknown, field: string): string[] {
  if (!Array.isArray(value) || !value.every((x) => typeof x === 'string')) {
    throw new Error(`Webview message missing required string[] field: ${field}`);
  }
  return value as string[];
}

export function reqNum(value: unknown, field: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new Error(`Webview message missing required number field: ${field}`);
  }
  return value;
}

export function isCleanupRuleArray(value: unknown): value is CleanupRule[] {
  if (!Array.isArray(value)) return false;
  return value.every((r) => {
    if (r === null || typeof r !== 'object') return false;
    const obj = r as Record<string, unknown>;
    return typeof obj.id === 'string' &&
           typeof obj.name === 'string' &&
           typeof obj.enabled === 'boolean';
  });
}
