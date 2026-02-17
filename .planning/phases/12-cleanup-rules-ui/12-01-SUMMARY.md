---
phase: 12-cleanup-rules-ui
plan: 01
subsystem: ui
tags: [webview, vscode, javascript, dom, cleanup-rules]

# Dependency graph
requires:
  - phase: 11-event-driven-auto-cleanup
    provides: AutoCleanupEvaluator service and CleanupRule type with id/name/enabled/action/conditions shape
provides:
  - Rule list renderer (renderRules) displaying rules as toggle+delete cards in Tools tab
  - Add-rule inline form builder with all four condition types (merged, olderThanDays, pattern, noRemote)
  - Full CRUD handlers: saveNewRule, cancelNewRule, toggleRule, deleteRule wired to saveCleanupRules postMessage
affects: [12-02, phase-13, phase-14]

# Tech tracking
tech-stack:
  added: []
  patterns: [DOM createElement/textContent for user data (XSS-safe), addEventListener over onclick attributes for programmatic handlers, escapeHtml utility function for all user-controlled string interpolation]

key-files:
  created: []
  modified:
    - src/extension.ts

key-decisions:
  - "Use DOM createElement/textContent for user data rather than innerHTML with template literals to satisfy security hook and prevent XSS"
  - "escapeHtml() added to webview client script block — only needed for rule.id in preview div id attribute since all other content uses textContent"
  - "renderRules() replaces server-side static empty-state rendering; rules-container HTML simplified to empty div"
  - "conditions.merged/noRemote omitted (not set false) when unchecked — only truthy conditions stored, matching plan requirement"
  - "formatConditions returns unicode em-dash literal for empty conditions to avoid TypeScript string escape issues"

patterns-established:
  - "Rule CRUD pattern: post saveCleanupRules with full updated array; extension re-renders webview from workspaceState"
  - "Form toggle pattern: addCleanupRule() checks for existing #new-rule-form, removes it if present (toggle behavior)"

requirements-completed: [RULE-01, RULE-02, RULE-03]

# Metrics
duration: 3min
completed: 2026-02-17
---

# Phase 12 Plan 01: Cleanup Rules UI Summary

**DOM-based rule builder with toggle/delete cards and inline add-form covering all four condition types (merged, olderThanDays, pattern, noRemote) wired to saveCleanupRules persistence**

## Performance

- **Duration:** ~3 min
- **Started:** 2026-02-17T23:49:16Z
- **Completed:** 2026-02-17T23:51:49Z
- **Tasks:** 1 of 1
- **Files modified:** 1

## Accomplishments
- Replaced `alert('Rule builder coming soon')` placeholder with full rule builder implementation (7 new functions)
- Rules render as cards with enabled checkbox toggle and Delete button, wired to toggleRule/deleteRule handlers
- Inline form for adding rules with all four condition inputs, validation, and save/cancel flow
- Added `escapeHtml()` client-side utility for safe HTML attribute interpolation
- `renderRules()` called at script initialization so rules display on load without page interaction

## Task Commits

Each task was committed atomically:

1. **Task 1: Implement rule list rendering and add-rule form in webview** - `818b4ef` (feat)

**Plan metadata:** (pending final docs commit)

## Files Created/Modified
- `src/extension.ts` - Added escapeHtml(), renderRules(), formatConditions(), addCleanupRule() (full), saveNewRule(), cancelNewRule(), toggleRule(), deleteRule(); simplified rules-container HTML; replaced placeholder alert

## Decisions Made
- Used DOM methods (createElement, textContent, addEventListener) for user-provided data to satisfy the project's security hook which flags innerHTML with dynamic content — this is the more robust XSS-safe approach regardless
- `formatConditions` returns a unicode em-dash for no-conditions case rather than a JS string escape sequence to avoid any TypeScript template issues
- `conditions.merged` and `conditions.noRemote` are only added to the conditions object when the checkbox is checked (truthy-only pattern), never set to false

## Deviations from Plan

None - plan executed exactly as written, with one implementation detail deviation:

The plan specified using `escapeHtml()` in HTML template literals (`innerHTML` with template strings), but the project security hook blocked `innerHTML` with dynamic content. Used DOM `createElement`/`textContent`/`addEventListener` pattern instead for all user data. The `escapeHtml()` function was still added and is used for the `rule.id` in the preview div `id` attribute. This is a Rule 1 (security-aligned) deviation with no impact on functionality.

## Issues Encountered
- Security hook blocked the original template-literal innerHTML approach (hook fires on any innerHTML with dynamic content). Resolved by switching to DOM methods — cleaner and safer.

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- Rule CRUD is complete and wired to persistence via `saveCleanupRules`
- Phase 12 Plan 02 can now add dry-run preview content into `#preview-{ruleId}` divs already rendered by `renderRules()`
- The `cleanupRulesArray` variable and `rulesJson` injection remain in server-side TypeScript, ready for any further rule evaluation UI

## Self-Check: PASSED

- `src/extension.ts` - FOUND
- Commit `818b4ef` - FOUND
- All 7 functions (renderRules, formatConditions, addCleanupRule, saveNewRule, cancelNewRule, toggleRule, deleteRule) - FOUND (7/7)
- `alert('Rule builder coming soon')` - NOT FOUND (removed)
- `conditions.merged = false` - NOT FOUND (correct)
- `npm run compile` - 0 errors

---
*Phase: 12-cleanup-rules-ui*
*Completed: 2026-02-17*
