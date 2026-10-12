import { mkdirSync } from 'node:fs';
import { test, type Page } from '@playwright/test';

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
  /** Steps that bring the screen into the mock's state (selection, typed text). */
  prepare?: (page: Page) => Promise<void>;
}

const DEMO_SESSION = {
  id: 'demo',
  status: 'reviewing',
  mode: 'focus',
  updatedAt: '2026-10-11T09:00:00Z',
  resume: { screen: 'S-03', sessionId: 'demo' },
};

/** Changes.dc.html's local state: DeliveryPhotoPage.xaml selected, Deliveries and Scanner open. */
async function changesLocal(page: Page) {
  const tree = page.getByRole('tree', { name: 'Files' });
  await tree.getByRole('button', { name: 'Expand src/App/Views/Deliveries' }).click();
  await tree.getByRole('button', { name: 'DeliveryPhotoPage.xaml' }).click();
  await tree.getByRole('button', { name: 'Expand src/App/Views/Scanner' }).click();
  await page.getByRole('checkbox', { name: 'In commit · lines 22–25' }).waitFor();
  await waitForHighlight(page, 'RowDefinitions');
}

/** The Shiki worker colors the diff asynchronously; the shot waits for a colored token of the file. */
async function waitForHighlight(page: Page, token: string) {
  await page.locator('span[style*="color"]', { hasText: token }).first().waitFor();
}

const SHOTS: Shot[] = [
  { screen: 'S01', state: 'start', lastRoute: { screen: 'S-01' } },
  { screen: 'S07', state: 'settings-general', lastRoute: { screen: 'S-07', section: 'general' } },
  {
    screen: 'S07',
    state: 'settings-claude',
    lastRoute: { screen: 'S-07', section: 'claude' },
    prepare: async (page) => {
      await page.getByText('Claude Code: signed in').waitFor();
    },
  },
  {
    screen: 'S07',
    state: 'settings-gitlab',
    lastRoute: { screen: 'S-07', section: 'gitlab' },
    prepare: async (page) => {
      await page.getByText('mobile/courier-api').waitFor();
    },
  },
  {
    screen: 'S07',
    state: 'settings-integrations',
    lastRoute: { screen: 'S-07', section: 'integrations' },
    prepare: async (page) => {
      await page.getByText('Found 2026.2').waitFor();
    },
  },
  {
    screen: 'S03',
    state: 'focus-layout-A',
    lastRoute: { screen: 'S-03', sessionId: 'demo' },
    sessions: [DEMO_SESSION],
  },
  { screen: 'S06', state: 'changes-local', lastRoute: { screen: 'S-06' }, prepare: changesLocal },
  {
    screen: 'S06',
    state: 'changes-commit',
    lastRoute: { screen: 'S-06', commit: 'a3f9c12b7e4d6f8091a2b3c4d5e6f708192a3b4c' },
    prepare: async (page) => {
      await page
        .getByRole('tree', { name: 'Files' })
        .getByRole('button', { name: 'UploadWorker.cs' })
        .click();
      await page.getByText(/ProcessAsync/).waitFor();
      await waitForHighlight(page, 'IUploadQueue');
    },
  },
  {
    screen: 'S06',
    state: 'changes-committed',
    lastRoute: { screen: 'S-06' },
    prepare: async (page) => {
      await changesLocal(page);
      await page.getByLabel('Message').fill('Enable compiled bindings in app pages');
      await page.getByRole('button', { name: /^Commit · / }).click();
      await page.getByText('Created').waitFor();
    },
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
    if (shot.prepare) await shot.prepare(page);
    await page.evaluate(() => document.fonts.ready);
    await page.screenshot({ path: `.design-check/impl-${shot.screen}-${shot.state}.png` });
  });
}
