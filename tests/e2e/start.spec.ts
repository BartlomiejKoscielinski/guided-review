import { expect, test, type Page } from '@playwright/test';

// S-01 against the mock backend: title bar, source input (F-01.2–F-01.5) and the Merge
// requests column (F-02.1–F-02.3). Commits and My changes join in 2f.

const source = (page: Page) => page.getByLabel(/Paste a merge request link/);
const mrs = (page: Page) => page.getByRole('region', { name: 'Merge requests' });

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
