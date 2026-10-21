import { expect, test, type Page } from '@playwright/test';

// F-26.2: S-10 Your MR, the selected thread in the code, against the mock backend's !480
// (Author.dc.html): the sticky file bar "src/App/Workers/UploadWorker.cs" with "Open in Rider ·
// line 46", the unified diff, and the thread card under line 46 with Marta K.'s message and the
// actions Fix with Claude, Fix in Rider, Reply. Piotr S.'s question moves all of it to line 36
// and has no Fix actions.
//
// Locators the screen keeps: a listbox named "Threads" (role=option rows); the file bar's button
// named "Open in Rider · line N"; DiffView rows `[data-kind]` with `[data-line-no]`; the card
// is the region named "Thread" with the buttons "Fix with Claude", "Fix in Rider", "Reply".

const bar = (page: Page) => page.getByTestId('title-bar');
const threads = (page: Page) => page.getByRole('listbox', { name: 'Threads' });
const card = (page: Page) => page.getByRole('region', { name: 'Thread' });
const addRow = (page: Page, no: number) =>
  page.locator(`[data-kind="add"]:has([data-line-no="${String(no)}"])`);

async function openAuthor(page: Page) {
  await page.goto('/');
  await expect(bar(page)).toBeVisible();
  const mrs = page.getByRole('region', { name: 'Merge requests' });
  await mrs.getByRole('tab', { name: /^Mine/ }).click();
  await mrs.getByText('Retry in UploadWorker after network loss').click();
  await expect(bar(page).getByText('You’re the author')).toBeVisible();
}

test('F-26.2 the first thread opens in the code: file bar, diff and the card under line 46', async ({
  page,
}) => {
  await openAuthor(page);

  await expect(page.getByText('UploadWorker.cs', { exact: true }).first()).toBeVisible();
  await expect(page.getByRole('button', { name: 'Open in Rider · line 46' })).toBeVisible();
  await expect(addRow(page, 46)).toContainText('await Task.Delay(1000 * attempt, ct);');
  const thread = card(page);
  await expect(thread).toBeVisible();
  await expect(thread).toContainText('Marta K.');
  await expect(thread).toContainText('The delay grows linearly.');
  await expect(thread.getByRole('button', { name: 'Fix with Claude' })).toBeVisible();
  await expect(thread.getByRole('button', { name: 'Fix in Rider' })).toBeVisible();
  await expect(thread.getByRole('button', { name: 'Reply' })).toBeVisible();

  // Right under the row of line 46 and above the row of line 47.
  const line = await addRow(page, 46).boundingBox();
  const box = await thread.boundingBox();
  const next = await addRow(page, 47).boundingBox();
  if (!line || !box || !next) throw new Error('rows or card have no box');
  expect(box.y).toBeGreaterThanOrEqual(line.y + line.height - 1);
  expect(next.y).toBeGreaterThanOrEqual(box.y + box.height - 1);
});

test('F-26.2 Piotr S.’s question opens at line 36 with its conversation and no Fix actions', async ({
  page,
}) => {
  await openAuthor(page);

  await threads(page)
    .getByRole('option', { name: /Piotr S\./ })
    .click();

  await expect(page.getByRole('button', { name: 'Open in Rider · line 36' })).toBeVisible();
  const thread = card(page);
  await expect(thread).toHaveCount(1);
  await expect(thread).toContainText('Piotr S.');
  await expect(thread).toContainText('What happens if the app is killed');
  await expect(thread).not.toContainText('The delay grows linearly.');
  await expect(thread.getByRole('button', { name: 'Fix with Claude' })).toHaveCount(0);
  await expect(thread.getByRole('button', { name: 'Fix in Rider' })).toHaveCount(0);
  const line = await addRow(page, 36).boundingBox();
  const box = await thread.boundingBox();
  if (!line || !box) throw new Error('row or card has no box');
  expect(box.y).toBeGreaterThanOrEqual(line.y + line.height - 1);
});

test('F-26.2 the actions are reachable with the keyboard', async ({ page }) => {
  await openAuthor(page);

  const claude = card(page).getByRole('button', { name: 'Fix with Claude' });
  await claude.focus();
  await expect(claude).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(card(page).getByRole('button', { name: 'Fix in Rider' })).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(card(page).getByRole('button', { name: 'Reply' })).toBeFocused();
});
