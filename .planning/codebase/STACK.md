# Technology Stack

**Analysis Date:** 2026-01-25

## Languages

**Primary:**
- TypeScript 4.9.4 - Core extension logic in `src/extension.ts`

**Secondary:**
- JavaScript (ES2022) - Build configuration in `esbuild.js` and VSCode test configuration

## Runtime

**Environment:**
- Node.js 16.x and above (for development tooling)
- VS Code 1.74.0+ (required engine for extension execution)

**Package Manager:**
- npm 10.x (verified with npm v10.9.3)
- Lockfile: package-lock.json (present)

## Frameworks

**Core:**
- VS Code Extension API (`vscode` module) - Main extension framework and UI integration
- VS Code Test CLI 0.0.11 - Test infrastructure for extension testing

**Build/Dev:**
- esbuild 0.25.3 - Bundling and compilation of TypeScript source to CommonJS
- TypeScript 4.9.4 - Type checking and transpilation to ES2022

## Key Dependencies

**Build & Development:**
- `@typescript-eslint/eslint-plugin` 8.31.1 - TypeScript linting rules
- `@typescript-eslint/parser` 8.31.1 - TypeScript parsing for ESLint
- `eslint` 9.25.1 - Code linting
- `npm-run-all` 4.1.5 - Concurrent script execution for watch mode
- `@vscode/test-electron` 2.5.2 - Test runner for VS Code extensions

**Type Definitions:**
- `@types/vscode` 1.74.0 - VSCode API type definitions
- `@types/mocha` 10.0.10 - Mocha testing framework types
- `@types/node` 16.x - Node.js type definitions

## Configuration

**Environment:**
- No environment variables required for runtime
- GitHub token optional (passed from webview for PR fetching)

**Build:**
- `tsconfig.json` - TypeScript compiler configuration
  - Target: ES2022
  - Module: Node16
  - Strict mode enabled
  - Source maps enabled for development
- `eslint.config.mjs` - ESLint configuration (flat config format)
  - TypeScript-specific naming conventions
  - Curly braces, strict equality, semicolon enforcement

**VSCode Extension:**
- `package.json` contributes section defines:
  - 8 commands (`git-branch-manager.*`)
  - SCM menu and command palette integration
  - Configuration schema with 4 settings
  - Keyboard shortcuts (Cmd/Ctrl+Shift+G variants)
- Activation events: `onStartupFinished` (lazy load on startup)

## Build Process

**Development:**
```bash
npm run compile      # Type check + lint + bundle to dist/
npm run watch        # Parallel watch mode for esbuild and tsc
npm run check-types  # TypeScript type checking only
npm run lint         # ESLint check
```

**Production:**
```bash
npm run package      # Type check + lint + minified bundle
vscode:prepublish    # Pre-publish hook (runs npm run package)
```

**Output:**
- Entry point: `src/extension.ts`
- Bundle target: `dist/extension.js` (CommonJS format)
- External dependency: `vscode` module (bundled by VSCode, not included in dist)
- Production builds are minified, development builds include source maps

## Testing

**Framework:** Mocha (via @vscode/test-cli)

**Test Files:**
- `src/test/extension.test.ts` - Basic extension smoke tests

**Run Commands:**
```bash
npm test             # Run all tests (compiles, lints, runs tests)
npm run compile-tests # Compile test files to out/ directory
```

**Configuration:** `.vscode-test.mjs` defines test file pattern matching

## Platform Requirements

**Development:**
- macOS, Linux, or Windows
- Node.js 16.x or later
- npm 10.x or later
- VS Code 1.74.0 or later for debugging

**Production (Extension Runtime):**
- VS Code 1.74.0 or later (specified in engines.vscode)
- Operating system: Any (Windows, macOS, Linux)
- No external runtime dependencies beyond VS Code

## Deployment

**Package Format:**
- VSIX (Visual Studio Code extension package)
- Built with esbuild and packaged via VSCode CLI

**Distribution:**
- VS Code Marketplace
- Repository: https://github.com/yonasvalentin/git-branch-manager-pro
- Publisher: yonasvalentinmougaardkristensen

**Versioning:**
- Semantic versioning (current: 1.7.2)
- Version managed in `package.json`

---

*Stack analysis: 2026-01-25*
