import { defineConfig, devices } from '@playwright/test';

// UI flows against the mock backend (docs/09-testing.md › Layers). Screens are drawn at 1600×1000.
// GR_PORT: the dev server port of a lane worktree (vite.config.ts), 1420 by default.
const baseURL = `http://localhost:${process.env.GR_PORT ?? '1420'}`;

export default defineConfig({
  testDir: 'tests/e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  reporter: 'line',
  use: {
    baseURL,
    viewport: { width: 1600, height: 1000 },
    trace: 'retain-on-failure',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'], viewport: { width: 1600, height: 1000 } },
    },
  ],
  webServer: {
    command: 'npm run dev:mock',
    url: baseURL,
    reuseExistingServer: !process.env.CI,
    timeout: 60_000,
  },
});
