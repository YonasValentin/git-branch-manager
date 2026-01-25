# Architecture

**Analysis Date:** 2026-01-25

## Pattern Overview

**Overall:** VS Code Extension with Monolithic Webview UI Pattern

This is a single-file VS Code extension that implements a comprehensive Git branch management dashboard. The architecture follows a client-server pattern where the VS Code extension backend communicates with an embedded webview frontend through a message-passing interface.

**Key Characteristics:**
- Single-file codebase (`src/extension.ts`, 3378 lines)
- Message-driven bidirectional communication between extension backend and webview frontend
- Embedded HTML/CSS/JavaScript UI (no separate bundled frontend)
- Batch-optimized Git operations with fallback to sequential processing
- Global state management for user preferences and usage tracking

## Layers

**Extension Backend (VS Code API Layer):**
- Purpose: VS Code integration, Git command execution, UI lifecycle management
- Location: `src/extension.ts` (lines 1-2000+)
- Contains: Command registration, webview creation, message handlers, Git operations
- Depends on: vscode API, child_process, https modules
- Used by: VS Code core, webview frontend (via message passing)

**Git Operations Layer:**
- Purpose: Abstract Git CLI operations with structured interfaces
- Location: `src/extension.ts` (lines 301-1100+)
- Contains: Branch info retrieval, remote tracking, stash management, worktree operations
- Depends on: child_process exec, Git CLI
- Used by: Extension backend for data collection

**UI/Webview Layer:**
- Purpose: Render interactive dashboard and handle user interactions
- Location: `src/extension.ts` (lines 2236-3220+)
- Contains: HTML structure, CSS styling, JavaScript event listeners
- Depends on: VS Code Webview API (postMessage, vscode variable)
- Used by: User interaction, extension backend for rendering

**Data Models & Interfaces:**
- Purpose: Type-safe representations of Git entities
- Location: `src/extension.ts` (lines 24-176)
- Contains: BranchInfo, PRStatus, RemoteBranchInfo, WorktreeInfo, StashInfo, etc.
- Depends on: TypeScript types
- Used by: All layers for consistent data representation

**State Management Layer:**
- Purpose: Persist and retrieve user settings, notes, and cleanup rules
- Location: `src/extension.ts` (lines 1067-1120)
- Contains: Branch notes (getBranchNotes, saveBranchNote), cleanup rules (getCleanupRules, saveCleanupRules), usage tracking
- Depends on: vscode.ExtensionContext.globalState and workspaceState
- Used by: Extension backend for dashboard configuration

## Data Flow

**Main User Interaction Flow:**

1. User opens VS Code command palette or clicks dashboard button
2. `activate()` function registers all extension commands
3. User triggers `git-branch-manager.cleanup` command
4. `showBranchManager(context)` called (line 1538)
5. Parallel Git operations collect data: `getBranchInfo()`, `getRemoteBranchInfo()`, `getWorktreeInfo()`, `getStashInfo()` (line 1562)
6. `getWebviewContent()` renders HTML with collected data (line 1615)
7. Webview frontend renders interactive dashboard with event listeners
8. User clicks branch action (delete, switch, stash, etc.)
9. Frontend posts message via `vscode.postMessage({ command: 'deleteBranch', branch: name })`
10. Backend receives via `panel.webview.onDidReceiveMessage()` (line 1617)
11. Handler executes Git operation via child_process exec
12. `refreshPanel()` updates webview with new data (line 2001)

**Health Score Calculation Flow:**

1. For each branch, `calculateHealthScore()` evaluates factors (line 348)
2. Factors: merged status, age in days, remote tracking status, PR status
3. Returns score 0-100
4. `getHealthStatus()` maps score to status: healthy/warning/critical/danger (line 381)
5. `getHealthReason()` provides explanation (line 393)
6. UI renders color-coded health dots based on status

**Batch Git Operation Flow:**

1. User selects multiple branches and clicks delete
2. `deleteMultipleBranches()` attempts batch operation: `git branch -D -- branch1 branch2 branch3` (line 2081)
3. If batch fails (line 2099), falls back to sequential deletion
4. Tracks deleted vs. failed counts
5. Shows consolidated notification with summary

**State Synchronization Flow:**

1. Branch notes stored in `vscode.ExtensionContext.workspaceState` (line 1080+)
2. Cleanup rules stored in `vscode.ExtensionContext.globalState` (line 1110+)
3. Usage tracking (branchesDeleted, cleanups) stored in globalState (line 2069)
4. Each panel refresh fetches fresh state from Git and extensions context (line 2001)

## Key Abstractions

**BranchInfo Interface:**
- Purpose: Complete representation of a local branch with health metrics
- Location: `src/extension.ts` lines 24-41
- Pattern: Data transfer object (DTO) with health scoring
- Contains: name, merge status, dates, PR status, author, remote tracking state
- Populated by: `getBranchInfo()` function with batch git operations

**Message Protocol:**
- Purpose: Type-safe communication between extension and webview
- Pattern: Command-based message dispatch with `switch(message.command)`
- Commands: deleteBranch, deleteMultiple, switchBranch, createStash, compareBranches, etc.
- Example: `{ command: 'deleteBranch', branch: 'feature/auth' }`
- Handler: `panel.webview.onDidReceiveMessage()` at line 1617

**Git Command Execution Pattern:**
- Purpose: Safe execution of git commands with user input
- Pattern: `exec(git command, { cwd: gitRoot })`
- Input quoting: Branch names wrapped in `JSON.stringify()` to escape special chars
- Error handling: Try-catch with user-facing error messages

**Health Scoring System:**
- Purpose: Quantify branch health on 0-100 scale
- Location: `calculateHealthScore()` lines 348-379
- Factors applied:
  - Merged branches: -50 points
  - 30+ days old: -30 points
  - No remote tracking: -20 points
  - Base score: 100 points
- Result: Visual indicator (dot color) and status badge in UI

## Entry Points

**Extension Activation:**
- Location: `src/extension.ts` line 193, `export function activate(context: vscode.ExtensionContext)`
- Triggers: On VS Code startup (activationEvents: onStartupFinished in package.json)
- Responsibilities:
  - Register 8 commands (cleanup, createBranch, createWorktree, stash, etc.)
  - Create status bar item showing current branch
  - Increment usage count for analytics

**Main Dashboard Command:**
- Location: `git-branch-manager.cleanup` command handler
- Invokes: `showBranchManager(context)` at line 1538
- Responsibilities:
  - Verify Git repository exists
  - Fetch all Git data in parallel
  - Create webview panel
  - Render dashboard HTML
  - Listen for webview messages

**Webview Message Handler:**
- Location: `panel.webview.onDidReceiveMessage()` at line 1617
- Triggers: Any frontend action (click, submit)
- Responsibilities:
  - Dispatch to appropriate command handler
  - Execute Git operations
  - Show confirmation dialogs when needed
  - Refresh webview on successful operations

**Individual Command Handlers:**
- Create Branch: `vscode.commands.registerCommand('git-branch-manager.createBranch')`
- Quick Cleanup: `vscode.commands.registerCommand('git-branch-manager.quickCleanup')`
- Manage Worktrees: `vscode.commands.registerCommand('git-branch-manager.manageWorktrees')`
- Each shows appropriate quickPick or input dialogs

## Error Handling

**Strategy:** Graceful degradation with user-facing error messages and fallback behaviors

**Patterns:**

- **Missing Git Repository:** If `getGitRoot()` returns undefined, show error dialog with option to initialize git (lines 1540-1559)

- **Branch Operation Failures:** Try-catch blocks on all git exec calls with error messages (line 2034-2039)

- **Batch Operation Fallback:** Batch delete attempts single command first, falls back to sequential deletion on failure (lines 2099-2112). Tracks deleted vs. failed counts separately.

- **Partial Failure Handling:** Track deleted vs. failed counts, show consolidated warning with summary (lines 2130-2137)

- **Git Data Collection Robustness:** Empty catch blocks preserve previous data on collection failure (lines 485, 640)

- **XSS Protection:** All HTML escaping via `escapeHtml()` function before rendering user-controlled content (branch names, author names)

## Cross-Cutting Concerns

**Logging:**
- Method: console.error and console.warn for failures
- Pattern: Error logging on batch operation failures and Git data collection failures
- Example: `console.error('getBranchInfo failed:', err)` at line 567

**Validation:**
- Branch name handling: Input wrapped in `JSON.stringify()` for git commands
- HTML escaping: `escapeHtml()` function before rendering (line 2490)
- Protected branches list: Configurable in settings, checked before allowing deletion
- Configuration reading: `vscode.workspace.getConfiguration('gitBranchManager')`

**Authentication:**
- GitHub API: Optional GitHub session retrieval for PR status (line 1009)
- Pattern: `vscode.authentication.getSession('github')`
- Used for: Fetching PR status when available
- Graceful: Continues without GitHub data if auth unavailable

**Performance Optimization:**
- Batch Git operations: Combine multiple branches into single command
- Promise.all for parallel data collection (line 1562)
- Batch processing with 50-item chunks in branch info collection (line 498)
- Status bar updates debounced through updateGlobalStatusBar (line 257)

**Security:**
- Content Security Policy: Nonce generated for webview (getNonce() line 12)
- Child process execution: All user input escaped with JSON.stringify()
- No eval or dynamic code execution
- Webview sandbox mode enabled via retainContextWhenHidden: true

---

*Architecture analysis: 2026-01-25*
