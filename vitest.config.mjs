import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // Unit tests written in Vitest API
    include: ['tests/unit/*.test.mjs', 'tests/vitest/**/*.test.mjs'],
    fileParallelism: false,
    testTimeout: 60_000,
    hookTimeout: 60_000,
    // Coverage config (run with --coverage)
    coverage: {
      provider: 'v8',
      include: ['server/**/*.js'],
      exclude: ['server/migration/**', 'server/db/schema.js'],
      reporter: ['text', 'html'],
      reportsDirectory: './coverage',
    },
  },
});
