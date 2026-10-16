import { expect, test, type Page } from '@playwright/test';
import { openStep1, restartApp } from './stepHelpers';

// Settings › General (S-07, Settings.dc.html `{"section":"general"}`) against the mock backend,
// F-19.1: Start in, Focus layout, Diff colors and Start with Windows save at once, survive a
// restart (a page reload: the mock keeps settings in localStorage as the core keeps them in
// SQLite), recolor the diff and give new sessions their mode and layout.

/** `--diff-add-text` of the two palettes (src/styles/tokens.css). */
const BLUE_ORANGE_ADD = 'rgb(157, 187, 248)';
const GREEN_RED_ADD = 'rgb(147, 227, 160)';

const tile = (page: Page, name: string) =>
  page
    .getByRole('navigation', { name: 'App' })
    .getByRole('button', { name: new RegExp(`^${name}`) });
const group = (page: Page, name: string) => page.getByRole('radiogroup', { name, exact: true });
const radio = (page: Page, groupName: string, name: string) =>
  group(page, groupName).getByRole('radio', { name, exact: true });
const startWithWindows = (page: Page) =>
  page.getByRole('switch', { name: 'Start with Windows', exact: true });
const titleBar = (page: Page) => page.getByTestId('title-bar');

/** Starts the app with nothing saved and opens Settings from the dock. */
async function openSettings(page: Page) {
  await page.goto('/');
  await expect(titleBar(page)).toBeVisible();
  await tile(page, 'Settings').click();
  await expect(page.getByRole('heading', { name: 'General', level: 1 })).toBeVisible();
}

/** S-01 › !482 › S-02 › Start step 1, from any screen. */
async function startReview(page: Page) {
  await tile(page, 'MRs').click();
  const source = page.getByLabel(/Paste a merge request link/);
  await source.fill('!482');
  await expect(page.getByText('Merge request !482', { exact: true })).toBeVisible();
  await source.press('Enter');
  await expect(page.getByRole('heading', { name: 'Plan · 8 steps' })).toBeVisible();
  await page.getByRole('button', { name: /Start step 1/ }).click();
}

/** The mock has written the settings the app shows (its storage is the core's database). */
async function expectSaved(page: Page, expected: Record<string, Record<string, unknown>>) {
  await expect
    .poll(async () =>
      page.evaluate(() => {
        const saved = localStorage.getItem('guided-review.mock.settings');
        return saved ? (JSON.parse(saved) as Record<string, Record<string, unknown>>) : null;
      }),
    )
    .toMatchObject(expected);
}

test('F-19.1 Settings opens on General with its four rows and their defaults', async ({ page }) => {
  await openSettings(page);
  await expect(
    page
      .getByRole('navigation', { name: 'Settings sections' })
      .getByRole('button', { name: 'General', exact: true }),
  ).toHaveAttribute('aria-current', 'page');
  await expect(group(page, 'Start in').getByRole('radio')).toHaveText(['Focus', 'Detailed']);
  await expect(group(page, 'Focus layout').getByRole('radio')).toHaveText(['A', 'B', 'C']);
  await expect(group(page, 'Diff colors').getByRole('radio')).toHaveText([
    'Blue · orange',
    'Green · red',
  ]);
  await expect(radio(page, 'Start in', 'Focus')).toBeChecked();
  await expect(radio(page, 'Focus layout', 'A')).toBeChecked();
  await expect(radio(page, 'Diff colors', 'Blue · orange')).toBeChecked();
  await expect(startWithWindows(page)).toHaveAttribute('aria-checked', 'false');
  await expect(page.getByRole('button', { name: /save/i })).toHaveCount(0);
});

test('F-19.1 changes are saved at once and survive a restart', async ({ page }) => {
  await openSettings(page);
  await radio(page, 'Start in', 'Detailed').click();
  await radio(page, 'Focus layout', 'C').click();
  await radio(page, 'Diff colors', 'Green · red').click();
  await startWithWindows(page).click();
  await expect(startWithWindows(page)).toHaveAttribute('aria-checked', 'true');
  await expectSaved(page, {
    ui: { startIn: 'detailed', focusLayout: 'C', diffColors: 'green-red' },
    os: { startWithWindows: true },
  });

  await page.reload();
  await expect(page.getByRole('heading', { name: 'General', level: 1 })).toBeVisible();
  await expect(radio(page, 'Start in', 'Detailed')).toBeChecked();
  await expect(radio(page, 'Focus layout', 'C')).toBeChecked();
  await expect(radio(page, 'Diff colors', 'Green · red')).toBeChecked();
  await expect(startWithWindows(page)).toHaveAttribute('aria-checked', 'true');
  await expect(page.locator('html')).toHaveAttribute('data-diff', 'green-red');
});

test('F-19.1 Green · red changes the added-line color, also after a restart', async ({ page }) => {
  await openStep1(page);
  const added = page.locator('[data-kind="add"] [data-line-no]').first();
  await expect(added).toHaveCSS('color', BLUE_ORANGE_ADD);

  await tile(page, 'Settings').click();
  await radio(page, 'Diff colors', 'Green · red').click();
  await expect(radio(page, 'Diff colors', 'Green · red')).toBeChecked();
  await tile(page, 'Review').click();
  await expect(page.getByText('Step 1 of 8')).toBeVisible();
  await expect(added).toHaveCSS('color', GREEN_RED_ADD);

  await restartApp(page);
  await expect(page.getByText('Step 1 of 8')).toBeVisible();
  await expect(added).toHaveCSS('color', GREEN_RED_ADD);

  await tile(page, 'Settings').click();
  await radio(page, 'Diff colors', 'Blue · orange').click();
  await tile(page, 'Review').click();
  await expect(page.getByText('Step 1 of 8')).toBeVisible();
  await expect(added).toHaveCSS('color', BLUE_ORANGE_ADD);
});

test('F-19.1 a new session opens in the saved Start in', async ({ page }) => {
  await openSettings(page);
  await radio(page, 'Start in', 'Detailed').click();
  await expect(radio(page, 'Start in', 'Detailed')).toBeChecked();
  await startReview(page);
  await expect(
    titleBar(page)
      .getByRole('radiogroup', { name: 'Mode' })
      .getByRole('radio', { name: 'Detailed' }),
  ).toBeChecked();
  await expect(page.getByRole('complementary', { name: 'Guide' })).toBeVisible();
});

test('F-19.1 a new session opens in the saved Focus layout', async ({ page }) => {
  await openSettings(page);
  await radio(page, 'Focus layout', 'C').click();
  await expect(radio(page, 'Focus layout', 'C')).toBeChecked();
  await startReview(page);
  await expect(page.getByText('Step 1 of 8')).toBeVisible();
  await expect(
    titleBar(page)
      .getByRole('radiogroup', { name: 'Layout', exact: true })
      .getByRole('radio', { name: 'Guide layout (Ctrl+3)' }),
  ).toBeChecked();
});
