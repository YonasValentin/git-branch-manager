# External Integrations

**Analysis Date:** 2026-01-25

## APIs & External Services

**GitHub API:**
- Service: GitHub Pull Requests API
  - SDK/Client: Built-in https module (Node.js native)
  - Endpoint: https://api.github.com/repos/{owner}/{repo}/pulls
  - Auth: Optional GitHub token passed from user
  - Implementation: fetchGitHubPRs() function at line 1009 in src/extension.ts
  - Features: Fetches PR status, state (open/closed/merged/draft), title, URL for branches
  - Rate limiting: Requests per hour limited by GitHub (60 unauthenticated, 5000 authenticated)

**GitHub Web Integration:**
- Service: GitHub Sponsors and Issue Reporting
  - Links: Hardcoded URLs to https://github.com/sponsors/YonasValentin and issues page
  - Method: vscode.env.openExternal() for deep linking
  - No API calls, purely UI navigation

## Data Storage

**Local Storage:**
- Workspace State: VS Code's context.workspaceState API
  - Branch notes: Stored as branchNotes:{repoPath} key
  - Cleanup rules: Stored as autoCleanupRules key
  - Both stored per workspace/repository

**Files:**
- Git repository data: No persistent local files created
- All state is ephemeral from git commands or stored in VSCode workspace state

**Caching:**
- No external caching service used
- In-memory caching during extension runtime via JavaScript Maps

## Git Integration

**Git Commands Used:**
- Branch querying: git for-each-ref (batch fetch branch metadata)
- Branch operations: git branch -D (delete), git worktree operations
- Remote operations: git fetch --prune, git ls-remote
- Stash operations: git stash commands
- Merge detection: git merge-base
- Log queries: git log for commit history

**Execution Method:**
- Child process execution via Node.js child_process.exec()
- Promisified with util.promisify() for async/await support

## Authentication & Identity

**Auth Provider:**
- GitHub API: Optional personal access token
  - Passed from user via webview input
  - Stored in memory only (not persisted)
  - Sent as bearer token in Authorization header
  - Pattern: Authorization: token {token}

**Local Git Authentication:**
- Handled by Git's built-in credentials (SSH keys, HTTP credentials, credential helpers)
- Extension does not manage or store git credentials

## Configuration

**VS Code Settings:**
Configuration properties stored in gitBranchManager namespace:
- gitBranchManager.showNotifications (boolean, default: true)
- gitBranchManager.daysUntilStale (number, default: 30, range: 7-365)
- gitBranchManager.protectedBranches (array, default: ["main", "master", "develop", "dev", "staging", "production"])
- gitBranchManager.confirmBeforeDelete (boolean, default: true)

**Configuration Access:**
- Read via vscode.workspace.getConfiguration('gitBranchManager') at src/extension.ts lines 276, 435, 585, etc.
- Updated via config.update() method for user preference changes

## Webhooks & Callbacks

**Incoming:**
- None. Extension is passive and only responds to user commands and VS Code events.

**Outgoing:**
- None. No webhooks or callbacks sent to external services.

## Monitoring & Observability

**Error Tracking:**
- Not detected. No external error tracking service integrated.

**Logging:**
- VS Code Output Channel: Potential logging via vscode.window.createOutputChannel()
- Console errors: Not explicitly logged to external service
- User notifications: Modal dialogs and status messages via VS Code UI

**Debug Mode:**
- VS Code native debugging via .vscode/launch.json
- Extension runs with source maps in development mode

## CI/CD & Deployment

**Hosting:**
- VS Code Marketplace (https://marketplace.visualstudio.com)
- GitHub Repository (https://github.com/yonasvalentin/git-branch-manager-pro)

**CI Pipeline:**
- GitHub Actions workflows: Not detected in analyzed files
- FUNDING.yml detected (GitHub Sponsors integration)

**Build & Publish:**
- Manual publish workflow (no automated CI detected)
- NPM scripts for local compilation and packaging
- VSCode CLI for marketplace submission

## User Interactions (Webview IPC)

**Commands from Webview to Extension:**
- cleanup - Delete selected branches
- fetchPRs - Fetch PR status for branches with optional token
- openGithub - Open GitHub links
- createBranch - Create new branch from template
- createWorktree - Create Git worktree
- saveBranchNote - Save user notes on branches
- deleteNote - Delete branch notes
- saveCleanupRule - Save auto-cleanup rules
- deleteRule - Remove cleanup rules

**Data Passed from Webview:**
- Branch names and selections
- GitHub token (optional, for PR fetching)
- User text input (notes, rules)
- Configuration values

## Rate Limiting & Quotas

**GitHub API:**
- 60 requests per hour (unauthenticated)
- 5000 requests per hour (authenticated with personal access token)
- Endpoint: /repos/{owner}/{repo}/pulls?state=all&per_page=100 supports pagination

**VS Code Marketplace:**
- No documented rate limits for extension operation
- Distribution through marketplace

## Secrets Management

**GitHub Token:**
- Optional user-provided token
- Not stored persistently
- Passed via webview message from user
- Stored in memory only during PR fetch operation
- No credential storage or keychain integration

**No other secrets required** for normal operation. Git credentials are handled by system Git installation.

---

*Integration audit: 2026-01-25*
