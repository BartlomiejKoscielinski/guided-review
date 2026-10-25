import { expect, test, type Page } from '@playwright/test';
import { openStep, openStep1 } from './stepHelpers';

// F-25.1 against the mock backend: Fix with Claude is offered on own code only. In a self-review
// (staged changes) the note card's More menu has it and so does the note kept to fix on S-05; in
// a teammate's MR (!482) it is nowhere. Clicking it (F-25.2, F-25.3) is not tried here.

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

test('F-25.1 a self-review note offers Fix with Claude in its More menu and on the S-05 fix list', async ({
  page,
}) => {
  await openSelfReviewStep4(page);
  await note(page).getByRole('button', { name: 'More' }).click();
  const menu = page.getByRole('menu', { name: /More for PendingCount/ });
  await expect(menu.getByRole('menuitem')).toHaveText([
    'Edit and keep',
    'Ask Claude',
    'Fix with Claude',
    'Copy',
  ]);
  await page.keyboard.press('Escape');

  await note(page).getByRole('button', { name: 'Keep to fix' }).click();
  await expect(note(page).getByText("Kept to fix. It's on your list at the end.")).toBeVisible();
  await finishReview(page).click();
  await expect(page.getByRole('heading', { name: /^summary$/i })).toBeVisible();
  const item = page.getByRole('listitem').filter({ hasText: SUGGESTED });
  await expect(item.getByRole('button', { name: 'Fix with Claude' })).toBeEnabled();
});

test('F-25.1 a teammate’s MR offers no Fix with Claude on a note or on its summary', async ({
  page,
}) => {
  await openStep1(page);
  await openStep(page, /ViewModel/, 4);
  await note(page).getByRole('button', { name: 'More' }).click();
  const menu = page.getByRole('menu', { name: /More for PendingCount/ });
  await expect(menu.getByRole('menuitem', { name: 'Edit and add' })).toBeVisible();
  await expect(page.getByRole('menuitem', { name: /fix with claude/i })).toHaveCount(0);
  await page.keyboard.press('Escape');

  await note(page).getByRole('button', { name: 'Add to drafts' }).click();
  await expect(note(page).getByText(/^Added to drafts/)).toBeVisible();
  await finishReview(page).click();
  await expect(page.getByRole('heading', { name: /^summary$/i })).toBeVisible();
  await expect(page.getByRole('button', { name: /fix with claude/i })).toHaveCount(0);
});
