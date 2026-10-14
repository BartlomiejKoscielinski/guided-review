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

test('F-03.1 F-03.2 search, Shift+click range and Review opens the step review', async ({
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
  await expect(page.getByRole('main', { name: 'Step review' })).toBeVisible();
});

test('F-03.2 Browse files opens S-06 in commit mode', async ({ page }) => {
  await commits(page).getByRole('option').first().click();
  await commits(page).getByRole('button', { name: 'Browse files' }).click();
  const details = page.getByRole('complementary', { name: 'Commit details' });
  await expect(details.getByText('a3f9c12')).toBeVisible();
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
