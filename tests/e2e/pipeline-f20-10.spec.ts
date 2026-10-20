import { expect, test, type Page } from '@playwright/test';

// F-20.10: the pipeline status links to S-08 from S-01 rows, S-02 meta, S-04 header and the S-10
// title bar (M6 decision 16), against the mock backend. S-04 is locked in InfoHeader.test.tsx.
//
// Locators the screens keep: S-01 region "Merge requests" with a link per row named
// "pipeline <status>" beside the row's open button; S-02 link "pipeline passed"; S-10 title bar
// (data-testid title-bar) link "Pipeline passed"; on S-08 the h1 "Pipeline" and the back links
// "Back to MRs" / "Back to review".

const source = (page: Page) => page.getByLabel(/Paste a merge request link/);
const mrs = (page: Page) => page.getByRole('region', { name: 'Merge requests' });
const pipelineHeading = (page: Page) => page.getByRole('heading', { level: 1, name: 'Pipeline' });

async function start(page: Page) {
  await page.goto('/');
  await expect(page.getByTestId('title-bar')).toBeVisible();
}

test('F-20.10 open S-08 from S-01 and go back to the list', async ({ page }) => {
  await start(page);
  await expect(mrs(page).getByText('Migrate to .NET 10')).toBeVisible();
  await mrs(page).getByRole('link', { name: 'pipeline failed' }).click();
  await expect(pipelineHeading(page)).toBeAttached();
  await page.getByRole('link', { name: 'Back to MRs' }).click();
  await expect(mrs(page).getByText('Migrate to .NET 10')).toBeVisible();
});

test('F-20.10 open S-08 from S-02 and go back to the plan', async ({ page }) => {
  await start(page);
  await source(page).fill('!482');
  await expect(page.getByText('Merge request !482', { exact: true })).toBeVisible();
  await source(page).press('Enter');
  await page.getByRole('link', { name: /pipeline passed/i }).click();
  await expect(pipelineHeading(page)).toBeAttached();
  await page.getByRole('link', { name: 'Back to review' }).click();
  await expect(page.getByRole('link', { name: /pipeline passed/i })).toBeVisible();
});

test('F-20.10 open S-08 from the S-10 title bar and go back', async ({ page }) => {
  await start(page);
  await mrs(page).getByRole('tab', { name: /^Mine/ }).click();
  await mrs(page).getByText('Retry in UploadWorker after network loss').click();
  await expect(page.getByText('You’re the author')).toBeVisible();
  await page.getByTestId('title-bar').getByRole('link', { name: 'Pipeline passed' }).click();
  await expect(pipelineHeading(page)).toBeAttached();
  await page.getByRole('link', { name: 'Back to review' }).click();
  await expect(page.getByText('You’re the author')).toBeVisible();
});
