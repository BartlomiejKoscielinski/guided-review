import { mkdirSync } from 'node:fs';
import { test } from '@playwright/test';

// /design-check captures (docs/09 › Visual): each screen state at 1600×1000 with the mock
// backend, saved as .design-check/impl-<screen>-<state>.png next to docs/design/screens/*.png.
// Screens are added here as they are built; M0 has the shell (title bar, dock, empty content).

interface Shot {
  screen: string;
  state: string;
  /** Route path in the app's memory router, restored through the mock's ui.lastRoute. */
  lastRoute: Record<string, unknown>;
  /** Unfinished sessions the mock reports (session screens need one to be restored). */
  sessions?: Record<string, unknown>[];
}

const DEMO_SESSION = {
  id: 'demo',
  status: 'reviewing',
  mode: 'focus',
  updatedAt: '2026-10-11T09:00:00Z',
  resume: { screen: 'S-03', sessionId: 'demo' },
};

const SHOTS: Shot[] = [
  { screen: 'S01', state: 'start', lastRoute: { screen: 'S-01' } },
  { screen: 'S07', state: 'settings-general', lastRoute: { screen: 'S-07', section: 'general' } },
  {
    screen: 'S03',
    state: 'focus-layout-A',
    lastRoute: { screen: 'S-03', sessionId: 'demo' },
    sessions: [DEMO_SESSION],
  },
];

mkdirSync('.design-check', { recursive: true });

for (const shot of SHOTS) {
  test(`design shot ${shot.screen} ${shot.state}`, async ({ page }) => {
    await page.addInitScript(({ lastRoute, sessions }) => {
      if (sessions) localStorage.setItem('guided-review.mock.sessions', JSON.stringify(sessions));
      localStorage.setItem(
        'guided-review.mock.settings',
        JSON.stringify({
          ui: { startIn: 'focus', focusLayout: 'A', diffColors: 'blue-orange', lastRoute },
        }),
      );
    }, shot);
    await page.goto('/');
    await page.getByTestId('title-bar').waitFor();
    await page.evaluate(() => document.fonts.ready);
    await page.screenshot({ path: `.design-check/impl-${shot.screen}-${shot.state}.png` });
  });
}
