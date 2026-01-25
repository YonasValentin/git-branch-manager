# Testing Patterns

**Analysis Date:** 2026-01-25

## Test Framework

**Runner:**
- `@vscode/test-cli` v0.0.11
- Test executable: `vscode-test`
- Config: `.vscode-test.mjs` (ESM config)

**Assertion Library:**
- Node.js built-in `assert` module
- `assert.ok()` for truthy checks
- `assert.deepStrictEqual()` pattern available (not yet used)

**Run Commands:**
```bash
npm test                    # Run all tests
npm run compile-tests       # Compile TypeScript to out/
npm run watch-tests         # Watch mode with tsc
npm run pretest             # Runs compile-tests, compile, and lint before test
```

**Test Configuration:**
```javascript
// .vscode-test.mjs
import { defineConfig } from '@vscode/test-cli';

export default defineConfig({
  files: 'out/test/**/*.test.js',
});
```

## Test File Organization

**Location:**
- Co-located with source: `src/test/` directory
- Test files in same directory structure as source

**Naming:**
- Pattern: `{module}.test.ts`
- Example: `src/test/extension.test.ts` tests `src/extension.ts`

**Structure:**
```
src/
├── extension.ts          # Main extension source
└── test/
    └── extension.test.ts # Tests for extension.ts
```

## Test Structure

**Suite Organization:**
```typescript
import * as assert from 'assert';
import * as vscode from 'vscode';

suite('Extension Test Suite', () => {
  // Setup (runs once per suite)
  vscode.window.showInformationMessage('Start all tests.');

  test('Test name', () => {
    // Test implementation
  });

  test('Another test', async () => {
    // Async test implementation
  });
});
```

**Patterns:**
- Single top-level `suite()` per file
- Tests grouped under suite with `test()` function
- No beforeEach/afterEach hooks in current codebase (could be added)
- Async tests supported with async/await syntax

## Test Examples in Codebase

**File:** `src/test/extension.test.ts`

**Test 1: Extension Registration**
```typescript
test('Extension should be present', () => {
  assert.ok(vscode.extensions.getExtension('yonasvalentinmougaardkristensen.git-branch-manager-pro'));
});
```
- Verifies extension is registered with correct ID
- Uses VS Code extension API to query registry
- Simple truthy assertion

**Test 2: Command Registration**
```typescript
test('Commands should be registered', async () => {
  const commands = await vscode.commands.getCommands();
  assert.ok(commands.includes('git-branch-manager.cleanup'));
  assert.ok(commands.includes('git-branch-manager.quickCleanup'));
  assert.ok(commands.includes('git-branch-manager.createBranch'));
});
```
- Verifies all extension commands are registered
- Uses async/await to get VS Code command registry
- Checks for presence of critical command IDs

## Mocking

**Framework:**
- No mocking library currently used (sinon, jest-mock not present)
- Could be added as needed for unit testing

**Patterns:**
- Current tests integrate with actual VS Code extension API
- No mocks for git operations (would require shell execution)
- Extension API mocking possible via VS Code test utilities

**What to Mock (if extending):**
- Git command execution (currently integration-tested)
- File system operations
- VS Code dialog interactions (showQuickPick, showInputBox)
- External HTTP calls (GitHub API, sponsor links)

**What NOT to Mock:**
- Extension lifecycle (activate/deactivate)
- Command registration/execution
- Configuration reading (can use test workspace settings)

## Fixtures and Factories

**Test Data:**
- No fixture files in current codebase
- Extension uses live VS Code APIs
- Could create test repos or git operations

**Location:**
- Would be placed in `src/test/fixtures/` if created
- Mock data could live in `src/test/mocks/`

**Suggestion for future:**
```typescript
// Example pattern (not yet implemented)
interface TestBranch {
  name: string;
  merged: boolean;
  age: number;
}

const mockBranches: TestBranch[] = [
  { name: 'feature/auth', merged: false, age: 5 },
  { name: 'bugfix/login', merged: true, age: 30 },
];
```

## Coverage

**Requirements:**
- No coverage targets enforced in `package.json`
- Coverage analysis not configured

**View Coverage (if added):**
```bash
# Would require nyc or c8
npm test -- --coverage
```

**Current State:**
- Minimal test coverage (2 basic integration tests)
- Tests verify extension loads and commands register
- No unit test coverage of business logic (git operations, health scoring)

## Test Types

**Unit Tests:**
- Not currently present
- Would test pure functions:
  - `calculateHealthScore()`
  - `getHealthStatus()`
  - `extractIssueFromBranch()`
  - `evaluateCleanupRule()`
- Scope: single function with isolated inputs
- Approach: mock BranchInfo objects, verify calculations

**Integration Tests:**
```typescript
// Current approach: integration tests with VS Code API
test('Commands should be registered', async () => {
  const commands = await vscode.commands.getCommands();
  assert.ok(commands.includes('git-branch-manager.cleanup'));
});
```
- Scope: extension lifecycle, command registration
- Approach: use actual VS Code extension API
- Executed in VS Code test environment

**E2E Tests:**
- Not implemented
- Framework: Could use `@vscode/test-electron`
- Would test full workflows: show manager, delete branch, show notification
- Requires Git repo setup

## Common Patterns

**Async Testing:**
```typescript
test('Async operation', async () => {
  // Async test automatically waits for Promise
  const result = await someAsyncFunction();
  assert.ok(result);
});
```
- Async functions work natively with `test()`
- No callback wrapper needed

**Error Testing (not yet implemented):**
```typescript
// Pattern for future error tests
test('Should handle missing git repo', async () => {
  const result = await getGitRoot(); // Fails if no git
  assert.strictEqual(result, undefined);
});
```

**VS Code API Testing Pattern:**
```typescript
// Current pattern used
test('Feature requires VS Code API', () => {
  const extension = vscode.extensions.getExtension('id');
  assert.ok(extension); // Verify API works
});
```

## Test Compilation

**Process:**
1. `npm run compile-tests`: TypeScript compiled to `out/test/`
2. TypeScript config uses same settings as source (`tsconfig.json`)
3. Output directory: `out/` (not committed)
4. Test runner looks for `out/test/**/*.test.js`

**Script:**
```bash
npm run compile-tests  # tsc -p . --outDir out
```

---

*Testing analysis: 2026-01-25*
