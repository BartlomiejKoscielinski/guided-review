import { expect, test, type Page } from '@playwright/test';

// F-20.1: S-08 Pipeline against the mock backend (Pipeline.dc.html, M6 decisions 1 to 4). !482 has
// three pipelines: #18342 (version 3, latest, Passed, 1 allowed failure, Marta K. · 2 h ago ·
// 14 min), #18321 (version 2, Failed, 3 h ago · 9 min) and #18320 (version 2, Canceled, 3 h ago).
//
// Locators the screen keeps (also locked in src/screens/pipeline/PipelineScreen.test.tsx):
// h1 "Pipeline", the tablist "Pipelines for this MR" with role=tab buttons ("#18342" then
// "version 3 · latest"), data-testid pipeline-status / pipeline-allowed / pipeline-meta, and the
// link "Back to review". Not tried in the real app (no /app in autopilot).

const source = (page: Page) => page.getByLabel(/Paste a merge request link/);
const tab = (page: Page, number: string) =>
  page
    .getByRole('tablist', { name: 'Pipelines for this MR' })
    .getByRole('tab', { name: new RegExp(number) });

/** S-01 › !482 › S-02, then the pipeline link of its meta line › S-08. */
async function openPipeline(page: Page) {
  await page.goto('/');
  await expect(page.getByTestId('title-bar')).toBeVisible();
  await source(page).fill('!482');
  await expect(page.getByText('Merge request !482', { exact: true })).toBeVisible();
  await source(page).press('Enter');
  await page.getByRole('link', { name: /pipeline passed/i }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Pipeline' })).toBeAttached();
}

test('F-20.1 tabs switch the pipeline: newest first with "version 3 · latest", then Failed and Canceled', async ({
  page,
}) => {
  await openPipeline(page);

  const tabs = page.getByRole('tablist', { name: 'Pipelines for this MR' }).getByRole('tab');
  await expect(tabs).toHaveCount(3);
  await expect(tabs.nth(0)).toHaveText(/^#18342\s*version 3 · latest/);
  await expect(tabs.nth(1)).toHaveText(/^#18321\s*version 2/);
  await expect(tabs.nth(1)).not.toContainText('latest');
  await expect(tabs.nth(2)).toHaveText(/^#18320\s*version 2/);
  await expect(tabs.nth(2)).not.toContainText('latest');
  await expect(tabs.nth(0)).toHaveAttribute('aria-selected', 'true');

  // The newest pipeline: Passed with its allowed-failure tag and the meta line of the mock.
  const status = page.getByTestId('pipeline-status');
  const meta = page.getByTestId('pipeline-meta');
  await expect(status).toHaveText('Passed');
  await expect(page.getByTestId('pipeline-allowed')).toHaveText('1 allowed failure');
  await expect(meta.getByText('#18342', { exact: true })).toBeVisible();
  await expect(meta.getByText('Merge request pipeline', { exact: true })).toBeVisible();
  await expect(meta.getByText('a3f9c12', { exact: true })).toBeVisible();
  await expect(
    meta.getByText('version 3 · Marta K. · 2 h ago · 14 min', { exact: true }),
  ).toBeVisible();

  // The second tab: Failed, no tag, its own SHA and meta.
  await tab(page, '#18321').click();
  await expect(tab(page, '#18321')).toHaveAttribute('aria-selected', 'true');
  await expect(status).toHaveText('Failed');
  await expect(page.getByTestId('pipeline-allowed')).toHaveCount(0);
  await expect(meta.getByText('#18321', { exact: true })).toBeVisible();
  await expect(meta.getByText('6a02f9e', { exact: true })).toBeVisible();
  await expect(
    meta.getByText('version 2 · Marta K. · 3 h ago · 9 min', { exact: true }),
  ).toBeVisible();

  // The third: Canceled, and only what GitLab reports.
  await tab(page, '#18320').click();
  await expect(status).toHaveText('Canceled');
  await expect(meta.getByText('version 2 · Marta K. · 3 h ago', { exact: true })).toBeVisible();
  await expect(page.getByText(/canceled by a newer push/i)).toHaveCount(0);
});

test('F-20.1 the arrow keys switch the pipeline and the allowed-failure tag follows the pipeline', async ({
  page,
}) => {
  await openPipeline(page);
  await expect(page.getByTestId('pipeline-status')).toHaveText('Passed');

  await tab(page, '#18342').focus();
  await page.keyboard.press('ArrowRight');
  await expect(tab(page, '#18321')).toBeFocused();
  await expect(page.getByTestId('pipeline-status')).toHaveText('Failed');
  await expect(page.getByTestId('pipeline-allowed')).toHaveCount(0);

  await page.keyboard.press('ArrowLeft');
  await expect(tab(page, '#18342')).toBeFocused();
  await expect(page.getByTestId('pipeline-status')).toHaveText('Passed');
  await expect(page.getByTestId('pipeline-allowed')).toHaveText('1 allowed failure');
});

test('F-20.1 the back link of a pipeline opened from the review reads "Back to review" and returns to it', async ({
  page,
}) => {
  await openPipeline(page);

  await page.getByRole('link', { name: 'Back to review' }).click();

  await expect(
    page.getByRole('heading', { level: 1, name: 'Offline queue for delivery photos' }),
  ).toBeVisible();
  await expect(page.getByRole('heading', { level: 1, name: 'Pipeline' })).toHaveCount(0);
});
