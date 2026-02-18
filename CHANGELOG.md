# Change Log

All notable changes to the "Git Branch Manager" extension will be documented in this file.

## [2.0.3] - 2026-02-18

### Fixed
- **CRITICAL: Branch switching broken**: `switchBranch` used `git checkout -- <name>` (file restore) instead of `git checkout <name>` (branch switch) — branches could not be switched via the UI
- **XSS in webview**: Escaped `branch.author`, `branch.prStatus.url`, `branch.prStatus.state`, `branch.localBranch`, and `entry.commitHash` in HTML output
- **JSON injection in script blocks**: Added `</script>` breakout protection for `JSON.stringify` in cleanup rules, branch names, and current branch data
- **Pipe delimiter corruption**: Replaced `|` with null byte (`%x00`) separator in all `--pretty=format` and `--format` git commands — commit messages containing `|` no longer corrupt branch comparison, timeline, and stash parsing
- **Substring false positives**: `getBaseBranch` local fallback now splits branch list and uses exact match instead of `string.includes()` (e.g. `maintain` no longer matches `main`)
- **Unawaited globalState writes**: All 8 `globalState.update()` calls in branch commands now properly awaited
- **HTTP response safety**: Added 5 MB response body cap and 10-second timeout to GitHub, GitLab, and Azure DevOps API calls
- **URL encoding in API paths**: GitHub owner/repo and Azure DevOps organization now URL-encoded in API request paths
- **Nonce generation**: Replaced `Math.random()` with `crypto.randomBytes()` for CSP nonce generation
- **Webview security**: Added `localResourceRoots: []` to restrict webview file system access
- **Merge-base safety**: Added `--` separator to `merge-base` call to prevent branch names from being interpreted as flags
- **CHANGELOG visible on marketplace**: Removed CHANGELOG.md from `.vscodeignore` so the Changelog tab is populated
- **Type safety**: Replaced `error: any` with `error: unknown` + `instanceof` guards across commands; removed `as any` cast in remote branch selection
- **Unused code**: Removed unused `getCurrentBranch` import and call in worktree command

## [2.0.2] - 2026-02-18

### Fixed
- **Webview CSP compliance**: Replaced all 36 inline onclick/onchange handlers with data-action event delegation, fixing buttons that were silently blocked by Content Security Policy
- **QuickPick label matching**: Gone detector and auto-cleanup evaluator now correctly strip icon prefixes when matching user selections back to branch data
- **Team-safe mode fail-safe**: Auto-cleanup now skips all deletions when git user.name cannot be determined, instead of deleting all branches
- **Array bounds safety**: Fixed potential undefined access in for-each-ref parsing when tracking status field is absent
- **Platform detection accuracy**: GitLab HTTPS fallback no longer incorrectly matches GitHub or Azure DevOps URLs
- **Base branch fallback**: getBaseBranch now checks local branches when no remote is available, preventing errors in local-only repos
- **Webview panel disposal**: Added onDidDispose handler per VS Code API best practices
- **Async error handling**: Added proper void annotations and error catching for fire-and-forget async calls

### Changed
- Removed unused imports and dead code for cleaner bundle

## [2.0.0] - 2026-02-18

### Added
- **Sidebar Tree View**: Native VS Code tree view in Source Control sidebar with branches grouped by status (Merged, Stale, Orphaned, Active), health score badges, PR status icons, and lazy loading for 1000+ branches
- **Multi-Repository Support**: Automatic detection of all git repositories in workspace folders including nested monorepos, repository picker UI, aggregate status bar across all repos, and per-repo storage namespacing
- **Gone Branch Auto-Detection**: Watches `.git/FETCH_HEAD` for post-fetch/pull events, prompts cleanup of orphaned local branches, one-click clean all gone branches, configurable behavior (prompt, auto-delete, notify only)
- **Event-Driven Auto-Cleanup**: Triggers cleanup evaluation on git fetch, pull, and merge events with compound rules (merged AND stale AND pattern match), dry-run preview, glob exclusion patterns, and team-safe mode (only suggest branches you authored)
- **Cleanup Rules UI**: Visual rule builder form in webview (no JSON editing), conditions for merged/age/pattern/no-remote, enable/disable individual rules, dry-run preview showing affected branches, and JSON import/export for team sharing
- **Branch Comparison & Timeline**: Select two branches to compare unique commits and changed files, click files to open VS Code diff editor, branch activity timeline showing last 5 commits on hover in tree view, timeline available in both webview and tree view tooltip
- **Platform Integration**: Auto-detects GitHub, GitLab, or Azure DevOps from remote URL (no config needed), fetches and displays PR/MR status per branch for all platforms, click branch to open associated PR/MR in browser, PAT management via VS Code secret storage
- **Undo & Recovery System**: Recovery tab showing deleted branches with name, date, and commit hash, one-click restore any branch from recovery log, recovery log persists across VS Code sessions

### Security
- Migrated all git operations from `exec` to `execFile` — eliminates all shell injection vectors
- Added ReDoS-safe regex validation with timeout protection for user-provided patterns
- Added `frame-ancestors 'none'` to webview CSP preventing clickjacking attacks
- All webview DOM operations use `createElement`/`textContent` instead of `innerHTML` preventing XSS

### Changed
- Version bump from 1.7.2 to 2.0.0 reflecting major feature additions
- Excluded `.claude/` and `.planning/` directories from VSIX package

## [1.7.1] - 2025-12-10

### Added
- GitHub Sponsors integration with dismissable banner in dashboard
- FUNDING.yml for repository sponsor button
- Updated README with sponsor section

## [1.7.0] - 2025-12-10

### Performance
- Dramatically improved panel load time using `git for-each-ref` batch queries
- Branch metadata (date, author) now fetched in a single git call instead of per-branch
- Remote branch timestamps retrieved via batch ref lookup
- Ahead/behind counts fetched in parallel with configurable batch size
- Stash file details loaded concurrently
- Panel data (branches, remotes, worktrees, stashes) fetched in parallel
- Batch branch deletion: multiple branches deleted in single git command

### Changed
- Refactored data fetching functions for better maintainability
- Improved error handling with automatic fallback to legacy per-branch queries

## [1.6.0] - 2025-01-30

### Added
- **Tools Tab**: New centralized tools panel for advanced operations
- **Batch Rename**: Rename multiple branches using regex find/replace with preview
- **Regex Selection**: Select and delete branches matching a pattern
- **Branch Notes**: Add personal notes to branches (stored locally)
- **Auto-Cleanup Rules**: Create configurable rules for automatic branch cleanup
  - Filter by merge status, age, pattern, and remote tracking
  - Toggle rules on/off individually
  - Run all enabled rules with one click
- **GitHub PR Integration**: Fetch and display PR status for branches
  - Shows open, merged, and draft PR badges
  - Links directly to GitHub PR pages

## [1.5.0] - 2025-01-30

### Added
- Branch Comparison View - compare any two branches side by side
- See commits ahead/behind between branches
- View all file changes with status indicators (added, modified, deleted)
- Swap branches button for quick comparison reversal
- New Compare tab in the main dashboard

## [1.4.1] - 2025-01-30

### Fixed
- Search highlights now properly clear when search field is emptied

## [1.4.0] - 2025-01-30

### Added
- **Advanced Search & Filtering**: Instantly find branches with fuzzy search
- Search input with keyboard shortcut (Cmd/Ctrl+F to focus)
- Filter chips to quickly filter by status (Merged, Stale, Orphaned, Active)
- Sort dropdown (Health, Name A-Z/Z-A, Newest/Oldest first)
- Live result count showing filtered results
- Match highlighting in search results
- Empty state with clear filters button
- Professional VS Code-native styling

## [1.3.1] - 2025-01-30

### Added
- Expandable stash preview - click on a stash to see all changed files
- File list shown with proper styling and file icons

## [1.3.0] - 2025-01-30

### Added
- **Branch Health Scoring**: Every branch now gets a health score (0-100) based on merge status, age, remote tracking, and commits behind
- **Remote Branch Management**: New "Remote" tab to view and clean merged remote branches, prune stale references
- **Git Worktree Integration**: New "Worktrees" tab to create, manage, lock/unlock, and remove worktrees
- **Stash Management**: New "Stashes" tab to create, apply, pop, drop, and clear stashes
- **Orphaned Branch Detection**: Identifies local branches whose remote tracking branch has been deleted
- **Tabbed UI**: Organized interface with Local, Remote, Worktrees, and Stashes tabs
- New commands:
  - `Git Branch Manager: Clean Remote Branches`
  - `Git Branch Manager: Manage Worktrees`
  - `Git Branch Manager: Create Worktree`
  - `Git Branch Manager: Quick Stash`
  - `Git Branch Manager: Pop Latest Stash`

### Improved
- Health indicators show color-coded status for each branch
- Issue number extraction from branch names (shows linked issues)
- Enhanced branch metadata display (author, ahead/behind counts)
- Professional VS Code-native UI styling

## [1.2.10] - 2025-01-13

### Fixed
- Status bar branch count was slow to update after operations
- Status bar now updates immediately after all branch operations
- Added immediate updates for: delete, bulk delete, create branch, refresh
- Reduced background update interval from 60 to 30 seconds
- Created global status bar reference for instant updates

## [1.2.9] - 2025-01-13

### Fixed
- UI not updating after branch deletion or other operations
- Added proper return value to deleteBranch function to track success
- Generate new nonce for each webview refresh to ensure proper re-rendering
- Only refresh UI when operations actually succeed (not on cancel)
- Added visual feedback on refresh button
- Improved refresh mechanism for all operations (delete, switch, bulk delete)
- All UI updates now work reliably after any branch operation

## [1.2.8] - 2025-01-13

### Fixed
- Buttons were not responding to clicks due to DOMContentLoaded event timing issues
- Replaced DOMContentLoaded with proper DOM readiness check
- Removed debug code from production
- Improved event listener attachment reliability using `currentTarget` instead of `this`
- Wrapped script in IIFE to avoid global scope pollution
- Enhanced user experience by moving confirmations to VS Code native dialogs
- Added configurable confirmation dialogs via `gitBranchManager.confirmBeforeDelete` setting
- All buttons now work reliably: Delete, Switch, Create Branch, Quick Clean, etc.

## [1.2.7] - 2024-01-11

### Fixed
- Functions were defined after DOMContentLoaded, causing reference errors
- Moved all function definitions before the event listener setup
- Removed duplicate function definitions that were causing conflicts
- Added comprehensive error handling and console logging for debugging
- All buttons now work correctly

## [1.2.6] - 2024-01-11

### Fixed
- Inline scripts were being silently blocked by VS Code's default CSP
- Implemented proper nonce-based Content Security Policy
- Added getNonce() function to generate secure random nonces
- Updated CSP meta tag to allow only scripts with the correct nonce
- All JavaScript now executes properly with secure CSP compliance

## [1.2.5] - 2024-01-11

### Fixed
- Removed all inline onclick handlers that were blocked by CSP
- Replaced with proper event listeners using addEventListener
- Fixed all buttons: Delete, Delete All, Delete Selected, Quick Clean, Refresh, Create Branch, Switch
- Fixed all checkboxes: Select All for merged/old/active branches
- Fixed all links: Support, Review, Report Issues
- Every interactive element now uses proper event delegation

## [1.2.4] - 2024-01-11

### Fixed
- Delete buttons not working due to Content Security Policy blocking inline event handlers
- Added proper CSP headers to allow inline scripts in webview
- Fixed nested branch-actions div in Active Branches section
- All delete, switch, and bulk operations now work correctly

## [1.2.3] - 2024-01-11

### Fixed
- "NaN years ago" date display issue for merged branches
- Fixed git log command that was failing to get commit dates
- Added proper error handling for date parsing
- Ensured delete functionality works correctly

## [1.2.2] - 2024-01-11

### Fixed
- Delete buttons not working in the branch manager webview
- Quick Clean merged branches button not functioning
- Refresh button appearing to do nothing
- Branch names with special characters broke the delete functionality
- Added proper HTML escaping and decoding for branch names in the UI

## [1.2.1] - 2024-01-11

### Fixed
- Fixed git checkout command syntax error when creating branches from templates
- Improved handling of new repositories without any Git initialization
- Added helpful prompts when trying to use the extension in repositories without commits
- Better error messages to guide users through initial repository setup
- Enhanced user experience for brand new projects
- Clear instructions for initializing Git repositories

## [1.2.0] - 2024-01-11

### Added
- Smart review request system that appears after successful cleanups
- Review prompts show after 5 successful cleanups or 20 branches deleted
- "Leave a Review" link in the webview footer
- Tracks branch deletion statistics for better engagement

### Improved
- Updated icon for better quality
- Review requests are timed after user experiences value
- Non-intrusive review prompts with "Don't Ask Again" option

## [1.1.2] - 2024-01-11

### Improved
- Updated icon to 256x256px with transparent background for better quality
- Optimized keywords for better marketplace discoverability
- Enhanced description for improved search ranking

## [1.1.1] - 2024-01-11

### Added
- Extension icon for better visibility in VS Code Marketplace

## [1.1.0] - 2024-01-11

### Security
- Fixed command injection vulnerability by properly escaping branch names in Git commands
- All branch names are now safely quoted to prevent malicious code execution

### Fixed
- Memory leak from interval timers that were never cleaned up
- Incorrect merge detection - now uses `git branch --merged` for accurate results
- Hardcoded stale days (30) - now properly uses user configuration setting
- Protected branches (main, master, etc.) are now excluded from cleanup suggestions

### Added
- Support message to help fund continued development
- Buy Me a Coffee links in README and webview footer
- Protected branches are shown in the UI with configuration hint
- Dynamic stale days display based on user settings

### Improved
- Better error handling for Git commands
- More accurate branch merge detection
- Improved configuration usage throughout the extension
- Added usage tracking to understand feature adoption

## [1.0.0] - 2024-01-11

### Initial Release
- Branch management dashboard
- Quick cleanup command for merged branches
- Branch creation from templates
- Status bar integration showing branches to clean
- Bulk selection and deletion
- Smart notifications
- Customizable settings
