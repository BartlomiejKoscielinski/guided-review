import { expect, test, type Page } from '@playwright/test';
import { openStep1 } from './stepHelpers';

// F-30.6 against the mock backend (M4 plan, decision 14; the roadmap demo): a review of !482 with
// the keyboard only. Steps with ] and [, Space marks a file reviewed, J/K the current hunk (its focus
// outline is the one element marked aria-current="true"), N the next note, D and X on the focused
// note, C the line composer and Esc to close it, Ctrl+D to Detailed and back, A ask, ? the list of
// shortcuts.

const VM = 'src/Mobile.App/ViewModels/DeliveryPhotoViewModel.cs';
const QUEUE = 'src/Mobile.Core/Uploads/IUploadQueue.cs';
const ADDED = 'Added to drafts. It reaches GitLab only when you publish.';
const DISMISSED = "Dismissed. Claude won't raise it again for this commit.";

const noteMark = (page: Page, n: number, title: string) =>
  page.getByRole('button', { name: `Note ${String(n)}: ${title}`, exact: true });
const card = (page: Page, title: string) =>
  page.getByRole('article', { name: `Claude note: ${title}` });
const currentHunk = (page: Page) => page.locator('[aria-current="true"]');

test('F-30.6 a whole review with the keyboard only', async ({ page }) => {
  await openStep1(page);

  // Space marks the current file reviewed (F-07.10): before any move, the step's first file; step 1
  // has two files, so the step is not reviewed yet.
  await page.keyboard.press('Space');
  await expect(
    page.getByRole('button', { name: `Mark ${QUEUE} reviewed`, exact: true }),
  ).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByRole('button', { name: 'Mark reviewed', exact: true })).toHaveAttribute(
    'aria-pressed',
    'false',
  );

  // ] and [ move between steps.
  await page.keyboard.press(']');
  await expect(page.getByText('Step 2 of 8')).toBeVisible();
  await page.keyboard.press('[');
  await expect(page.getByText('Step 1 of 8')).toBeVisible();
  for (const n of [2, 3, 4]) {
    await page.keyboard.press(']');
    await expect(page.getByText(`Step ${String(n)} of 8`)).toBeVisible();
  }

  // J makes a hunk current, scrolled into view with its focus outline; K goes back.
  await page.keyboard.press('j');
  await expect(currentHunk(page)).toHaveCount(1);
  await expect(currentHunk(page)).toBeInViewport();
  await expect(page.getByRole('region', { name: VM }).locator('[aria-current="true"]')).toHaveCount(
    1,
  );
  await page.keyboard.press('j');
  await page.keyboard.press('k');
  await expect(currentHunk(page)).toHaveCount(1);

  // N moves from the first Should fix (note 2) to note 3; D adds it to drafts.
  await expect(noteMark(page, 2, 'PendingCount won’t refresh after upload')).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await page.keyboard.press('n');
  await expect(noteMark(page, 3, 'Status texts are hardcoded')).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await page.keyboard.press('d');
  await expect(card(page, 'Status texts are hardcoded').getByText(ADDED)).toBeVisible();

  // N to note 4; X dismisses it.
  const cancel = 'catch (Exception) also catches camera cancellation';
  await page.keyboard.press('n');
  await expect(noteMark(page, 4, cancel)).toHaveAttribute('aria-pressed', 'true');
  await page.keyboard.press('x');
  await expect(card(page, cancel).getByText(DISMISSED)).toBeVisible();

  // C opens the composer with its field focused; letters type there; Esc closes it.
  await page.keyboard.press('c');
  const comment = page.getByRole('textbox', { name: 'Comment' });
  await expect(comment).toBeFocused();
  await page.keyboard.type('Why do we need this?');
  await expect(comment).toHaveValue('Why do we need this?');
  await page.keyboard.press('Escape');
  await expect(comment).toBeHidden();

  // Ctrl+D to Detailed: J outlines a hunk header, ] and [ move between steps; Ctrl+D back.
  await page.keyboard.press('Control+d');
  await expect(page.getByText('Step 4 / 8', { exact: true })).toBeVisible();
  await page.keyboard.press('j');
  await expect(currentHunk(page)).toContainText('lines 12–31 · DeliveryPhotoViewModel');
  await page.keyboard.press(']');
  await expect(page.getByText('Step 5 / 8', { exact: true })).toBeVisible();
  await page.keyboard.press('[');
  await expect(page.getByText('Step 4 / 8', { exact: true })).toBeVisible();
  await page.keyboard.press('Control+d');
  await expect(page.getByText('Step 4 of 8')).toBeVisible();
});

test('F-30.6 A opens the answer card with the question field focused', async ({ page }) => {
  await openStep1(page);
  await page.keyboard.press('a');
  const answer = page.getByRole('article', { name: 'Claude answer' });
  await expect(answer.getByRole('textbox', { name: 'Ask Claude about this step' })).toBeFocused();
});

test('F-30.6 ? on S-03 opens Settings › Shortcuts', async ({ page }) => {
  await openStep1(page);
  await page.keyboard.press('?');
  await expect(page.getByRole('heading', { name: 'Shortcuts', level: 1 })).toBeVisible();
  await expect(
    page
      .getByRole('navigation', { name: 'Settings sections' })
      .getByRole('button', { name: 'Shortcuts', exact: true }),
  ).toHaveAttribute('aria-current', 'page');
});
