import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['src/**/*.unit.test.ts', 'src/**/*.unit.test.tsx'],
    exclude: ['src/test/**'],
    environmentMatchGlobs: [
      ['src/webview/**/*.unit.test.tsx', 'jsdom'],
    ],
    environment: 'node',
    globals: false,
    setupFiles: ['src/webview/internals/testSetup.ts'],
  },
});
