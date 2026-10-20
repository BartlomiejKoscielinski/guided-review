import { expect, test, type Locator, type Page } from '@playwright/test';
import { openStep } from './stepHelpers';

// F-25.4 against the mock backend: on a self-review the proposal card (F-25.3) under a note acts.
// Accept writes the change (the mock answers at once) and the card becomes "Applied to your
// working copy." with Browse and commit (S-06 local mode, M7 decision 2); Fix with Claude is
// available again. Discard drops the proposal and closes the card. The stale-file refusal ("The
// file changed while Claude worked. Run it again.") needs a file edited behind the app's back:
// it is covered by the core tests and the component tests, not here. Not tried in the real app
// (autopilot cannot run it): the write into a real working copy is the core tests' job.

const PENDING = 'PendingCount won’t refresh after upload';
const NAME = 'DeliveryPhotoViewModel.cs';
const APPLIED = 'Applied to your working copy.';

/** S-01 › My changes › Review before push (staged) › S-02 › Start step 1 › step 4 (ViewModel). */
async function openSelfReviewStep4(page: Page) {
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
  await openStep(page, /ViewModel/, 4);
  await expect(page.getByText('Fields and constructor: 3 new dependencies')).toBeVisible();
}

const note = (page: Page) => page.getByRole('article', { name: `Claude note: ${PENDING}` });

/** The fix card around its title: the nearest ancestor that holds the Accept button. */
const cardOf = (page: Page): Locator =>
  page
    .getByText('Proposed change', { exact: true })
    .locator('xpath=ancestor::*[.//button[normalize-space()="Accept"]][1]');

async function proposalOnScreen(page: Page) {
  await openSelfReviewStep4(page);
  await note(page).getByRole('button', { name: 'More' }).click();
  await page.getByRole('menuitem', { name: 'Fix with Claude' }).click();
  await expect(page.getByText('Proposed change', { exact: true })).toBeVisible({ timeout: 10000 });
  await expect(cardOf(page).getByText(`Edited 1 file: ${NAME}`, { exact: true })).toBeVisible();
}

test('F-25.4 accept and discard: Accept turns the proposal into "Applied to your working copy." with Browse and commit', async ({
  page,
}) => {
  await proposalOnScreen(page);
  await cardOf(page).getByRole('button', { name: 'Accept' }).click();

  await expect(page.getByText(APPLIED)).toBeVisible();
  await expect(page.getByText('Proposed change', { exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Accept' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Discard' })).toHaveCount(0);
  await expect(page.getByRole('alert')).toHaveCount(0);
  // Under the note it belongs to.
  const noteBox = await note(page).boundingBox();
  const appliedBox = await page.getByText(APPLIED).boundingBox();
  expect(noteBox && appliedBox && appliedBox.y >= noteBox.y + noteBox.height - 1).toBe(true);
  // The next fix may start.
  await note(page).getByRole('button', { name: 'More' }).click();
  await expect(page.getByRole('menuitem', { name: 'Fix with Claude' })).toBeEnabled();
});

test('F-25.4 Browse and commit on the applied line opens S-06 in local mode', async ({ page }) => {
  await proposalOnScreen(page);
  await cardOf(page).getByRole('button', { name: 'Accept' }).click();
  await expect(page.getByText(APPLIED)).toBeVisible();
  await page.getByRole('button', { name: 'Browse and commit' }).click();
  // S-06 in local mode: the Source switch with Local changes selected, and the Commit panel.
  const source = page.getByRole('radiogroup', { name: 'Source' });
  await expect(source.getByRole('radio', { name: 'Local changes' })).toHaveAttribute(
    'aria-checked',
    'true',
  );
  await expect(page.getByRole('heading', { name: 'Commit' })).toBeVisible();
});

test('F-25.4 Discard drops the proposal: the card goes and Fix with Claude is there again', async ({
  page,
}) => {
  await proposalOnScreen(page);
  await cardOf(page).getByRole('button', { name: 'Discard' }).click();

  await expect(page.getByText('Proposed change', { exact: true })).toHaveCount(0);
  await expect(page.getByText(APPLIED)).toHaveCount(0);
  await expect(page.getByRole('alert')).toHaveCount(0);
  await note(page).getByRole('button', { name: 'More' }).click();
  await expect(page.getByRole('menuitem', { name: 'Fix with Claude' })).toBeEnabled();
});
