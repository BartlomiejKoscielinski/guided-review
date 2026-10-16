import { expect, test, type Page } from '@playwright/test';
import { openStep, openStep1 } from './stepHelpers';

// S-05 of a self-review against the mock backend (F-17.4): Review before push on staged changes,
// a note kept to fix on step 4, then Finish review. The summary lists the kept notes without
// Publish, Threads or the Approval tile; Copy as checklist and Back to steps work.

const PENDING = 'PendingCount won’t refresh after upload';
const SUGGESTED =
  'Could IUploadQueue publish changes (an event or WeakReferenceMessenger) so the ViewModel refreshes PendingCount after each upload?';

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
const finishReview = (page: Page) =>
  page.getByTestId('title-bar').getByRole('button', { name: 'Finish review' });

test('F-17.4 Finish review of a self-review opens SUMMARY: progress, the kept note, no publish, approve or threads', async ({
  page,
}) => {
  await openSelfReviewStep4(page);
  await page.getByRole('button', { name: 'Mark reviewed' }).click();
  await expect(page.getByRole('button', { name: 'Reviewed', exact: true })).toBeVisible();
  await note(page).getByRole('button', { name: 'Keep to fix' }).click();
  await expect(note(page).getByText("Kept to fix. It's on your list at the end.")).toBeVisible();

  await finishReview(page).click();
  await expect(page.getByRole('heading', { name: /^summary$/i })).toBeVisible();
  await expect(page.getByText('1 of 8 steps reviewed.')).toBeVisible();
  await expect(page.getByText('Back to steps')).toBeVisible();
  await expect(page.getByText(SUGGESTED)).toBeVisible();
  await expect(page.getByText(/DeliveryPhotoViewModel\.cs:49/)).toBeVisible();
  await expect(page.getByText('Nothing to fix.')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Copy as checklist' })).toBeEnabled();

  // No GitLab here: nothing to publish, approve, resolve or discuss.
  await expect(
    page.getByRole('button', { name: /^(Publish|Approve|Resolve|Reply|Reopen)/ }),
  ).toHaveCount(0);
  await expect(page.getByRole('tab')).toHaveCount(0);
  await expect(page.getByText(/threads/i)).toHaveCount(0);
  await expect(page.getByRole('heading', { name: /approval/i })).toHaveCount(0);
  await expect(page.getByRole('checkbox')).toHaveCount(0);
});

test('F-17.4 Back to steps returns to the step screen', async ({ page }) => {
  await openSelfReviewStep4(page);
  await finishReview(page).click();
  await expect(page.getByRole('heading', { name: /^summary$/i })).toBeVisible();
  await page.getByText('Back to steps').click();
  await expect(page.getByText(/^Step \d of 8$/)).toBeVisible();
  await expect(page.getByRole('heading', { name: /^summary$/i })).toHaveCount(0);
});

test('F-17.4 Copy as checklist puts the kept notes on the clipboard as "- [ ]" lines', async ({
  page,
  context,
}) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await openSelfReviewStep4(page);
  await note(page).getByRole('button', { name: 'Keep to fix' }).click();
  await expect(note(page).getByText("Kept to fix. It's on your list at the end.")).toBeVisible();
  await finishReview(page).click();
  await page.getByRole('button', { name: 'Copy as checklist' }).click();

  const escaped = SUGGESTED.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const checklist = new RegExp(`^- \\[ \\] ${escaped} \\(.*DeliveryPhotoViewModel\\.cs:49\\)$`);
  await expect
    .poll(async () => (await page.evaluate(() => navigator.clipboard.readText())).trim())
    .toMatch(checklist);
});

test('F-17.4 a note taken back with Undo is not on the list: "Nothing to fix."', async ({
  page,
}) => {
  await openSelfReviewStep4(page);
  await note(page).getByRole('button', { name: 'Keep to fix' }).click();
  await note(page).getByRole('button', { name: 'Undo' }).click();
  await expect(note(page).getByRole('button', { name: 'Keep to fix' })).toBeVisible();

  await finishReview(page).click();
  await expect(page.getByText('Nothing to fix.')).toBeVisible();
  await expect(page.getByText('0 of 8 steps reviewed.')).toBeVisible();
  await expect(page.getByText(SUGGESTED)).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Copy as checklist' })).toBeDisabled();
});

test('F-17.4 Finish review in an MR session leaves the step screen for the S-05 stub, not the self-review summary', async ({
  page,
}) => {
  await openStep1(page);
  await finishReview(page).click();
  await expect(page.getByText('Step 1 of 8')).toBeHidden();
  await expect(page.getByRole('button', { name: 'Copy as checklist' })).toHaveCount(0);
  await expect(page.getByText('Nothing to fix.')).toHaveCount(0);
});
