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
  /** The mock's S-02/S-03 variations (`MOCK_REVIEW_KEY`, e.g. `planFails`). */
  review?: Record<string, unknown>;
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

/** Start.dc.html's state: the !482 link typed and detected, the Waiting for me list loaded. */
async function startMock(page: Page) {
  await page
    .getByLabel(/Paste a merge request link/)
    .fill('https://gitlab.local/mobile/mobile-app/-/merge_requests/482');
  await page.getByText('Merge request !482').waitFor();
  await page.getByText('Large: the plan splits it by layer').waitFor();
  await page.getByLabel(/Paste a merge request link/).blur();
}

/** Opens !482 from S-01 (the mock keeps MR sessions in memory, so S-02 can't be restored). */
async function openMr482(page: Page) {
  const input = page.getByLabel(/Paste a merge request link/);
  await input.fill('https://gitlab.local/mobile/mobile-app/-/merge_requests/482');
  await page.getByText('Merge request !482').waitFor();
  await input.press('Enter');
}

const SHOTS: Shot[] = [
  { screen: 'S01', state: 'start', lastRoute: { screen: 'S-01' }, prepare: startMock },
  {
    screen: 'S02',
    state: 'preparing',
    lastRoute: { screen: 'S-01' },
    prepare: async (page) => {
      // The last stage shows for only MOCK_STAGE_MS: a paused clock keeps it on screen.
      await page.clock.install();
      const input = page.getByLabel(/Paste a merge request link/);
      await input.fill('https://gitlab.local/mobile/mobile-app/-/merge_requests/482');
      await page.getByText('Merge request !482').waitFor();
      await page.clock.pauseAt(Date.now() + 1000);
      await input.press('Enter');
      // 02 › S-02 Preparing: two stages done (green), the diff stage current (yellow).
      const line = page.getByText('Computing diff · 16 files');
      while (!(await line.isVisible())) await page.clock.runFor(50);
    },
  },
  {
    screen: 'S02',
    state: 'planning',
    lastRoute: { screen: 'S-01' },
    prepare: async (page) => {
      await openMr482(page);
      // 02 › S-02 Planning: the header at once, the intent placeholder, no list or aside yet.
      await page.getByText('Claude is planning · usually under a minute').waitFor();
      await page.getByText('pipeline passed').waitFor();
    },
  },
  {
    screen: 'S02',
    state: 'plan',
    lastRoute: { screen: 'S-01' },
    prepare: async (page) => {
      await openMr482(page);
      await page.getByRole('heading', { name: 'Plan · 8 steps' }).waitFor();
      // S02-plan.png: the first step's analysis (MOCK_STEP_MS) is still running.
      await page.getByText('Plan ready · Claude is analyzing step 1').waitFor();
    },
  },
  ...(['tests', 'files'] as const).map((strategy): Shot => ({
    screen: 'S02',
    state: `plan-${strategy}`,
    lastRoute: { screen: 'S-01' },
    prepare: async (page) => {
      await openMr482(page);
      await page.getByRole('heading', { name: 'Plan · 8 steps' }).waitFor();
      const name = strategy === 'tests' ? 'Tests first' : 'File order';
      await page.getByRole('radio', { name }).click();
      await page.getByRole('radio', { name, checked: true }).waitFor();
      await page.getByText('Plan ready', { exact: true }).waitFor();
    },
  })),
  {
    screen: 'S02',
    state: 'failed',
    lastRoute: { screen: 'S-01' },
    review: { planFails: true },
    prepare: async (page) => {
      await openMr482(page);
      await page.getByText("Claude isn't available. You can review in file order.").waitFor();
    },
  },
  {
    screen: 'S02',
    state: 'cached',
    lastRoute: { screen: 'S-01' },
    review: { planCached: true },
    prepare: async (page) => {
      await openMr482(page);
      await page.getByRole('heading', { name: 'Plan · 8 steps' }).waitFor();
      await page.getByText(/^Plan from cache · /).waitFor();
    },
  },
  {
    screen: 'S01',
    state: 'start-mine-tab',
    lastRoute: { screen: 'S-01' },
    prepare: async (page) => {
      await startMock(page);
      await page.getByRole('tab', { name: /^Mine/ }).click();
      await page.getByText('2 unresolved threads from reviewers').waitFor();
    },
  },
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
    await page.addInitScript(({ lastRoute, sessions, review }) => {
      if (sessions) localStorage.setItem('guided-review.mock.sessions', JSON.stringify(sessions));
      if (review) localStorage.setItem('guided-review.mock.review', JSON.stringify(review));
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
