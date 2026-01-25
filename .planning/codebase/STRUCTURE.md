# Codebase Structure

**Analysis Date:** 2026-01-25

## Directory Layout

```
git-branch-cleaner/
├── src/                           # TypeScript source code
│   ├── extension.ts              # Main extension file (3378 lines, monolithic)
│   └── test/
│       └── extension.test.ts      # Test suite
├── dist/                          # Compiled JavaScript (generated)
├── out/                           # Test output (generated)
├── .vscode/                       # VS Code configuration
├── media/                         # Screenshots and branding assets
├── package.json                   # Extension metadata and dependencies
├── tsconfig.json                  # TypeScript configuration
├── esbuild.js                     # Build configuration
├── .eslintrc.json                 # Linting rules
├── CHANGELOG.md                   # Version history
├── README.md                      # User documentation
├── LICENSE                        # MIT license
└── .gitignore                     # Git exclusions
```

## Directory Purposes

**src/:**
- Purpose: All TypeScript source code
- Contains: Extension backend code and test files
- Key files: `extension.ts` (main implementation, 3378 lines)

**src/test/:**
- Purpose: Test suite for the extension
- Contains: Mocha tests for extension functionality
- Key files: `extension.test.ts`

**dist/:**
- Purpose: Compiled output for distribution
- Contains: esbuild output JavaScript bundle
- Generated: Yes (from npm run compile or npm run package)
- Committed: No

**out/:**
- Purpose: Compiled test output
- Contains: TypeScript test compilation output
- Generated: Yes (from npm run compile-tests)
- Committed: No

**media/:**
- Purpose: Marketing and documentation assets
- Contains: Screenshot images for README and marketplace listing
- Key files: `screenshot-dashboard.png`, `screenshot-tools.png`

## Key File Locations

**Entry Points:**

- `package.json` (line 66): Specifies `main: "./dist/extension.js"` - the compiled extension entry point
- `src/extension.ts` (line 193): `export function activate(context: vscode.ExtensionContext)` - VS Code lifecycle hook

**Configuration:**

- `tsconfig.json`: TypeScript compiler options (strict mode, ES2022 target)
- `esbuild.js`: Build bundler configuration for production packaging
- `.eslintrc.json`: ESLint rules for code quality
- `package.json` (lines 152-184): VS Code extension configuration (commands, menus, keybindings, settings)

**Core Logic:**

All core logic is in `src/extension.ts` organized by function:
- Lines 24-176: Type definitions and interfaces (BranchInfo, PRStatus, RemoteBranchInfo, etc.)
- Lines 178-184: Branch template constants
- Lines 193-250: Activation and command registration
- Lines 257-300: Status bar management
- Lines 301-340: Git utilities (getGitRoot, getCurrentBranch, getBaseBranch)
- Lines 348-407: Health scoring (calculateHealthScore, getHealthStatus, getHealthReason)
- Lines 425-577: Branch info collection (getBranchInfo with batch processing)
- Lines 578-655: Remote branch info collection (getRemoteBranchInfo)
- Lines 664-707: Worktree info collection (getWorktreeInfo)
- Lines 712-780: Stash info collection (getStashInfo)
- Lines 783-865: Stash operations (createStash, applyStash, popStash, dropStash)
- Lines 865-942: Branch comparison (compareBranches)
- Lines 942-1120: Branch operations (renaming, deletion, GitHub integration, notes, rules)
- Lines 1538-2020: Main dashboard UI flow (showBranchManager, webview message handler, refreshPanel)
- Lines 2027-2200: Command implementations (switchBranch, deleteBranch, deleteMultipleBranches)
- Lines 2236-3220+: Webview HTML/CSS/JS generation (getWebviewContent)

**Testing:**

- `src/test/extension.test.ts`: Extension tests using Mocha and @vscode/test-cli
- Run with: `npm test`

## Naming Conventions

**Files:**

- Source files: kebab-case with `.ts` extension (`extension.ts`)
- Output files: `.js` in `dist/` directory
- Config files: lowercase with dots (`.eslintrc.json`, `tsconfig.json`)
- Build files: `.js` (esbuild.js)

**Functions:**

- Private helper functions: camelCase, no prefix
- Exported functions: camelCase (e.g., `activate()`)
- Async operations: prefixed with `async` keyword
- Git wrappers: descriptive names like `getBranchInfo()`, `getRemoteBranchInfo()`
- UI handlers: verb-noun pattern like `deleteBranch()`, `showBranchManager()`

**Variables:**

- Constants: UPPER_SNAKE_CASE (e.g., `BRANCH_TEMPLATES`)
- Local variables: camelCase (e.g., `gitRoot`, `branchNotes`)
- State variables: camelCase (e.g., `globalStatusBarItem`)
- Configuration keys: dot-notation (e.g., `gitBranchManager.daysUntilStale`)

**Interfaces:**

- Type names: PascalCase with "Info" or "Status" suffix (e.g., `BranchInfo`, `PRStatus`)
- All interfaces documented with JSDoc comments
- Example: `interface BranchInfo { name: string; isMerged: boolean; ... }`

**Message Commands:**

- kebab-case with hierarchical naming (e.g., `git-branch-manager.cleanup`, `git-branch-manager.createBranch`)
- Match VS Code command palette convention

## Where to Add New Code

**New Feature (e.g., Add branch filtering):**
- Primary logic: Add function to `src/extension.ts` alongside existing functions
- Message handler: Add case to the `switch(message.command)` block at line 1619
- UI update: Modify `getWebviewContent()` template string at line 2236
- Test: Add test case to `src/test/extension.test.ts`

**New Git Operation (e.g., Rebase support):**
- Wrapper function: Create async function in lines 301-1100+ section (parallel with getBranchInfo, getRemoteBranchInfo)
- Call from showBranchManager: Add to Promise.all at line 1562
- Result type: Define interface in lines 24-176
- Webview handler: Add case in message switch (line 1619)
- Webview UI: Render in getWebviewContent() HTML template

**New Dashboard Tab (e.g., History tab):**
- Data collection: Create getData function in Git operations section (lines 301-1100+)
- Call from showBranchManager: Add to Promise.all (line 1562)
- HTML tab: Add new tab button in getWebviewContent() header
- Tab content: Add conditional section in HTML template (after line 2550)
- Event listeners: Add event handlers in JavaScript section of getWebviewContent()
- Message handlers: Add cases to switch(message.command) at line 1619

**Utilities/Helpers:**
- Shared helpers: Add function at appropriate location in `src/extension.ts` (no separate util files currently)
- Formatting helpers: Add alongside existing functions like `formatAge()`, `escapeHtml()`
- Git helpers: Add in lines 301-1100+ section

**Configuration/Settings:**
- VS Code settings: Add to `package.json` contributes.configuration.properties (lines 154-183)
- Default values: Set in package.json or access via `vscode.workspace.getConfiguration()`
- Usage: Retrieve in extension with `config.get<Type>('keyName', defaultValue)`

## Special Directories

**dist/:**
- Purpose: Production bundled JavaScript output
- Generated: Yes, by esbuild during `npm run package`
- Committed: Yes (required for VS Code Marketplace)
- Should not be edited manually

**out/:**
- Purpose: Test compilation artifacts
- Generated: Yes, by `npm run compile-tests`
- Committed: No (in .gitignore)
- Should not be edited manually

**media/:**
- Purpose: Marketplace listing assets and documentation screenshots
- Contains: PNG images referenced in README.md
- Committed: Yes
- Should be updated when UI or documentation changes

**.vscode/:**
- Purpose: VS Code editor configuration for extension development
- Contains: Likely launch.json and settings for debugging
- Not visible in provided output

## Architecture of src/extension.ts

The monolithic file is organized chronologically:

1. **Imports** (lines 1-6): VS Code API, child_process, https
2. **Utilities** (lines 12-19): getNonce() for CSP
3. **Type Definitions** (lines 24-176): All interfaces and types
4. **Constants** (lines 178-184): BRANCH_TEMPLATES
5. **Global State** (lines 186-187): Extension-level variables
6. **Activation** (lines 193-250): activate() and command registration
7. **Status Bar** (lines 257-300): Status bar display logic
8. **Git Utilities** (lines 301-340): Basic git path operations
9. **Health Scoring** (lines 348-407): Score calculation and interpretation
10. **Git Data Collection** (lines 425-1100+): Batch operations for branches, remotes, worktrees, stashes
11. **Data Processing** (lines 1067-1120): Notes and rules persistence
12. **Main Dashboard Flow** (lines 1538-2020): showBranchManager and message handling
13. **Command Implementations** (lines 2027-2200): Individual operations
14. **UI Generation** (lines 2236-3220+): getWebviewContent with embedded HTML/CSS/JS

---

*Structure analysis: 2026-01-25*
