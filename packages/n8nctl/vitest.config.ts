import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: false,
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts'],
      // index files are pure commander wiring; types/ is type-only (no runtime)
      exclude: ['src/index.ts', 'src/commands/**/index.ts', 'src/types/**'],
      // Ratcheted to just under actuals (79/75/88/79 @ 1.5.0) so a regression
      // fails CI while normal churn doesn't. Raise as coverage grows.
      thresholds: {
        statements: 75,
        branches: 70,
        functions: 80,
        lines: 75,
      },
    },
  },
});
