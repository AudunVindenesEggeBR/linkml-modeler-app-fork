import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['src/**/*.test.ts'],
    // See packages/core/vitest.config.ts for why this exists.
    reporters: ['default', ['json', { outputFile: `../../test-timing/vitest-electron-${Date.now()}.json` }]],
  },
});
