import { expect, test, type Page } from '@playwright/test';

// F-30.3 against the mock backend: Finish review opens S-05 from S-04's title bar, and `]` on the
// last step does the same (M4 plan, decision 11). A self-review (staged changes) so S-05 is the
// self-review summary, whose own copy shows the screen changed; the router is a memory router
// (docs/04), so the URL says nothing.

/** S-01 › My changes › Staged only › Review before push › S-02 › Start step 1 › Ctrl+D: S-04. */
async function openDetailedSelfReview(page: Page) {
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
  await page.keyboard.press('Control+d');
  await expect(page.getByRole('complementary', { name: 'Guide' })).toBeVisible();
  await expect(page.getByText('Step 1 / 8', { exact: true })).toBeVisible();
}

/** The self-review summary with nothing marked and nothing kept. */
async function expectSummary(page: Page) {
  await expect(page.getByRole('heading', { name: /^summary$/i })).toBeVisible();
  await expect(page.getByText('0 of 8 steps reviewed.')).toBeVisible();
  await expect(page.getByText('Nothing to fix.')).toBeVisible();
  await expect(page.getByRole('complementary', { name: 'Guide' })).toBeHidden();
}

test('F-30.3 Finish review in the S-04 title bar opens S-05', async ({ page }) => {
  await openDetailedSelfReview(page);
  await page.getByTestId('title-bar').getByRole('button', { name: 'Finish review' }).click();
  await expectSummary(page);
  await expect(page.getByText('Step 1 / 8', { exact: true })).toBeHidden();
});

test('F-30.3 ] on the last step of S-04 opens S-05', async ({ page }) => {
  await openDetailedSelfReview(page);
  const rail = page.getByRole('navigation', { name: 'Review plan' });
  await rail.getByRole('button', { name: /Queue tests/ }).click();
  await expect(page.getByText('Step 8 / 8', { exact: true })).toBeVisible();

  await page.keyboard.press(']');
  await expectSummary(page);
  await expect(page.getByText('Step 8 / 8', { exact: true })).toBeHidden();
});
