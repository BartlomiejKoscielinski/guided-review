import { expect, test, type Page } from '@playwright/test';

// F-17.3 against the mock backend: a self-review of staged changes (the mock checkout is on a
// branch 3 commits ahead of develop), Finish review, and the two offers at the end of S-05.

/** S-01 › My changes › Review before push (staged) › S-02 › Start step 1 › Finish review. */
async function openSelfReviewSummary(page: Page) {
  await page.goto('/');
  await expect(page.getByTestId('title-bar')).toBeVisible();
  const mine = page.getByRole('region', { name: 'My changes' });
  await mine.getByRole('radio', { name: /Staged only/ }).check();
  await mine.getByRole('button', { name: 'Review before push' }).click();
  const plan = page.getByRole('main', { name: 'Review plan' });
  await expect(plan.getByRole('heading', { name: 'Plan · 8 steps' })).toBeVisible({
    timeout: 10000,
  });
  await plan.getByRole('button', { name: /Start step 1/ }).click();
  await expect(page.getByText('Step 1 of 8')).toBeVisible();
  await page.getByTestId('title-bar').getByRole('button', { name: 'Finish review' }).click();
  await expect(page.getByRole('heading', { name: /^summary$/i })).toBeVisible();
}

test('F-17.3 the end of a self-review offers Draft MR description and Browse and commit', async ({
  page,
}) => {
  await openSelfReviewSummary(page);
  await expect(page.getByRole('button', { name: 'Draft MR description' })).toBeEnabled();
  await expect(page.getByRole('button', { name: 'Browse and commit' })).toBeEnabled();
});

test('F-17.3 draft MR description opens S-11', async ({ page }) => {
  await openSelfReviewSummary(page);
  await page.getByRole('button', { name: 'Draft MR description' }).click();
  await expect(page.getByTestId('title-bar').getByText('New merge request')).toBeVisible();
  await expect(page.getByRole('heading', { name: /^summary$/i })).toHaveCount(0);
});

test('F-17.3 Browse and commit opens S-06 in local mode', async ({ page }) => {
  await openSelfReviewSummary(page);
  await page.getByRole('button', { name: 'Browse and commit' }).click();
  await expect(page.getByRole('main', { name: 'Changes' })).toBeVisible();
  await expect(page.getByRole('tree', { name: 'Files' })).toBeVisible();
  await expect(page.getByRole('heading', { name: /^summary$/i })).toHaveCount(0);
});
