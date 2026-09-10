import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './e2e',
  testMatch: '**/*.spec.ts',
  fullyParallel: false,
  retries: process.env.CI ? 2 : 0,
  workers: 1,
  // 'json' captures per-test durations for diagnosing full-suite wall-clock
  // time and flaky failures (see
  // specs/backlog/test-timing-instrumentation-and-reliability.md). Written
  // to the repo-root test-timing/ dir (gitignored), one timestamped file per
  // run so repeated runs can be compared rather than overwritten.
  reporter: [['list'], ['json', { outputFile: `../../test-timing/playwright-${Date.now()}.json` }]],
  use: {
    baseURL: 'http://localhost:5173',
    headless: true,
    viewport: { width: 1280, height: 900 },
    actionTimeout: 10_000,
    navigationTimeout: 30_000,
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
  webServer: {
    command: 'pnpm dev',
    url: 'http://localhost:5173',
    reuseExistingServer: !process.env.CI,
    timeout: 60_000,
  },
});
