import { expect, test, type Locator, type Page } from '@playwright/test';
import { openStep } from './stepHelpers';

// F-25.3 against the mock backend: on a self-review (staged changes) More › Fix with Claude runs
// the fix of the note ("Claude is editing <name>…" with Cancel, the mock answers after about
// 1.3 s) and the proposal opens under the note card as "Proposed change · Edited 1 file: <name>"
// with the diff, a sentence, a green Accept and Discard. The same on S-05 for a note kept to fix.
// Accept and Discard act in F-25.4, not tried here. Not tried in the real app (autopilot cannot
// run it): the card's look against S10-author-fix-proposed.png is the design-check's job.

const PENDING = 'PendingCount won’t refresh after upload';
const NAME = 'DeliveryPhotoViewModel.cs';
const BUSY = `Claude is editing ${NAME}…`;
/** --green of src/styles/tokens.css as the browser reports it. */
const GREEN = 'rgb(99, 214, 118)';

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

async function chooseFix(page: Page) {
  await note(page).getByRole('button', { name: 'More' }).click();
  await page.getByRole('menuitem', { name: 'Fix with Claude' }).click();
}

/** The fix card around its title: the nearest ancestor that holds the Accept button. */
const cardOf = (page: Page): Locator =>
  page
    .getByText('Proposed change', { exact: true })
    .locator('xpath=ancestor::*[.//button[normalize-space()="Accept"]][1]');

test('F-25.3 Fix with Claude on a self-review note: busy line, then the proposed change with Accept and Discard', async ({
  page,
}) => {
  await openSelfReviewStep4(page);
  await chooseFix(page);
  await expect(page.getByText(BUSY)).toBeVisible();
  await expect(page.getByRole('button', { name: 'Cancel', exact: true })).toBeVisible();

  await expect(page.getByText('Proposed change', { exact: true })).toBeVisible({ timeout: 10000 });
  await expect(page.getByText(BUSY)).toHaveCount(0);
  const card = cardOf(page);
  await expect(card.getByText(`Edited 1 file: ${NAME}`, { exact: true })).toBeVisible();
  // The diff of that file: lines taken out and lines added.
  await expect(card.locator('[data-kind="del"]').first()).toBeVisible();
  await expect(card.locator('[data-kind="add"]').first()).toBeVisible();
  // One sentence of Claude's, between the diff and the buttons.
  await expect(card.getByText(/^[^.!?]+[.!?]$/).first()).toBeVisible();
  const accept = card.getByRole('button', { name: 'Accept' });
  await expect(accept).toBeVisible();
  await expect(card.getByRole('button', { name: 'Discard' })).toBeVisible();
  // Accept is the green fill.
  await expect(accept).toHaveCSS('background-color', GREEN);
  // Under the note card it belongs to.
  const noteBox = await note(page).boundingBox();
  const cardBox = await card.boundingBox();
  expect(noteBox && cardBox && cardBox.y >= noteBox.y + noteBox.height - 1).toBe(true);
});

test('F-25.3 Cancel on the busy line stops the run: no card, no error, Fix with Claude again', async ({
  page,
}) => {
  // The page runs on Playwright's clock, so the mock's 1.3 s can be run through at once.
  await page.clock.install();
  await openSelfReviewStep4(page);
  await chooseFix(page);
  await expect(page.getByText(BUSY)).toBeVisible();
  await page.getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(page.getByText(BUSY)).toHaveCount(0);
  await expect(page.getByRole('alert')).toHaveCount(0);
  // The run's answer never shows.
  await page.clock.runFor(3000);
  await expect(page.getByText('Proposed change', { exact: true })).toHaveCount(0);
  await note(page).getByRole('button', { name: 'More' }).click();
  await expect(page.getByRole('menuitem', { name: 'Fix with Claude' })).toBeEnabled();
});

test('F-25.3 one fix at a time: while the proposal waits, Fix with Claude is disabled with its tooltip', async ({
  page,
}) => {
  await openSelfReviewStep4(page);
  await chooseFix(page);
  await expect(page.getByText('Proposed change', { exact: true })).toBeVisible({ timeout: 10000 });
  await note(page).getByRole('button', { name: 'More' }).click();
  const item = page.getByRole('menuitem', { name: 'Fix with Claude' });
  await expect(item).toBeDisabled();
  await expect(item).toHaveAttribute('title', 'Finish the open fix first.');
});

test('F-25.3 S-05: Fix with Claude on a note kept to fix opens the card under that note', async ({
  page,
}) => {
  await openSelfReviewStep4(page);
  await note(page).getByRole('button', { name: 'Keep to fix' }).click();
  await expect(note(page).getByText("Kept to fix. It's on your list at the end.")).toBeVisible();
  await page.getByTestId('title-bar').getByRole('button', { name: 'Finish review' }).click();
  await expect(page.getByRole('heading', { name: /^summary$/i })).toBeVisible();
  const item = page.getByRole('listitem').filter({ hasText: /refreshes PendingCount/ });
  await item.getByRole('button', { name: 'Fix with Claude' }).click();
  await expect(page.getByText(BUSY)).toBeVisible();
  await expect(page.getByText('Proposed change', { exact: true })).toBeVisible({ timeout: 10000 });
  const card = cardOf(page);
  await expect(card.getByText(`Edited 1 file: ${NAME}`, { exact: true })).toBeVisible();
  await expect(card.getByRole('button', { name: 'Accept' })).toHaveCSS('background-color', GREEN);
  await expect(card.getByRole('button', { name: 'Discard' })).toBeVisible();
});
