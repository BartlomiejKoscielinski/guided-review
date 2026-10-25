import { expect, test, type Page } from '@playwright/test';

// F-27.1 against the mock backend: S-11 opened from "Push and create MR" (S-06) and from the end
// of a self-review, with the branch block `source → target` and `N commits · N files · +/−`
// (CreateMR.dc.html: chore/compiled-bindings → develop, 3 commits · 12 files · +84 −40).
// Locators the screen keeps: data-testid="mr-branch", the select "Target branch" in it and
// data-testid="mr-branch-stats".

async function openChanges(page: Page) {
  await page.addInitScript(() => {
    localStorage.setItem('guided-review.mock.changes', JSON.stringify({}));
    localStorage.setItem(
      'guided-review.mock.settings',
      JSON.stringify({ ui: { lastRoute: { screen: 'S-06' } } }),
    );
  });
  await page.goto('/');
}

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

async function expectBranchBlock(page: Page) {
  await expect(page.getByRole('heading', { level: 1, name: 'New merge request' })).toBeVisible();
  const block = page.getByTestId('mr-branch');
  await expect(block).toContainText('chore/compiled-bindings');
  await expect(block.getByRole('combobox', { name: 'Target branch' })).toHaveValue('develop');
  await expect(block.getByTestId('mr-branch-stats')).toHaveText('3 commits · 12 files · +84 −40');
  return block;
}

test('F-27.1 Push and create MR on S-06 opens S-11 with the branch block', async ({ page }) => {
  await openChanges(page);
  await page.getByLabel('Message').fill('Subject');
  await page.getByRole('button', { name: /^Commit · / }).click();
  await page.getByRole('status').getByRole('button', { name: 'Push and create MR' }).click();
  await expectBranchBlock(page);
});

test('F-27.1 Draft MR description at the end of a self-review opens S-11 with the branch block', async ({
  page,
}) => {
  await openSelfReviewSummary(page);
  await page.getByRole('button', { name: 'Draft MR description' }).click();
  await expectBranchBlock(page);
});

test('F-27.1 the target is selectable and the numbers follow it', async ({ page }) => {
  await openChanges(page);
  await page.getByLabel('Message').fill('Subject');
  await page.getByRole('button', { name: /^Commit · / }).click();
  await page.getByRole('status').getByRole('button', { name: 'Push and create MR' }).click();
  const block = await expectBranchBlock(page);
  const target = block.getByRole('combobox', { name: 'Target branch' });
  await expect(target.getByRole('option')).toHaveText(['develop', 'main', 'release/1.8']);
  await target.selectOption('main');
  await expect(block.getByTestId('mr-branch-stats')).toHaveText('7 commits · 21 files · +190 −88');
  await expect(target).toHaveValue('main');
  await target.selectOption('develop');
  await expect(block.getByTestId('mr-branch-stats')).toHaveText('3 commits · 12 files · +84 −40');
});
