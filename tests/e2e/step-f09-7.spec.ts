import { expect, test, type Locator, type Page } from '@playwright/test';
import { openStep, openStep1, restartApp } from './stepHelpers';

// F-09.7 against the mock backend: the line comment composer in Focus layout A and in Detailed
// mode (M4 plan, decision 13). Comment in the "Selected lines" group, or C, opens it under the
// line: "Comment" tag, "L50", text area "Write a comment…", Add to drafts (Ctrl+Enter) and Cancel
// (Esc). The draft keeps the line's position; the card keeps the text with the F-09.3
// confirmation and Undo, also after the app starts again.

const ADDED = 'Added to drafts. It reaches GitLab only when you publish.';
const TEXT = 'Is the worker started before the first Kick?';

const addLine = (page: Page, no: number) =>
  page.locator(`[data-kind="add"] [data-line-no="${String(no)}"]`);
const composer = (page: Page, line: string) =>
  page.getByRole('article', { name: `Comment on ${line}` });

async function box(target: Locator): Promise<{ top: number; bottom: number }> {
  const found = await target.boundingBox();
  if (!found) throw new Error('not visible');
  return { top: found.y, bottom: found.y + found.height };
}

/** The card sits under line `no` and above line `no + 1`. */
async function expectUnder(page: Page, card: Locator, no: number) {
  const [above, cardBox, below] = await Promise.all([
    box(addLine(page, no)),
    box(card),
    box(addLine(page, no + 1)),
  ]);
  expect(cardBox.top).toBeGreaterThanOrEqual(above.bottom - 1);
  expect(cardBox.bottom).toBeLessThanOrEqual(below.top + 1);
}

async function openStep4(page: Page) {
  await openStep1(page);
  await openStep(page, /ViewModel/, 4);
  await expect(addLine(page, 47)).toBeVisible();
}

test('F-09.7 Comment on selected lines opens the composer under the last line; Ctrl+Enter adds a draft that is still there after a restart', async ({
  page,
}) => {
  await openStep4(page);
  await addLine(page, 47).click();
  await addLine(page, 50).click({ modifiers: ['Shift'] });
  const group = page.getByRole('group', { name: 'Selected lines' });
  await group.getByRole('button', { name: 'Comment' }).click();

  const card = composer(page, 'L50');
  await expect(card).toBeVisible();
  await expect(card).toContainText('Comment');
  await expect(card).toContainText('L50');
  const text = card.getByRole('textbox', { name: 'Comment' });
  await expect(text).toBeFocused();
  await expect(text).toHaveAttribute('placeholder', 'Write a comment…');
  await expect(card.getByRole('button', { name: 'Add to drafts' })).toBeDisabled();
  await expect(card.getByRole('button', { name: 'Cancel' })).toBeVisible();
  await expectUnder(page, card, 50);

  await page.keyboard.type(TEXT);
  await page.keyboard.press('Control+Enter');
  await expect(card).toContainText(ADDED);
  await expect(card).toContainText(TEXT);
  await expect(card.getByRole('button', { name: 'Undo' })).toBeVisible();
  await expect(card.getByRole('textbox')).toHaveCount(0);

  // The draft is kept on this PC: the app opens step 4 again with the comment under its line.
  await restartApp(page);
  await expect(page.getByText('Step 4 of 8')).toBeVisible();
  const again = composer(page, 'L50');
  await expect(again).toContainText(TEXT);
  await expect(again).toContainText(ADDED);
  await expectUnder(page, again, 50);
});

test('F-09.7 C opens the composer in Detailed mode under the step’s first changed line; Esc discards it, Undo brings the text back', async ({
  page,
}) => {
  await openStep4(page);
  await page.keyboard.press('Control+d');
  await expect(page.getByRole('complementary', { name: 'Guide' })).toBeVisible();
  await expect(addLine(page, 14)).toBeVisible();

  await page.keyboard.press('c');
  const card = composer(page, 'L14');
  await expect(card).toBeVisible();
  await expect(card.getByRole('textbox', { name: 'Comment' })).toBeFocused();
  await expectUnder(page, card, 14);
  await page.keyboard.type('Not this one.');
  await page.keyboard.press('Escape');
  await expect(card).toHaveCount(0);

  await page.keyboard.press('c');
  await expect(card.getByRole('textbox', { name: 'Comment' })).toHaveValue('');
  await page.keyboard.type(TEXT);
  await card.getByRole('button', { name: 'Add to drafts' }).click();
  await expect(card).toContainText(ADDED);
  await expect(card).toContainText(TEXT);

  await card.getByRole('button', { name: 'Undo' }).click();
  await expect(card.getByRole('textbox', { name: 'Comment' })).toHaveValue(TEXT);
  await expect(card).not.toContainText(ADDED);
});
