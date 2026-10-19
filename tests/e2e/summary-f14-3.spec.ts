import { expect, test, type Page } from '@playwright/test';
import { openStep, openStep1 } from './stepHelpers';

// F-14.3 against the mock backend (SummaryDesk.dc.html): the Approval tile of S-05 says
// "Approving doesn’t publish comments." and "Open threads: 3." (!482 has three open threads, or
// "All threads resolved."); once the user approved while a draft is unpublished it says
// "Approved without comments. Your drafts are waiting, publish them whenever you like." in place of
// the first note; Publish (N) on the Drafts tab (or Revoke approval) takes it back.
// Not tried in the real app (the stand-in GitLab has no approval rules).
//
// Locators the screen keeps: the aside role complementary named "Approval" holding both lines as
// text with the exact copy; Approve MR / Revoke approval / Resolve / Publish (N) by their names.

const NOTE = 'Approving doesn’t publish comments.';
const WAITING =
  'Approved without comments. Your drafts are waiting, publish them whenever you like.';

const finishReview = (page: Page) =>
  page.getByTestId('title-bar').getByRole('button', { name: 'Finish review' });
const tile = (page: Page) => page.getByRole('complementary', { name: 'Approval', exact: true });
const approve = (page: Page) => tile(page).getByRole('button', { name: 'Approve MR', exact: true });
const revoke = (page: Page) =>
  tile(page).getByRole('button', { name: 'Revoke approval', exact: true });

/** A comment on lines 47 to 50 of step 4's diff: one draft on L50 (F-09.7). */
async function addLineComment(page: Page, text: string) {
  const line = (no: number) => page.locator(`[data-kind="add"] [data-line-no="${String(no)}"]`);
  await expect(line(47)).toBeVisible();
  await line(47).click();
  await line(50).click({ modifiers: ['Shift'] });
  await page
    .getByRole('group', { name: 'Selected lines' })
    .getByRole('button', { name: 'Comment' })
    .click();
  const card = page.getByRole('article', { name: 'Comment on L50' });
  await card.getByRole('textbox', { name: 'Comment' }).fill(text);
  await card.getByRole('button', { name: 'Add to drafts' }).click();
  await expect(card).toContainText('Added to drafts.');
}

async function openSummary(page: Page, withDraft: boolean) {
  await openStep1(page);
  if (withDraft) {
    await openStep(page, /ViewModel/, 4);
    await addLineComment(page, 'Please cap the retries.');
  }
  await finishReview(page).click();
  await expect(page.getByRole('heading', { name: /^summary$/i })).toBeVisible();
}

test('F-14.3 approve with a draft left: the note turns into "Approved without comments…", Revoke approval takes it back', async ({
  page,
}) => {
  await openSummary(page, true);

  await expect(tile(page).getByText(NOTE, { exact: true })).toBeVisible();
  await expect(tile(page).getByText('Open threads: 3.', { exact: true })).toBeVisible();

  await approve(page).click();

  await expect(tile(page).getByText('Approved by you', { exact: true })).toBeVisible();
  await expect(tile(page).getByText(WAITING, { exact: true })).toBeVisible();
  await expect(tile(page).getByText(NOTE, { exact: true })).toHaveCount(0);

  await revoke(page).click();

  await expect(tile(page).getByText(NOTE, { exact: true })).toBeVisible();
  await expect(tile(page).getByText(WAITING, { exact: true })).toHaveCount(0);
});

test('F-14.3 publishing the drafts after approving takes the waiting note back', async ({
  page,
}) => {
  await openSummary(page, true);
  await approve(page).click();
  await expect(tile(page).getByText(WAITING, { exact: true })).toBeVisible();

  await page.getByRole('button', { name: 'Publish (1)', exact: true }).click();

  await expect(tile(page).getByText(NOTE, { exact: true })).toBeVisible();
  await expect(tile(page).getByText(WAITING, { exact: true })).toHaveCount(0);
});

test('F-14.3 approve without drafts keeps the first note; resolving the threads ends in "All threads resolved."', async ({
  page,
}) => {
  await openSummary(page, false);

  await approve(page).click();
  await expect(tile(page).getByText('Approved by you', { exact: true })).toBeVisible();
  await expect(tile(page).getByText(NOTE, { exact: true })).toBeVisible();
  await expect(tile(page).getByText(WAITING, { exact: true })).toHaveCount(0);

  await expect(tile(page).getByText('Open threads: 3.', { exact: true })).toBeVisible();
  for (const left of [2, 1]) {
    await page.getByRole('button', { name: 'Resolve', exact: true }).first().click();
    await expect(
      tile(page).getByText(`Open threads: ${String(left)}.`, { exact: true }),
    ).toBeVisible();
  }
  await page.getByRole('button', { name: 'Resolve', exact: true }).first().click();
  await expect(tile(page).getByText('All threads resolved.', { exact: true })).toBeVisible();
  await expect(tile(page).getByText(/^Open threads:/)).toHaveCount(0);
});
