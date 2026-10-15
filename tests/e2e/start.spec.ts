import { expect, test, type Page } from '@playwright/test';

// S-01 against the mock backend: title bar, source input (F-01.2–F-01.5), the Merge requests
// column (F-02.1–F-02.3), Commits and My changes (F-03.1–F-03.4).

const source = (page: Page) => page.getByLabel(/Paste a merge request link/);
const mrs = (page: Page) => page.getByRole('region', { name: 'Merge requests' });
const commits = (page: Page) => page.getByRole('region', { name: 'Commits' });
const mine = (page: Page) => page.getByRole('region', { name: 'My changes' });

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await expect(page.getByTestId('title-bar')).toBeVisible();
});

test('F-01.6 F-30.7 title bar shows the repository switcher and GitLab connected', async ({
  page,
}) => {
  const bar = page.getByTestId('title-bar');
  await expect(bar.getByText('GitLab connected')).toBeVisible();
  await bar.getByRole('button', { name: /^Repository mobile-app/ }).click();
  await page.getByRole('menuitemradio', { name: /courier-api/ }).click();
  await expect(bar.getByRole('button', { name: /^Repository courier-api/ })).toBeVisible();
});

test('F-01.2 F-01.3 a pasted MR link is detected and Enter opens the plan', async ({ page }) => {
  await source(page).fill('https://gitlab.local/mobile/mobile-app/-/merge_requests/482');
  await expect(page.getByText('Merge request !482', { exact: true })).toBeVisible();
  await source(page).press('Enter');
  await expect(page.getByRole('main', { name: 'Review plan' })).toBeVisible({ timeout: 5000 });
});

test('F-01.4 Ctrl+K focuses the input from another screen', async ({ page }) => {
  await page.keyboard.press('Control+,');
  await expect(page.getByRole('main', { name: 'Settings' })).toBeVisible();
  await page.keyboard.press('Control+k');
  await expect(source(page)).toBeFocused();
});

test('F-01.5 unknown input shows the inline error and stays on S-01', async ({ page }) => {
  await source(page).fill('no-such-thing');
  await expect(page.getByRole('alert')).toHaveText(
    'No commit, branch or repository matches “no-such-thing”.',
  );
  await source(page).press('Enter');
  await expect(page.getByRole('main', { name: 'Start' })).toBeVisible();
});

test('F-02.1 F-02.3 tabs with counts; my own MR opens author mode', async ({ page }) => {
  await expect(mrs(page).getByRole('tab')).toHaveText([
    'Waiting for me 3',
    'Mine 1',
    'All open 12',
  ]);
  await mrs(page).getByRole('tab', { name: /^Mine/ }).click();
  await mrs(page).getByText('Retry in UploadWorker after network loss').click();
  await expect(page.getByRole('main', { name: 'Your MR' })).toBeVisible();
});

test('F-02.5 the row of an MR with a cached plan says "plan is ready", once', async ({ page }) => {
  const row = (title: RegExp) => mrs(page).getByRole('button', { name: title });
  const offline = row(/Offline queue for delivery photos/);
  await expect(offline).toContainText('You’re a reviewer · plan is ready');
  const said = ((await offline.textContent()) ?? '').match(/plan is ready/g);
  expect(said).toHaveLength(1);
  // The other rows of Waiting for me have no cached plan (Start.dc.html).
  await expect(row(/Crash when rotating the signature screen/)).not.toContainText('plan is ready');
  await expect(row(/Migrate to \.NET 10/)).toContainText('Large: the plan splits it by layer');
  await expect(row(/Migrate to \.NET 10/)).not.toContainText('plan is ready');
  await expect(mrs(page).getByText(/plan is ready/)).toHaveCount(1);
});

test('F-03.1 F-03.2 F-17.1 search, Shift+click range and Review opens the review plan', async ({
  page,
}) => {
  const column = commits(page);
  await expect(column.getByText('chore/compiled-bindings')).toBeVisible();
  await expect(column.getByRole('option')).toHaveCount(5);
  await column.getByRole('textbox', { name: 'Search commits' }).fill('offline');
  await expect(column.getByRole('option')).toHaveCount(2);
  await column.getByRole('textbox', { name: 'Search commits' }).fill('');
  await expect(column.getByRole('option')).toHaveCount(5);
  await column.getByRole('option').nth(1).click();
  await column
    .getByRole('option')
    .nth(3)
    .click({ modifiers: ['Shift'] });
  await expect(column.getByRole('option', { selected: true })).toHaveCount(3);
  await expect(column.getByRole('button', { name: 'Browse files' })).toBeDisabled();
  await column.getByRole('button', { name: 'Review e07d3f1..9be0d47' }).click();
  await expect(page.getByRole('main', { name: 'Review plan' })).toBeVisible();
});

test('F-03.2 Browse files opens S-06 in commit mode', async ({ page }) => {
  await commits(page).getByRole('option').first().click();
  await commits(page).getByRole('button', { name: 'Browse files' }).click();
  const details = page.getByRole('complementary', { name: 'Commit details' });
  await expect(details.getByText('a3f9c12')).toBeVisible();
});

test('F-17.1 Review of a commit opens the review plan, like a merge request', async ({ page }) => {
  await commits(page).getByRole('option').first().click();
  await commits(page).getByRole('button', { name: 'Review a3f9c12' }).click();
  await expect(page.getByRole('main', { name: 'Review plan' })).toBeVisible({ timeout: 5000 });
  await expect(page).toHaveURL(/\/session\/[^/]+\/plan$/);
});

test('F-03.3 F-03.4 scopes with counts; Review before push opens a self-review', async ({
  page,
}) => {
  const column = mine(page);
  await expect(column.getByRole('radio')).toHaveCount(3);
  await expect(column.getByText('12 files · +41 −9')).toBeVisible();
  await expect(column.getByText(/^Self-review never publishes anything\./)).toBeVisible();
  await column.getByRole('radio', { name: /Staged only/ }).check();
  await column.getByRole('button', { name: 'Review before push' }).click();
  await expect(page.getByRole('main', { name: 'Review plan' })).toBeVisible();
  await page.keyboard.press('Control+k');
  await mine(page).getByRole('button', { name: 'Browse and commit' }).click();
  await expect(page.getByRole('main', { name: 'Changes' })).toBeVisible();
  await expect(page.getByRole('tree', { name: 'Files' })).toBeVisible();
});

test('F-03.4 without a repository My changes offers Pick a repository', async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem('guided-review.mock.changes', JSON.stringify({ noRepo: true }));
  });
  await page.goto('/');
  await expect(mine(page).getByRole('button', { name: 'Pick a repository' })).toBeVisible();
  await expect(commits(page).getByText('Pick a repository first.')).toBeVisible();
});

// F-04.1 "Pick up where you left off": the sessions of Start.dc.html as the core reports them.
const NOW = new Date(2026, 9, 14, 20, 0);

function unfinishedSessions() {
  return [
    {
      id: 'mr-471',
      status: 'reviewing',
      mode: 'focus',
      updatedAt: new Date(2026, 9, 14, 8, 0).toISOString(),
      resume: { screen: 'S-05', sessionId: 'mr-471' },
      source: { kind: 'mr', project: 'mobile/mobile-app', iid: 471 },
      title: 'Signature screen: field validation',
      reviewedSteps: 5,
      totalSteps: 9,
      drafts: 3,
    },
    {
      id: 'self-1',
      status: 'reviewing',
      mode: 'focus',
      // Yesterday 18:40 in the browser's time zone, which is this machine's.
      updatedAt: new Date(2026, 9, 13, 18, 40).toISOString(),
      resume: { screen: 'S-05', sessionId: 'self-1' },
      source: { kind: 'local', scope: { kind: 'uncommitted' } },
      title: 'chore/compiled-bindings',
      reviewedSteps: 2,
      totalSteps: 6,
      drafts: 0,
    },
  ];
}

async function openStartWithSessions(page: Page, sessions: unknown[]) {
  await page.clock.setFixedTime(NOW);
  await page.addInitScript((list) => {
    localStorage.setItem('guided-review.mock.sessions', JSON.stringify(list));
  }, sessions);
  await page.goto('/');
  await expect(page.getByTestId('title-bar')).toBeVisible();
}

const pickUp = (page: Page) => page.getByRole('region', { name: 'Pick up where you left off' });

test('F-04.1 Start lists the unfinished sessions with their progress between the hero and the columns', async ({
  page,
}) => {
  await openStartWithSessions(page, unfinishedSessions());
  const cards = pickUp(page);
  await expect(cards.getByRole('heading', { name: 'Pick up where you left off' })).toBeVisible();
  await expect(cards.getByText('!471', { exact: true })).toBeVisible();
  await expect(cards.getByText('Signature screen: field validation')).toBeVisible();
  await expect(cards.getByText('5 of 9 steps · 3 drafts', { exact: true })).toBeVisible();
  await expect(cards.getByText('local', { exact: true })).toBeVisible();
  await expect(cards.getByText('chore/compiled-bindings')).toBeVisible();
  await expect(
    cards.getByText('Self-review · 2 of 6 steps · saved yesterday 18:40', { exact: true }),
  ).toBeVisible();
  // Newest first, as the core returns them, in reading order: Start.dc.html lays the cards out
  // side by side (auto-fit grid), so a later card is to the right or on a lower row.
  const [a, b] = await Promise.all(
    [cards.getByText('!471', { exact: true }), cards.getByText('local', { exact: true })].map(
      async (tag) => (await tag.boundingBox()) ?? { x: 0, y: 0 },
    ),
  );
  const first = a ?? { x: 0, y: 0 };
  const second = b ?? { x: 0, y: 0 };
  const sameRow = Math.abs(first.y - second.y) < 1;
  expect(sameRow ? first.x < second.x : first.y < second.y).toBe(true);
  // Region 2 of S-01: below the hero input, above the three columns.
  const heroBottom = ((await source(page).boundingBox())?.y ?? 0) + 1;
  const cardsTop = (await cards.boundingBox())?.y ?? 0;
  const columnsTop = (await mrs(page).boundingBox())?.y ?? 0;
  expect(cardsTop).toBeGreaterThan(heroBottom);
  expect(cardsTop).toBeLessThan(columnsTop);
});

test('F-04.1 Continue opens the session of its card', async ({ page }) => {
  await openStartWithSessions(page, unfinishedSessions());
  await expect(pickUp(page).getByText('Continue', { exact: true })).toHaveCount(2);
  await expect(pickUp(page).getByText('Only new changes')).toHaveCount(0);
  await pickUp(page).getByText('Continue', { exact: true }).nth(1).click();
  await expect(page.getByRole('main', { name: 'Summary' })).toBeVisible();
  await expect(
    page.getByRole('navigation', { name: 'App' }).getByRole('button', { name: /^Review/ }),
  ).toHaveAttribute('aria-current', 'page');
});

test('F-04.1 without unfinished sessions Start has no "Pick up where you left off" section', async ({
  page,
}) => {
  await openStartWithSessions(page, []);
  await expect(mrs(page).getByRole('tab')).toHaveCount(3);
  await expect(page.getByRole('region', { name: 'Pick up where you left off' })).toHaveCount(0);
  await expect(page.getByText('Pick up where you left off')).toHaveCount(0);
});
