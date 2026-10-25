import { expect, test, type Page } from '@playwright/test';

// F-27.5 against the mock backend: S-11 "Before you create" lists Branch pushed, No conflicts with
// <target> and Self-review done in the region "Before you create" of the aside "Reviewers and
// checks" (listitems with data-state "ok" or "warn"). Scenario of the mock backend under the
// storage key 'guided-review.mock.mrChecks': { pushed?: 'notPushed' | 'ahead', selfReview?: null |
// { reviewed, total, notes }, existingMr?: { iid, title } }. Not pushed turns the first check
// orange with the button "Push now" and disables "Create merge request"; an open MR of the branch
// shows the region "Existing merge request" with the link "!482" (to S-10) and disables Create.

type Scenario = Record<string, unknown>;

/**
 * S-11 with the checks of `scenario`, reached without a push (the end of a self-review: S-01 ›
 * Review before push (staged) › S-02 › Start step 1 › Finish review › Draft MR description), since
 * Push and create MR pushes first.
 */
async function openNewMr(page: Page, scenario: Scenario = {}) {
  await page.addInitScript((value) => {
    localStorage.setItem('guided-review.mock.mrChecks', JSON.stringify(value));
  }, scenario);
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
  await page.getByRole('button', { name: 'Draft MR description' }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'New merge request' })).toBeVisible();
}

const checks = (page: Page) => page.getByRole('region', { name: 'Before you create' });
const create = (page: Page) =>
  page
    .getByRole('complementary', { name: 'Reviewers and checks' })
    .getByRole('button', { name: /^Create (merge request|draft MR)$/ });

test('F-27.5 Push and create MR arrives with the branch pushed: three green checks', async ({
  page,
}) => {
  await page.addInitScript(() => {
    localStorage.setItem('guided-review.mock.changes', JSON.stringify({}));
    localStorage.setItem(
      'guided-review.mock.settings',
      JSON.stringify({ ui: { lastRoute: { screen: 'S-06' } } }),
    );
  });
  await page.goto('/');
  await page.getByLabel('Message').fill('Subject');
  await page.getByRole('button', { name: /^Commit · / }).click();
  await page.getByRole('status').getByRole('button', { name: 'Push and create MR' }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'New merge request' })).toBeVisible();
  const items = checks(page).getByRole('listitem');
  await expect(items).toHaveCount(3);
  await expect(items.nth(0)).toContainText('Branch pushed');
  await expect(items.nth(0)).toContainText('origin/chore/compiled-bindings is up to date');
  await expect(items.nth(1)).toContainText('No conflicts with develop');
  await expect(items.nth(1)).toContainText('checked locally with git merge-tree');
  await expect(items.nth(2)).toContainText('Self-review done');
  await expect(items.nth(2)).toContainText('6 of 6 steps · 0 open notes');
  for (const i of [0, 1, 2]) await expect(items.nth(i)).toHaveAttribute('data-state', 'ok');
  await expect(create(page)).toBeEnabled();
});

test('F-27.5 a branch that is not pushed is orange; Push now pushes it and enables Create', async ({
  page,
}) => {
  await openNewMr(page, { pushed: 'notPushed' });
  const first = checks(page).getByRole('listitem').nth(0);
  await expect(first).toHaveAttribute('data-state', 'warn');
  await expect(first).toContainText('Branch not pushed');
  await expect(create(page)).toBeDisabled();
  await first.getByRole('button', { name: 'Push now' }).click();
  await expect(first).toHaveAttribute('data-state', 'ok');
  await expect(first).toContainText('Branch pushed');
  await expect(first.getByRole('button', { name: 'Push now' })).toHaveCount(0);
  await expect(create(page)).toBeEnabled();
});

test('F-27.5 merging into main conflicts in two files, develop is clean again', async ({
  page,
}) => {
  await openNewMr(page);
  const conflicts = checks(page).getByRole('listitem').nth(1);
  await expect(conflicts).toContainText('No conflicts with develop');
  await page.getByRole('combobox', { name: 'Target branch' }).selectOption('main');
  await expect(conflicts).toHaveAttribute('data-state', 'warn');
  await expect(conflicts).toContainText('Conflicts with main');
  await expect(conflicts).toContainText('2 files: MauiProgram.cs, App.xaml');
  await expect(create(page)).toBeEnabled();
  await page.getByRole('combobox', { name: 'Target branch' }).selectOption('develop');
  await expect(conflicts).toHaveAttribute('data-state', 'ok');
  await expect(conflicts).toContainText('No conflicts with develop');
});

test('F-27.5 no self-review yet is orange and leaves Create enabled', async ({ page }) => {
  await openNewMr(page, { selfReview: null });
  const review = checks(page).getByRole('listitem').nth(2);
  await expect(review).toHaveAttribute('data-state', 'warn');
  await expect(review).toContainText('Self-review not done');
  await expect(review).toContainText('No self-review of this branch yet.');
  await expect(create(page)).toBeEnabled();
});

test('F-27.5 an open MR of the branch shows the banner with a link to it and disables Create', async ({
  page,
}) => {
  await openNewMr(page, { existingMr: { iid: 482, title: 'Enable compiled bindings' } });
  const banner = page.getByRole('region', { name: 'Existing merge request' });
  await expect(banner).toContainText('This branch already has an open merge request.');
  await expect(banner).toContainText('Enable compiled bindings');
  await expect(create(page)).toBeDisabled();
  await expect(banner.getByRole('link', { name: '!482' })).toHaveAttribute(
    'href',
    '/mr/482/author',
  );
});
