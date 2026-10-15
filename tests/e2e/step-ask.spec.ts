import { expect, test, type Locator, type Page } from '@playwright/test';
import { openStep, openStep1 } from './stepHelpers';

// S-03 against the mock backend: questions in the context of the step and the selected lines
// (F-10.1). Lines are selected with the line numbers of the diff: a click selects, Shift+click
// extends to a range; a group "Selected lines" under the last line has Ask Claude and Clear.

const addLine = (page: Page, no: number) =>
  page.locator(`[data-kind="add"] [data-line-no="${String(no)}"]`);

async function top(target: Locator): Promise<{ top: number; bottom: number }> {
  const box = await target.boundingBox();
  if (!box) throw new Error('not visible');
  return { top: box.y, bottom: box.y + box.height };
}

async function openStep4(page: Page) {
  await openStep1(page);
  await openStep(page, /ViewModel/, 4);
  await expect(addLine(page, 47)).toBeVisible();
}

test('F-10.1 select lines with their numbers, ask Claude about them; the answer sits under the last line', async ({
  page,
}) => {
  await openStep4(page);
  const group = page.getByRole('group', { name: 'Selected lines' });
  await expect(group).toHaveCount(0);

  await addLine(page, 47).click();
  await expect(group).toContainText('Line 47');
  await addLine(page, 50).click({ modifiers: ['Shift'] });
  await expect(group).toContainText('Lines 47–50');
  await expect(page.locator('[data-selected="true"]')).toHaveCount(4);

  await group.getByRole('button', { name: 'Ask Claude' }).click();
  const card = page.getByRole('article', { name: 'Claude answer' });
  await expect(card.getByRole('textbox', { name: 'Ask Claude about this step' })).toBeFocused();
  await page.keyboard.type('Why is the worker kicked here?');
  await page.keyboard.press('Enter');
  await expect(card.getByRole('button', { name: 'Add to drafts' })).toBeVisible();
  await expect(card).toContainText('Lines 47–50');

  // The card is under line 50 and above line 51.
  const [line50, cardBox, line51] = await Promise.all([
    top(addLine(page, 50)),
    top(card),
    top(addLine(page, 51)),
  ]);
  expect(cardBox.top).toBeGreaterThanOrEqual(line50.bottom - 1);
  expect(cardBox.bottom).toBeLessThanOrEqual(line51.top + 1);

  // Esc drops the selection; a click on a note's square in the gutter selects nothing.
  await page.keyboard.press('Escape');
  await expect(group).toHaveCount(0);
  await expect(page.locator('[data-selected="true"]')).toHaveCount(0);
  await page
    .getByRole('button', { name: 'Note 1: The whole photo goes into SQLite as byte[]' })
    .click();
  await expect(group).toHaveCount(0);
});

test('F-10.1 the selection follows the layouts; in the guide a question carries it', async ({
  page,
}) => {
  await openStep4(page);
  await addLine(page, 50).click();
  await addLine(page, 52).click({ modifiers: ['Shift'] });
  const group = page.getByRole('group', { name: 'Selected lines' });
  await expect(group).toContainText('Lines 50–52');

  await page.keyboard.press('Control+3');
  const guide = page.getByRole('complementary', { name: 'Guide' });
  await expect(group).toContainText('Lines 50–52');
  await guide.getByRole('textbox', { name: 'Ask Claude about this step' }).fill('Why two texts?');
  await page.keyboard.press('Enter');
  const answer = guide.getByRole('article', { name: 'Claude answer' });
  await expect(answer.getByRole('button', { name: 'Add to drafts' })).toBeVisible();
  await expect(answer).toContainText('Lines 50–52');

  await page.keyboard.press('Control+1');
  await expect(page.getByRole('navigation', { name: 'Steps' })).toBeVisible();
  await expect(group).toContainText('Lines 50–52');

  // Another step starts without a selection.
  await page.getByRole('button', { name: 'Next step' }).click();
  await expect(page.getByText('Step 5 of 8')).toBeVisible();
  await expect(group).toHaveCount(0);
});
