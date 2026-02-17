---
phase: 11-event-driven-auto-cleanup
plan: 01
subsystem: services
tags: [vscode-extension, typescript, branch-cleanup, glob-patterns, debounce]

# Dependency graph
requires:
  - phase: 10-gone-branch-auto-detection
    provides: GoneDetector pattern for debounce/dispose/file-watcher lifecycle
  - phase: 09-sidebar-tree-view
    provides: BranchTreeProvider.scheduleRefresh()
  - phase: 08-multi-repository-foundation
    provides: RepositoryContextManager, getBranchInfo, deleteBranchForce
  - phase: 06-undo-recovery
    provides: addRecoveryEntry, getCommitHash for recovery logging
provides:
  - AutoCleanupEvaluator service with 500ms debounce, exclusion glob filtering, team-safe mode, dry-run QuickPick preview
  - globToRegex(pattern) — converts glob patterns to RegExp for branch name matching
  - isExcluded(branchName, patterns) — filters branches by exclusion glob list
  - Three VS Code settings: autoCleanupOnEvents, cleanupExclusionPatterns, teamSafeMode
affects:
  - 11-02 (wiring AutoCleanupEvaluator into extension.ts with git event watchers)

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Debounce via Map<string, ReturnType<typeof setTimeout>> — identical to GoneDetector pattern"
    - "Union cleanup rule results using Map<string, BranchInfo> keyed by branch name for deduplication"
    - "Glob-to-regex conversion via character class replacement (no external library)"
    - "Team-safe mode: filter branches by author === gitCommand(['config', 'user.name']) with safe-default exclusion on failure"

key-files:
  created:
    - src/services/autoCleanupEvaluator.ts
  modified:
    - src/utils/regex.ts
    - src/services/index.ts
    - package.json

key-decisions:
  - "AutoCleanupEvaluator returns silently (no UI) when no enabled rules exist — avoids notification noise"
  - "teamSafeMode skips filter on gitCommand failure (safe default: don't exclude branches when author lookup fails)"
  - "Branches with author === undefined treated as excluded in teamSafeMode (safe default)"
  - "globToRegex placed before safeRegexTest in regex.ts — glob matching is separate concern from ReDoS-safe user patterns"
  - "AutoCleanupEvaluator exported from services/index.ts barrel alongside GoneDetector"

patterns-established:
  - "Glob exclusion pattern: globToRegex() + isExcluded() pair for any future branch filtering needs"
  - "evaluateCleanupRule() called per rule, results unioned via Map — supports compound rules without re-implementation"

requirements-completed: [AUTO-01, AUTO-02, AUTO-03, AUTO-04, AUTO-05]

# Metrics
duration: 2min
completed: 2026-02-17
---

# Phase 11 Plan 01: AutoCleanupEvaluator Service Summary

**AutoCleanupEvaluator evaluates branches against compound cleanup rules with glob exclusion, team-safe author filtering, and dry-run QuickPick preview before force-deleting with recovery logging**

## Performance

- **Duration:** 1m 44s
- **Started:** 2026-02-17T22:48:01Z
- **Completed:** 2026-02-17T22:49:45Z
- **Tasks:** 2
- **Files modified:** 4

## Accomplishments

- Added `globToRegex` and `isExcluded` to `src/utils/regex.ts` — hand-rolled glob matching with no new dependencies
- Declared three new VS Code settings: `autoCleanupOnEvents` (array of git events), `cleanupExclusionPatterns` (glob array), `teamSafeMode` (boolean)
- Created `AutoCleanupEvaluator` following the exact GoneDetector lifecycle pattern: debounce per repo, dispose(), and silent early returns when disabled

## Task Commits

Each task was committed atomically:

1. **Task 1: Add globToRegex, isExcluded utils and 3 settings** - `8a9a471` (feat)
2. **Task 2: Create AutoCleanupEvaluator service** - `6371fd0` (feat)

**Plan metadata:** (docs commit follows this summary)

## Files Created/Modified

- `src/utils/regex.ts` - Added `globToRegex(pattern)` and `isExcluded(branchName, patterns)` exports
- `src/services/autoCleanupEvaluator.ts` - New service: debounce, rule evaluation, exclusion filtering, team-safe mode, dry-run QuickPick, recovery logging
- `src/services/index.ts` - Added barrel export for `AutoCleanupEvaluator`
- `package.json` - Added `autoCleanupOnEvents`, `cleanupExclusionPatterns`, `teamSafeMode` under `contributes.configuration.properties`

## Decisions Made

- `AutoCleanupEvaluator` returns silently (no UI) when no enabled rules exist — avoids notification noise for users who haven't configured rules yet
- `teamSafeMode` skips the author filter when `git config user.name` fails (safe default: show all candidates rather than accidentally hiding them)
- Branches with `author === undefined` are excluded in teamSafeMode (safe default: treat unknown authorship as "not mine")
- `globToRegex` and `isExcluded` placed before `safeRegexTest` in `regex.ts` — glob matching is a different concern from ReDoS-protected user-entered regex patterns

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 2 - Missing Critical] Added AutoCleanupEvaluator to services/index.ts barrel export**
- **Found during:** Task 2 (Create AutoCleanupEvaluator service)
- **Issue:** Plan specified `exports: ["AutoCleanupEvaluator"]` for the file, and all other services (GoneDetector, BranchTreeProvider, RepositoryContextManager) are re-exported from the barrel. Omitting the barrel export would break Plan 02's import pattern.
- **Fix:** Added `export { AutoCleanupEvaluator } from './autoCleanupEvaluator';` to `src/services/index.ts`
- **Files modified:** `src/services/index.ts`
- **Verification:** `npm run check-types` passes; import from `'../services'` will resolve correctly
- **Committed in:** `6371fd0` (Task 2 commit)

---

**Total deviations:** 1 auto-fixed (Rule 2 - missing critical barrel export)
**Impact on plan:** Necessary for Plan 02 wiring — no scope creep.

## Issues Encountered

None - TypeScript compiled cleanly on first attempt for both tasks.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- `AutoCleanupEvaluator` is ready to wire into `extension.ts` in Plan 02
- File watchers for `FETCH_HEAD`, `MERGE_HEAD`, `ORIG_HEAD` can call `evaluator.onEventTriggered(repoPath)` directly
- Settings are declared and will appear in VS Code settings UI immediately

---
*Phase: 11-event-driven-auto-cleanup*
*Completed: 2026-02-17*
