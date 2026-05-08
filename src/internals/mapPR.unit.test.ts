import { describe, expect, test } from 'vitest';
import { mapPR } from './mapPR';
import type { PRStatus } from '../types';

describe('mapPR', () => {
  test('returns null when input is undefined', () => {
    expect(mapPR(undefined)).toBeNull();
  });

  test('maps the basic open-state PR with no review status', () => {
    const pr: PRStatus = { number: 42, state: 'open', title: 'Add feature', url: 'https://gh/pr/42' };
    expect(mapPR(pr)).toEqual({
      number: 42,
      state: 'open',
      title: 'Add feature',
      ci: 'pending',
      checks: '',
      reviews: 'pending',
    });
  });

  test('maps reviewStatus=approved to reviews=approved', () => {
    const pr: PRStatus = { number: 1, state: 'open', title: 't', url: '', reviewStatus: 'approved' };
    expect(mapPR(pr)?.reviews).toBe('approved');
  });

  test('maps reviewStatus=changes_requested to reviews=changes_requested', () => {
    const pr: PRStatus = { number: 1, state: 'open', title: 't', url: '', reviewStatus: 'changes_requested' };
    expect(mapPR(pr)?.reviews).toBe('changes_requested');
  });

  test('maps reviewStatus=pending to reviews=pending', () => {
    const pr: PRStatus = { number: 1, state: 'open', title: 't', url: '', reviewStatus: 'pending' };
    expect(mapPR(pr)?.reviews).toBe('pending');
  });

  test('maps reviewStatus=none to reviews=pending (no special case in webview UI)', () => {
    const pr: PRStatus = { number: 1, state: 'open', title: 't', url: '', reviewStatus: 'none' };
    expect(mapPR(pr)?.reviews).toBe('pending');
  });

  test('preserves number, state, title verbatim', () => {
    const pr: PRStatus = { number: 999, state: 'merged', title: 'Long title here', url: '' };
    const out = mapPR(pr);
    expect(out?.number).toBe(999);
    expect(out?.state).toBe('merged');
    expect(out?.title).toBe('Long title here');
  });

  test('does NOT include url in the webview payload (PRInfo has no url field)', () => {
    const pr: PRStatus = { number: 1, state: 'open', title: 't', url: 'https://leak.example' };
    const out = mapPR(pr);
    expect(out).not.toHaveProperty('url');
  });

  test('handles all four PR states (open, closed, merged, draft)', () => {
    for (const state of ['open', 'closed', 'merged', 'draft'] as const) {
      const pr: PRStatus = { number: 1, state, title: 't', url: '' };
      expect(mapPR(pr)?.state).toBe(state);
    }
  });
});
