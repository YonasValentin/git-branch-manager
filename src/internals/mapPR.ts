// Translates the extension's `PRStatus` (raw, includes `url` + `reviewStatus`) to
// the webview's `PRInfo` shape (used for badge rendering).
//
// This is the contract for the `prStatusUpdate` postMessage — if the shape
// drifts, async PR badge updates silently no-op.

import type { PRStatus } from '../types';
import type { PRInfo } from '../webview/types';

export function mapPR(pr: PRStatus | undefined): PRInfo | null {
  if (!pr) return null;
  const reviews: PRInfo['reviews'] =
    pr.reviewStatus === 'approved' ? 'approved' :
    pr.reviewStatus === 'changes_requested' ? 'changes_requested' :
    'pending';
  return {
    number: pr.number,
    state: pr.state,
    title: pr.title,
    ci: 'pending',
    checks: '',
    reviews,
  };
}
