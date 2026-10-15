import { expect, test, type Page } from '@playwright/test';
import { openStep } from './stepHelpers';

// S-03 of a self-review against the mock backend (F-17.2): Review before push on staged changes,
// then step 4. Nothing reaches GitLab, so the notes are kept to fix and no publish, approve or
// thread control shows.

const KEPT = "Kept to fix. It's on your list at the end.";
const PENDING = 'PendingCount won’t refresh after upload';

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

test('F-17.2 a self-review step: Keep to fix and Edit and keep, no thread, publish or approve control', async ({
  page,
}) => {
  await openSelfReviewStep4(page);
  const card = page.getByRole('article', { name: `Claude note: ${PENDING}` });
  await expect(card.getByRole('button', { name: 'Keep to fix' })).toBeVisible();
  await expect(card.getByRole('button', { name: 'Add to drafts' })).toHaveCount(0);
  await expect(card.getByRole('button', { name: 'Dismiss' })).toBeVisible();

  // A merge request shows the thread at line 48 here; a self-review has no threads to act on.
  await expect(page.getByRole('button', { name: /^Thread by / })).toHaveCount(0);
  await expect(page.getByRole('region', { name: /^Thread at line/ })).toHaveCount(0);
  await expect(
    page.getByRole('button', { name: /^(Publish|Approve|Resolve|Reply|Reopen)/ }),
  ).toHaveCount(0);

  await card.getByRole('button', { name: 'More' }).click();
  await expect(page.getByRole('menuitem', { name: 'Edit and keep' })).toBeVisible();
  await expect(page.getByRole('menuitem', { name: 'Edit and add' })).toHaveCount(0);
  await page.keyboard.press('Escape');

  await card.getByRole('button', { name: 'Keep to fix' }).click();
  await expect(card.getByText(KEPT)).toBeVisible();
  await expect(card.getByText(/Added to drafts/)).toHaveCount(0);
  await card.getByRole('button', { name: 'Undo' }).click();
  await expect(card.getByRole('button', { name: 'Keep to fix' })).toBeVisible();
});

test('F-17.2 a self-review keeps the edited text with Edit and keep, and Dismiss keeps its copy', async ({
  page,
}) => {
  await openSelfReviewStep4(page);
  const card = page.getByRole('article', { name: `Claude note: ${PENDING}` });
  await card.getByRole('button', { name: 'More' }).click();
  await page.getByRole('menuitem', { name: 'Edit and keep' }).click();
  await card.getByRole('textbox', { name: 'Suggested comment' }).fill('Raise a change event');
  await card.getByRole('button', { name: 'Keep to fix' }).click();
  await expect(card.getByText(KEPT)).toBeVisible();
  await card.getByRole('button', { name: 'Undo' }).click();

  await card.getByRole('button', { name: 'Dismiss' }).click();
  await expect(
    card.getByText("Dismissed. Claude won't raise it again for this commit."),
  ).toBeVisible();
});

test('F-17.2 the guide and the answer card in layout C keep notes to fix too', async ({ page }) => {
  await openSelfReviewStep4(page);
  await page.keyboard.press('Control+3');
  const guide = page.getByRole('complementary', { name: 'Guide' });
  const card = guide.getByRole('article', { name: `Claude note: ${PENDING}` });
  await expect(card.getByRole('button', { name: 'Keep to fix' })).toBeVisible();
  await expect(guide.getByRole('button', { name: 'Add to drafts' })).toHaveCount(0);
  await card.getByRole('button', { name: 'Keep to fix' }).click();
  await expect(card.getByText(KEPT)).toBeVisible();

  await guide.getByRole('textbox', { name: 'Ask Claude about this step' }).fill('Why a queue?');
  await page.keyboard.press('Enter');
  const answer = guide.getByRole('article', { name: 'Claude answer' });
  await answer.getByRole('button', { name: 'Keep to fix' }).click();
  await expect(answer.getByText(KEPT)).toBeVisible();
  await expect(answer.getByRole('button', { name: 'Add to drafts' })).toHaveCount(0);
  await expect(
    page.getByRole('button', { name: /^(Publish|Approve|Resolve|Reply|Reopen)/ }),
  ).toHaveCount(0);
});
