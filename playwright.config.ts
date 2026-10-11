import { defineConfig, devices } from '@playwright/test';

// UI flows against the mock backend (docs/09-testing.md › Layers). Screens are drawn at 1600×1000.
export default defineConfig({
  testDir: 'tests/e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  reporter: process.env.CI ? 'line' : 'list',
  use: {
    baseURL: 'http://localhost:1420',
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
    url: 'http://localhost:1420',
    reuseExistingServer: !process.env.CI,
    timeout: 60_000,
  },
});
