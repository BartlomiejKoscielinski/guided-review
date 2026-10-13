import { expect, test, type Page } from '@playwright/test';

// S-02 against the mock backend: Preparing with stages and Cancel (F-05.6), the M2 prepared
// header (M2 decision 2) and Browse files instead → S-06 MR browse with Open in Rider (F-24.1).

const TITLE = 'Offline queue for delivery photos';
const source = (page: Page) => page.getByLabel(/Paste a merge request link/);
const stages = (page: Page) => page.getByRole('region', { name: 'Preparation' });

async function openMr482(page: Page) {
  await source(page).fill('!482');
  await expect(page.getByText('Merge request !482', { exact: true })).toBeVisible();
  await source(page).press('Enter');
}

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await expect(page.getByTestId('title-bar')).toBeVisible();
});

test('F-05.6 Preparing shows the MR title and the stages, then the plan header', async ({
  page,
}) => {
  await openMr482(page);
  await expect(page.getByRole('heading', { level: 1, name: TITLE })).toBeVisible();
  await expect(stages(page).getByText('Fetching !482')).toBeVisible();
  await expect(stages(page).getByText('Creating worktree')).toBeVisible();
  await expect(stages(page).getByText('Computing diff · 16 files')).toBeVisible();
  await expect(page.getByTestId('title-bar').getByText('!482')).toBeVisible();

  await expect(page.getByRole('button', { name: 'Browse files instead' })).toBeVisible();
  await expect(page.getByText('feature/offline-upload → develop')).toBeVisible();
  await expect(page.getByText('pipeline passed')).toBeVisible();
  await expect(page.getByRole('heading', { level: 1, name: TITLE })).toBeVisible();
});

test('F-05.6 Cancel stops the preparation and goes back to S-01', async ({ page }) => {
  await openMr482(page);
  await expect(stages(page).getByText('Fetching !482')).toBeVisible();
  await page.getByRole('button', { name: 'Cancel' }).click();
  await expect(source(page)).toBeVisible();
  // The cancelled preparation never opens the plan.
  await page.waitForTimeout(2000);
  await expect(source(page)).toBeVisible();
  await expect(page.getByRole('button', { name: 'Browse files instead' })).toHaveCount(0);
});

test('F-24.1 Browse files instead opens the MR read-only with Open in Rider', async ({ page }) => {
  await openMr482(page);
  await page.getByRole('button', { name: 'Browse files instead' }).click();
  const details = page.getByRole('complementary', { name: 'Merge request details' });
  await expect(details.getByText(TITLE)).toBeVisible();
  await expect(page.getByRole('radio', { name: 'MR !482' })).toHaveAttribute(
    'aria-checked',
    'true',
  );
  await expect(page.getByRole('checkbox')).toHaveCount(0);
  await page.getByRole('button', { name: /UploadWorker\.cs/ }).click();
  await expect(page.getByText('UploadWorker: line 1', { exact: false }).first()).toBeVisible();
  await page.getByRole('button', { name: 'Open in Rider' }).click();
  await expect(page.getByRole('alert')).toHaveCount(0);
  await page.getByRole('radio', { name: 'Local changes' }).click();
  await expect(page.getByRole('complementary', { name: 'Merge request details' })).toHaveCount(0);
});

// S-02 plan on the mock (F-06.4, F-06.5, F-06.11): the toggle, a keyboard drag, Start step 1.

const stepRows = (page: Page) => page.locator('li[data-step]');

async function openPlan(page: Page) {
  await openMr482(page);
  await expect(page.getByRole('heading', { name: 'Plan · 8 steps' })).toBeVisible();
}

test('F-06.4 the strategy toggle reorders the steps without a new plan', async ({ page }) => {
  await openPlan(page);
  await expect(stepRows(page).first()).toContainText('Queue contract');
  await page.getByRole('radio', { name: 'Tests first' }).click();
  await expect(stepRows(page).first()).toContainText('Queue tests');
  await expect(
    page.getByText('Tests first: read them as the spec, then the implementation.'),
  ).toBeVisible();
  await page.getByRole('radio', { name: 'File order' }).click();
  await expect(stepRows(page).first()).toContainText('DI registration and worker start');
  await expect(page.getByText('Claude is planning · usually under a minute')).toHaveCount(0);
});

test('F-06.5 a keyboard drag moves a step and clears the strategy', async ({ page }) => {
  await openPlan(page);
  const handle = page.getByRole('button', { name: 'Move step: Queue contract' });
  await handle.focus();
  await page.keyboard.press('Space');
  // dnd-kit measures the rows when the drag starts; move only once the row is lifted and moved.
  const lifted = page.locator('li[data-dragging]');
  await expect(lifted).toHaveCount(1);
  await page.keyboard.press('ArrowDown');
  await expect(lifted).toHaveAttribute('style', /translate3d\(0px, [1-9]/);
  await page.keyboard.press('Space');
  await expect(stepRows(page).nth(0)).toContainText('SqliteUploadQueue');
  await expect(stepRows(page).nth(1)).toContainText('Queue contract');
  await expect(page.getByText('Your order. Pick a strategy to reset it.')).toBeVisible();
  await expect(page.getByRole('radio', { name: 'Contract to UI' })).toHaveAttribute(
    'aria-checked',
    'false',
  );
  // Picking a strategy clears the dragged order.
  await page.getByRole('radio', { name: 'Contract to UI' }).click();
  await expect(stepRows(page).nth(0)).toContainText('Queue contract');
});

test('F-06.11 Enter starts step 1', async ({ page }) => {
  await openPlan(page);
  await page.getByRole('heading', { level: 1, name: TITLE }).click();
  await page.keyboard.press('Enter');
  // The app routes in memory; S-03's title bar has Finish review.
  await expect(page.getByRole('button', { name: 'Finish review' })).toBeVisible();
});
