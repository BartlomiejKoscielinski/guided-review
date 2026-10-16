import { expect, test, type Page } from '@playwright/test';
import { openStep, openStep1 } from './stepHelpers';

// F-11.1 on S-04 against the mock backend (M5 decision 3): the threads on lines of the current
// step show under their lines in Detailed mode as in Focus - gutter thread icon, initials squares,
// "author · age", the text and the replies - and the Guide aside does not list them.

const KICK = 'Kick() is called on the UI thread. Does the worker block anything here?';
const SEMAPHORE = 'Kick only releases a semaphore, the upload runs in the background.';

const thread = (page: Page, line: number) =>
  page.getByRole('region', { name: `Thread at line ${String(line)}`, exact: true });
const icon = (page: Page, line: number) =>
  page.getByRole('button', { name: `Thread by Paweł S. at line ${String(line)}`, exact: true });
const addLine = (page: Page, no: number) =>
  page.locator(`[data-kind="add"] [data-line-no="${String(no)}"]`).first();
/** S-04's own scrolling column (the nested main, as F-07.10's spec). */
const column = (page: Page) => page.locator('main main');
const rail = (page: Page) => page.getByRole('navigation', { name: 'Review plan' });
const yOf = async (target: ReturnType<typeof addLine>) => (await target.boundingBox())?.y ?? NaN;

test('F-11.1 a thread shows under its line in Focus and Detailed', async ({ page }) => {
  await openStep1(page);
  await openStep(page, /ViewModel/, 4);
  // Focus: the card under line 48.
  await expect(thread(page, 48)).toContainText(KICK);
  await expect(thread(page, 48)).toContainText(SEMAPHORE);

  await page.keyboard.press('Control+d');
  await expect(page.getByRole('complementary', { name: 'Guide' })).toBeVisible();
  await expect(page.getByText('Step 4 / 8')).toBeVisible();

  // Detailed: the same card, with the gutter icon on the line.
  const card = thread(page, 48);
  await expect(card).toBeVisible();
  await expect(card).toContainText(KICK);
  await expect(card).toContainText(SEMAPHORE);
  // Avatars (initials squares) and "author · age" on each note.
  await expect(card.getByText('PS', { exact: true })).toBeVisible();
  await expect(card.getByText('MK', { exact: true })).toBeVisible();
  await expect(card.locator('b', { hasText: 'Paweł S.' })).toBeVisible();
  await expect(card.locator('b', { hasText: 'Marta K.' })).toBeVisible();
  await expect(card).toContainText('Paweł S. ·');
  await expect(card).toContainText('Marta K. ·');
  await expect(icon(page, 48)).toHaveAttribute('aria-expanded', 'true');

  // Under line 48 and above line 49 of the diff.
  await expect(addLine(page, 49)).toBeVisible();
  const cardY = (await card.boundingBox())?.y ?? NaN;
  expect(await yOf(addLine(page, 48))).toBeLessThan(cardY);
  expect(cardY).toBeLessThan(await yOf(addLine(page, 49)));

  // The icon closes and opens the card; the Guide aside never lists the thread.
  await icon(page, 48).click();
  await expect(card).toHaveCount(0);
  await expect(icon(page, 48)).toHaveAttribute('aria-expanded', 'false');
  await icon(page, 48).click();
  await expect(card).toBeVisible();
  await expect(page.getByRole('complementary', { name: 'Guide' })).not.toContainText(
    'Kick() is called',
  );
});

test('F-11.1 Detailed shows the threads of the step only: step 2 has two, steps 1 and 3 none', async ({
  page,
}) => {
  await openStep1(page);
  await page.keyboard.press('Control+d');
  await expect(page.getByRole('complementary', { name: 'Guide' })).toBeVisible();
  await expect(page.getByText('Step 1 / 8')).toBeVisible();
  await expect(page.locator('[data-line-no]').first()).toBeVisible();
  await expect(page.getByRole('region', { name: /^Thread at line/ })).toHaveCount(0);
  await expect(page.getByRole('button', { name: /^Thread by / })).toHaveCount(0);

  await rail(page)
    .getByRole('button', { name: /SqliteUploadQueue/ })
    .click();
  await expect(page.getByText('Step 2 / 8')).toBeVisible();
  // Step 2: the thread on line 24 with Anna K.'s reply, and the second one further down the file.
  await expect(thread(page, 24)).toContainText('Is the table created on every start?');
  await expect(thread(page, 24)).toContainText(
    'It runs once per connection; I can move it to the migration step.',
  );
  await expect(thread(page, 24).getByText('AK', { exact: true })).toBeVisible();
  await expect(icon(page, 24)).toHaveAttribute('aria-expanded', 'true');
  await column(page).evaluate((el) => {
    el.scrollTop = el.scrollHeight;
  });
  await expect(thread(page, 61)).toContainText('What happens to a photo that keeps failing?');
  await expect(icon(page, 61)).toBeVisible();
  // Step 4's thread is not in this step.
  await expect(thread(page, 48)).toHaveCount(0);

  await rail(page)
    .getByRole('button', { name: /UploadWorker with retries/ })
    .click();
  await expect(page.getByText('Step 3 / 8')).toBeVisible();
  await expect(page.getByRole('region', { name: /^Thread at line/ })).toHaveCount(0);
  await expect(page.getByRole('button', { name: /^Thread by / })).toHaveCount(0);
});
