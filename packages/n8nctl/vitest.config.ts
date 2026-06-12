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
      thresholds: {
        statements: 60,
        branches: 70,
        functions: 65,
        lines: 60,
      },
    },
  },
});
