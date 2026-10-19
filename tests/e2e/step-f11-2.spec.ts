import { expect, test, type Locator, type Page } from '@playwright/test';
import { openStep, openStep1 } from './stepHelpers';

// F-11.2 on S-03 and S-04 against the mock backend (Review.dc.html thread card; M5 decisions 1
// and 2): an open thread has Resolve (green) and Reply under its notes, a resolved one the
// "Resolved" tag and Reopen. Resolve, Reopen and Reply act at once; a reply is a note of the
// thread under the signed-in user, not a draft. Not tried in the real app (stand-in GitLab).

const GREEN = 'rgb(99, 214, 118)';
const NEUTRAL = 'rgb(38, 38, 38)';
const YELLOW = 'rgb(247, 207, 61)';
const REPLY_BOX = 'Write a reply…';
const SEMAPHORE = 'Kick only releases a semaphore, the upload runs in the background.';

const thread = (page: Page, line: number) =>
  page.getByRole('region', { name: `Thread at line ${String(line)}`, exact: true });
const icon = (page: Page, line: number, resolved = false) =>
  page.getByRole('button', {
    name: `Thread by Paweł S. at line ${String(line)}${resolved ? ', resolved' : ''}`,
    exact: true,
  });
const action = (card: Locator, name: string) => card.getByRole('button', { name, exact: true });
const yOf = async (target: Locator) => (await target.boundingBox())?.y ?? NaN;

async function openViewModelStep(page: Page) {
  await openStep1(page);
  await openStep(page, /ViewModel/, 4);
  await expect(thread(page, 48)).toContainText(SEMAPHORE);
}

test('F-11.2 an open thread has a green Resolve and a Reply under its notes; Resolve gives the Resolved tag and Reopen, Reopen gives them back', async ({
  page,
}) => {
  await openViewModelStep(page);
  const card = thread(page, 48);

  const resolve = action(card, 'Resolve');
  const reply = action(card, 'Reply');
  await expect(resolve).toBeVisible();
  await expect(resolve).toHaveCSS('background-color', GREEN);
  await expect(reply).toBeVisible();
  await expect(reply).toHaveCSS('background-color', NEUTRAL);
  await expect(card.getByText('Resolved', { exact: true })).toHaveCount(0);
  await expect(action(card, 'Reopen')).toHaveCount(0);
  // Under the last note, in the card.
  expect(await yOf(resolve)).toBeGreaterThan(await yOf(card.getByText(SEMAPHORE)));

  await resolve.click();
  const tag = card.getByText('Resolved', { exact: true });
  await expect(tag).toBeVisible();
  await expect(tag).toHaveCSS('background-color', GREEN);
  await expect(action(card, 'Reopen')).toBeVisible();
  await expect(action(card, 'Reopen')).toBeFocused();
  await expect(action(card, 'Resolve')).toHaveCount(0);
  await expect(action(card, 'Reply')).toHaveCount(0);
  // The notes stay and the gutter icon says resolved.
  await expect(card).toContainText(SEMAPHORE);
  await expect(icon(page, 48, true)).toBeVisible();

  await action(card, 'Reopen').click();
  await expect(action(card, 'Resolve')).toBeVisible();
  await expect(action(card, 'Resolve')).toBeFocused();
  await expect(action(card, 'Reply')).toBeVisible();
  await expect(card.getByText('Resolved', { exact: true })).toHaveCount(0);
  await expect(icon(page, 48)).toBeVisible();
});

test('F-11.2 Reply opens a composer under the thread; Ctrl+Enter sends, the reply joins the thread as the signed-in user', async ({
  page,
}) => {
  await openViewModelStep(page);
  const card = thread(page, 48);
  await action(card, 'Reply').click();

  const box = page.getByPlaceholder(REPLY_BOX);
  await expect(box).toBeVisible();
  await expect(box).toBeFocused();
  // The composer's Reply is yellow, disabled while the text is blank, and the only Reply.
  const send = page.getByRole('button', { name: 'Reply', exact: true });
  await expect(send).toHaveCount(1);
  await expect(send).toBeDisabled();
  await expect(page.getByRole('button', { name: 'Cancel', exact: true })).toBeVisible();
  expect(await yOf(box)).toBeGreaterThan(await yOf(card.getByText(SEMAPHORE)));

  await box.fill('Thanks, that answers it.');
  await expect(send).toBeEnabled();
  await expect(send).toHaveCSS('background-color', YELLOW);
  await box.press('Control+Enter');

  await expect(card.getByText('Thanks, that answers it.')).toBeVisible();
  await expect(card.locator('b', { hasText: 'Bartek K.' })).toBeVisible();
  await expect(card.getByText('BK', { exact: true })).toBeVisible();
  await expect(card).toContainText('Bartek K. · just now');
  expect(await yOf(card.getByText('Thanks, that answers it.'))).toBeGreaterThan(
    await yOf(card.getByText(SEMAPHORE)),
  );
  await expect(box).toHaveCount(0);
  // The thread has its own Reply and Resolve again; the reply did not resolve it.
  await expect(action(card, 'Reply')).toBeVisible();
  await expect(action(card, 'Resolve')).toBeVisible();
  await expect(card.getByText('Resolved', { exact: true })).toHaveCount(0);
});

test('F-11.2 the Reply button sends too; Esc and Cancel close the composer and drop the text', async ({
  page,
}) => {
  await openViewModelStep(page);
  const card = thread(page, 48);
  const box = page.getByPlaceholder(REPLY_BOX);

  await action(card, 'Reply').click();
  await box.fill('Not sent');
  await box.press('Escape');
  await expect(box).toHaveCount(0);
  await expect(card).not.toContainText('Not sent');
  await expect(action(card, 'Reply')).toBeFocused();

  await action(card, 'Reply').click();
  await expect(box).toHaveValue('');
  await box.fill('Not sent either');
  await page.getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(box).toHaveCount(0);
  await expect(card).not.toContainText('Not sent either');

  await action(card, 'Reply').click();
  await box.fill('Sent with the button.');
  await page.getByRole('button', { name: 'Reply', exact: true }).click();
  await expect(card.getByText('Sent with the button.')).toBeVisible();
  await expect(box).toHaveCount(0);
});

test('F-11.2 every card acts on its own thread: resolving line 24 leaves line 61 open', async ({
  page,
}) => {
  await openStep1(page);
  await openStep(page, /SqliteUploadQueue/, 2);
  const first = thread(page, 24);
  await expect(first).toContainText('Is the table created on every start?');

  await action(first, 'Resolve').click();
  await expect(first.getByText('Resolved', { exact: true })).toBeVisible();

  await page
    .locator('main[class*="main"]')
    .first()
    .evaluate((el) => {
      el.scrollTop = el.scrollHeight;
    });
  const second = thread(page, 61);
  await expect(second).toContainText('What happens to a photo that keeps failing?');
  await expect(action(second, 'Resolve')).toBeVisible();
  await expect(action(second, 'Reply')).toBeVisible();
  await expect(second.getByText('Resolved', { exact: true })).toHaveCount(0);
});

test('F-11.2 Resolve works in every layout and in Detailed mode, and the state is the same in all of them', async ({
  page,
}) => {
  await openViewModelStep(page);
  const card = thread(page, 48);

  // Layout C: resolve in the guide layout.
  await page.keyboard.press('Control+3');
  await expect(page.getByText('Step 4 of 8')).toBeVisible();
  await expect(card).toBeVisible();
  await action(card, 'Resolve').click();
  await expect(card.getByText('Resolved', { exact: true })).toBeVisible();

  // Layout B and A: still resolved.
  await page.keyboard.press('Control+2');
  await expect(thread(page, 48).getByText('Resolved', { exact: true })).toBeVisible();
  await page.keyboard.press('Control+1');
  await expect(thread(page, 48).getByText('Resolved', { exact: true })).toBeVisible();

  // Detailed mode: the same card, reopened there.
  await page.keyboard.press('Control+d');
  await expect(page.getByRole('complementary', { name: 'Guide' })).toBeVisible();
  const detailed = thread(page, 48);
  await expect(detailed.getByText('Resolved', { exact: true })).toBeVisible();
  await action(detailed, 'Reopen').click();
  await expect(action(detailed, 'Resolve')).toBeVisible();
  await expect(action(detailed, 'Reply')).toBeVisible();

  // Back in Focus: open there too.
  await page.keyboard.press('Control+d');
  await expect(page.getByText('Step 4 of 8')).toBeVisible();
  const focus = thread(page, 48);
  await expect(action(focus, 'Resolve')).toBeVisible();
  await expect(focus.getByText('Resolved', { exact: true })).toHaveCount(0);
});
