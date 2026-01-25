# Coding Conventions

**Analysis Date:** 2026-01-25

## Naming Patterns

**Files:**
- Entry point: `src/extension.ts` (singular, lowercase with extension identifier)
- Test files: `src/test/extension.test.ts` (matches source name with `.test.ts` suffix)
- Configuration: camelCase for settings (e.g., `gitBranchManager.daysUntilStale`)

**Functions:**
- camelCase with descriptive verbs: `getBranchInfo()`, `updateStatusBar()`, `createStash()`
- Async functions explicitly marked with `async` keyword
- Private/internal functions use same camelCase (no leading underscore convention)
- Command handlers typically follow verb-noun pattern: `quickCleanup()`, `createBranch()`

**Variables:**
- camelCase for all local and module-level variables
- Constants use camelCase: `BRANCH_TEMPLATES`, `exec`
- Configuration values retrieved with `config.get<Type>('keyName')`
- Maps and collections use singular/plural appropriately: `branchList`, `branchDataMap`, `protectedSet`

**Types/Interfaces:**
- PascalCase for all interface names: `BranchInfo`, `PRStatus`, `RemoteBranchInfo`, `WorktreeInfo`, `StashInfo`
- Interfaces describe data structures with detailed optional fields for extensibility
- Union types for status values: `'healthy' | 'warning' | 'critical' | 'danger'`
- File status uses single-letter codes in union: `'A' | 'M' | 'D' | 'R'`

## Code Style

**Formatting:**
- No explicit formatter configured (eslint used for linting)
- Consistent semicolon usage enforced by eslint (`semi: "warn"`)
- Curly braces required for all blocks (`curly: "warn"`)
- Strict equality enforced (`eqeqeq: "warn"`)

**Linting:**
- ESLint with `@typescript-eslint` plugin
- Config: `eslint.config.mjs` (ESLint v9 flat config format)
- Import naming: camelCase or PascalCase required
- Rules are warnings, not errors (allows flexibility during development)

**TypeScript:**
- Strict mode enabled in `tsconfig.json`
- Target: ES2022
- Module: Node16
- Source maps enabled for debugging
- Allows promisification: `const exec = promisify(cp.exec);`

## Import Organization

**Order:**
1. External modules (vscode, child_process, https, util)
2. Local type/interface definitions
3. Promisified functions

**Pattern:**
```typescript
import * as vscode from 'vscode';
import * as cp from 'child_process';
import * as https from 'https';
import { promisify } from 'util';

const exec = promisify(cp.exec);
```

**Path Aliases:**
- Not used; all imports are absolute paths or Node modules
- Extension is single-file focused (`src/extension.ts`)

**Namespace imports:**
- Used for VS Code API: `import * as vscode`
- Used for standard library modules: `import * as cp`, `import * as https`
- Destructured imports for specific utilities: `import { promisify }`

## Error Handling

**Patterns:**
- Try-catch blocks wrap potentially failing async operations
- Catch blocks either:
  - Silently handle with empty catch: `catch {}`
  - Log to console with context: `console.error('operationName failed:', err);`
  - Show user-facing messages via `vscode.window.showErrorMessage()`
- No custom error classes; relies on JavaScript Error types
- Errors from git commands logged with operation context

**Console Usage:**
- `console.error()` for failures: logs operation name and error object
- `console.warn()` for degraded operations: e.g., fallback when git for-each-ref unavailable
- No `console.log()` for production output (messages go through VS Code API)

**User Notifications:**
- `vscode.window.showErrorMessage()` for user-facing errors
- `vscode.window.showInformationMessage()` for success/status messages
- `vscode.window.showWarningMessage()` for confirmations before destructive operations
- Input dialogs: `vscode.window.showInputBox()` with title and placeholder options
- Quick pick: `vscode.window.showQuickPick()` with item arrays

## Logging

**Framework:**
- Console API for internal debugging
- VS Code user-facing notifications via `vscode.window` API

**Patterns:**
- Git operation failures log to console with context
- Failed branch processing: `console.error(\`Failed to process branch ${branch}:\`, err);`
- Fallback scenarios: `console.warn('for-each-ref unavailable, using per-branch queries:', err);`
- User-facing success: notification messages only, no console output
- Status updates via status bar without logging

**Best Practices:**
- Only log when an operation fails or degrades
- Include operation name and branch/item being processed
- User success messages via notifications, not console
- Technical diagnostic info (git command failures) to console only

## Comments

**When to Comment:**
- JSDoc-style comments on exported functions and interfaces (required for public API)
- Complex business logic (e.g., health score calculation)
- Non-obvious git command flags or regex patterns
- Intent behind workarounds or fallback logic

**JSDoc/TSDoc:**
Pattern throughout codebase:
```typescript
/**
 * Brief description of function.
 * @param paramName - Description
 * @returns Return value description
 */
function exampleFunction(paramName: string): ReturnType {
```

**Examples in codebase:**
- `getNonce()`: documents security purpose
- `getBranchInfo()`: explains async git batch queries
- `calculateHealthScore()`: describes scoring algorithm
- Interface definitions documented above each type
- Command handlers have minimal docs (obvious from name)

**Avoid:**
- Inline comments for obvious code
- Comments that duplicate the code
- Outdated/stale comments (codebase maintains clean docs)

## Function Design

**Size:**
- Functions typically 20-80 lines
- Async git operations: 50-150 lines (include batch processing and error handling)
- Main handler functions: up to 200 lines (CLI-like complexity)
- Complex filtering/mapping operations extracted into separate functions

**Parameters:**
- No destructuring; parameters passed as individual arguments
- Git working directory (`cwd: string`) passed explicitly to most functions
- Optional parameters typed with `?: Type` for extensions
- VS Code context passed as single parameter where needed

**Return Values:**
- Async functions return Promises: `Promise<T>`
- Arrays typed explicitly: `Promise<BranchInfo[]>`
- Nullable returns: `Promise<string | undefined>`
- Maps for grouped data: `Map<string, BranchNote>`
- Some operations return boolean for success/failure: `Promise<boolean>`

**Async/Await:**
- All git operations are async (wraps `child_process.exec`)
- Promise.all used for parallel batch operations
- Await used at call sites; no promise chaining
- Fallback logic using try-catch, not .catch()

## Module Design

**Exports:**
- Two exports only: `activate()` and `deactivate()` (VS Code extension lifecycle)
- All other functions are module-private
- Public API defined by VS Code `package.json` contributes section

**Structure:**
- Single-file architecture: everything in `src/extension.ts`
- Global state: `globalStatusBarItem`, `gitHubSession` defined at module level
- Initialization in `activate()`: registers commands, creates status bar, sets up intervals
- Cleanup in `deactivate()`: empty (VS Code handles cleanup)

**Dependency Injection:**
- VS Code context passed to functions that need persistent state
- Configuration accessed via `vscode.workspace.getConfiguration('gitBranchManager')`
- No dependency injection framework; explicit parameter passing

---

*Convention analysis: 2026-01-25*
