---
phase: 13-enhanced-comparison-timeline
plan: 01
subsystem: ui
tags: [vscode, treeview, webview, git, branch-comparison, timeline, typescript]

# Dependency graph
requires:
  - phase: 12-cleanup-rules-ui
    provides: webview tab pattern, createElement/textContent DOM pattern
  - phase: 9-sidebar-tree-view
    provides: BranchTreeProvider, BranchItem, BranchTreeNode types
provides:
  - getBranchTimeline function for on-demand commit history
  - resolveTreeItem for lazy tooltip with last 5 commits in tree view
  - Compare tab in webview with branch selectors and comparison results
  - comparisonResult postMessage handler replacing showInformationMessage stub
  - getTimeline postMessage handler for on-demand branch timeline
affects:
  - 13-02 (diff viewer will add Diff buttons to comparison file list)
  - 14-platform-integration

# Tech tracking
tech-stack:
  added: []
  patterns:
    - resolveTreeItem for lazy VS Code tree tooltip population
    - Branch name positional argument before flags in git log
    - comparisonResult/timelineResult postMessage pattern for webview data flow

key-files:
  created: []
  modified:
    - src/git/branches.ts
    - src/git/index.ts
    - src/services/branchTreeProvider.ts
    - src/extension.ts

key-decisions:
  - "getBranchTimeline uses execFile with branchName positional arg before --max-count flag to avoid git flag misinterpretation"
  - "resolveTreeItem replaces eager tooltip with lazy one — constructor tooltip still serves as immediate fallback"
  - "compareBranches handler upgraded from showInformationMessage stub to postMessage with full ComparisonResult data"
  - "allBranchNames fetched in updateWebview alongside other data (parallel Promise.all) and injected as JSON constant"
  - "All comparison DOM rendering uses createElement/textContent — no string interpolation into DOM"
  - "Status badge CSS uses vscode gitDecoration CSS vars with fallback hex values for theme compatibility"

patterns-established:
  - "resolveTreeItem pattern: check instanceof, check cancellation, fetch data, build MarkdownString, silent catch"
  - "Compare tab: inject branch names as JSON const, populate selects in initCompareDropdowns(), postMessage on button click"

requirements-completed:
  - TIME-01
  - TIME-02
  - TIME-03
  - COMP-01
  - COMP-02

# Metrics
duration: 4min
completed: 2026-02-18
---

# Phase 13 Plan 01: Enhanced Comparison & Timeline Summary

**Branch timeline tooltips via resolveTreeItem and a Compare tab in the webview with full ComparisonResult rendering including per-branch commit lists and file change status badges**

## Performance

- **Duration:** ~4 min
- **Started:** 2026-02-18T00:35:33Z
- **Completed:** 2026-02-18T00:39:10Z
- **Tasks:** 2
- **Files modified:** 4

## Accomplishments

- `getBranchTimeline(cwd, branchName, limit)` added to `src/git/branches.ts` — lazy commit history fetcher using execFile
- `resolveTreeItem` added to `BranchTreeProvider` — hovering a branch in tree view now shows last 5 commits with hash, message, author, and relative date in MarkdownString tooltip
- Compare tab added to webview with two branch dropdowns (branchA defaults to current branch), Compare button, and results container
- `compareBranches` handler upgraded from showInformationMessage stub to panel.webview.postMessage with full ComparisonResult data
- `getTimeline` message handler added for on-demand branch timeline
- comparisonResult JS handler renders ahead/behind summary, commits unique to each branch, and file changes with colored A/M/D/R status badges
- All webview rendering uses `createElement`/`textContent` — zero string interpolation into DOM with user data

## Task Commits

1. **Task 1: Add getBranchTimeline and resolveTreeItem** - `1116abd` (feat)
2. **Task 2: Add Compare tab to webview** - `ad40367` (feat)

## Files Created/Modified

- `src/git/branches.ts` - Added `getBranchTimeline` export function
- `src/git/index.ts` - Added `getBranchTimeline` to re-export list
- `src/services/branchTreeProvider.ts` - Added `getBranchTimeline` import and `resolveTreeItem` method
- `src/extension.ts` - Added `getBranchTimeline` import, `getTimeline` handler, upgraded `compareBranches` handler, Compare tab HTML, CSS, and JS handlers

## Decisions Made

- `getBranchTimeline` uses `execFile` with `branchName` as positional arg before `--max-count` flag to prevent git from misinterpreting branch names starting with `-`
- `resolveTreeItem` builds a new MarkdownString on every hover but degrades silently on error (original constructor tooltip remains as fallback)
- `compareBranches` webview handler upgraded from showInformationMessage stub — plan explicitly noted "Replace the current stub"
- `allBranchNames` fetched in `updateWebview` via `Promise.all` alongside other branch data — no extra round-trip
- Status badge CSS uses `var(--vscode-gitDecoration-*Foreground)` with hardcoded hex fallbacks for maximum theme compatibility

## Deviations from Plan

None — plan executed exactly as written. The `compareBranches` handler update was explicitly planned as a replacement for the existing stub.

## Issues Encountered

The pre-commit security hook flagged container-clearing code. Replaced all new container-clearing instances with `while (firstChild) removeChild(firstChild)` loop — a safer DOM pattern. The pre-existing container-clearing in `renderRules()` is out of scope (pre-existing code not introduced by this plan).

## Next Phase Readiness

- Phase 13 Plan 02 (COMP-03: diff viewer) can add Diff buttons to each `.file-change-row` rendered by this plan
- `getBranchTimeline` is available for any future feature needing commit history
- `resolveTreeItem` pattern established for future lazy tree item enrichment

---
*Phase: 13-enhanced-comparison-timeline*
*Completed: 2026-02-18*
