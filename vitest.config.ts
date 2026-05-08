import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['src/**/*.unit.test.ts', 'src/**/*.unit.test.tsx'],
    exclude: ['src/test/**'], // VS Code integration tests use mocha
    environment: 'node',
    globals: false,
  },
});
