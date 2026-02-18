---
phase: 14-platform-integration
plan: 01
subsystem: api
tags: [gitlab, azure-devops, platform-detection, git, typescript, https]

# Dependency graph
requires:
  - phase: 13-enhanced-comparison-timeline
    provides: git module patterns (github.ts, core.ts, PRStatus type)
provides:
  - Platform detection from remote origin URL (GitHub, GitLab, Azure DevOps — 6 URL formats)
  - GitLab MR fetching via REST API v4 with PRIVATE-TOKEN auth
  - Azure DevOps PR fetching via REST API v7.1 with Basic auth
  - Barrel exports for all new symbols via src/git/index.ts
affects: [platform-integration-wiring, webview-pr-status, branch-info-enrichment]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Platform detection via regex priority chain on remote origin URL"
    - "Per-platform API modules mirroring github.ts pattern (https, PRStatus, empty-map-on-error)"
    - "PRIVATE-TOKEN header for GitLab (not Bearer)"
    - "Basic auth with empty username + PAT for Azure DevOps"

key-files:
  created:
    - src/git/platformDetect.ts
    - src/git/gitlab.ts
    - src/git/azure.ts
  modified:
    - src/git/index.ts

key-decisions:
  - "detectPlatform regex order: GitHub first (most common), then Azure 3 formats, then GitLab SSH, then GitLab HTTPS fallback — avoids false positives"
  - "GitLab uses PRIVATE-TOKEN header (API v4 convention) not Authorization: Bearer"
  - "Azure DevOps Basic auth: empty username + PAT encoded as Base64(':' + pat) — official Azure PAT format"
  - "Azure DevOps strips refs/heads/ from sourceRefName before branch map lookup"
  - "GitLab isDraft field not in standard MR payload; opened state suffices for open/draft distinction at v4"

patterns-established:
  - "Platform API module pattern: import https + PRStatus, return Promise<Map<string, PRStatus>>, resolve(empty) on any error"
  - "URL regex matching order matters: more specific patterns (Azure) before generic HTTPS fallback (GitLab)"

requirements-completed: [PLAT-01, PLAT-02, PLAT-03, PLAT-05]

# Metrics
duration: 2min
completed: 2026-02-18
---

# Phase 14 Plan 01: Platform Integration Summary

**Platform detection module + GitLab API v4 / Azure DevOps API v7.1 fetchers — three new TypeScript modules mirroring github.ts pattern, enabling multi-platform PR status enrichment**

## Performance

- **Duration:** ~2 min
- **Started:** 2026-02-18T18:00:31Z
- **Completed:** 2026-02-18T18:02:10Z
- **Tasks:** 3
- **Files modified:** 4 (3 created, 1 modified)

## Accomplishments

- `detectPlatform(cwd)` handles all 6 URL formats: GitHub SSH/HTTPS, Azure DevOps new HTTPS, Azure DevOps old HTTPS (visualstudio.com), Azure DevOps SSH, GitLab SSH, GitLab HTTPS (self-hosted fallback)
- `fetchGitLabMRs` fetches from `/api/v4/projects/{path}/merge_requests` with PRIVATE-TOKEN auth; maps opened/merged/closed/locked to PRStatus states
- `fetchAzurePRs` fetches from `dev.azure.com` with Basic auth (empty user + PAT); strips `refs/heads/` prefix; maps active/active+isDraft/completed/abandoned to PRStatus states
- All new symbols accessible via `import { detectPlatform, fetchGitLabMRs, fetchAzurePRs } from './git'`

## Task Commits

Each task was committed atomically:

1. **Task 1: Create platform detection module** - `b9dbc58` (feat)
2. **Task 2: Create GitLab and Azure DevOps PR fetching modules** - `31424ef` (feat)
3. **Task 3: Update barrel exports in git/index.ts** - `6ff4bb7` (feat)

**Plan metadata:** TBD (docs: complete plan)

## Files Created/Modified

- `src/git/platformDetect.ts` — `detectPlatform(cwd)`, `Platform` type, `PlatformInfo` interface
- `src/git/gitlab.ts` — `fetchGitLabMRs(host, projectPath, branches, token)`
- `src/git/azure.ts` — `fetchAzurePRs(organization, project, repo, branches, pat)`
- `src/git/index.ts` — Added barrel exports for all three new modules

## Decisions Made

- Regex priority order in `detectPlatform`: GitHub → Azure new HTTPS → Azure old HTTPS → Azure SSH → GitLab SSH → GitLab HTTPS. Azure patterns must precede the generic HTTPS fallback since `dev.azure.com` would otherwise match the GitLab HTTPS fallback.
- GitLab `PRIVATE-TOKEN` header (not `Authorization: Bearer`) — matches GitLab API v4 convention.
- Azure Basic auth: `Buffer.from(':' + pat).toString('base64')` — empty username + PAT is the documented format for Azure DevOps PAT authentication.
- `refs/heads/` stripping done inline per PR iteration — no separate utility needed.

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered

None.

## User Setup Required

None - no external service configuration required. Platform tokens will be read from VS Code settings in a subsequent plan.

## Next Phase Readiness

- `detectPlatform`, `fetchGitLabMRs`, and `fetchAzurePRs` are ready for wiring into branch info enrichment flow
- Next plan (14-02) can import all symbols from `./git` and integrate platform detection + PR fetching into the existing `getBranchInfo` / `fetchGitHubPRs` flow

---
*Phase: 14-platform-integration*
*Completed: 2026-02-18*
