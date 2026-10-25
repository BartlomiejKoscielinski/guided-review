import { expect, test, type Page } from '@playwright/test';

// F-26.7: S-10 question thread, against the mock backend's !480 (Author.dc.html `isQuestion`).
// Piotr S.'s question has the reply text area ("Your reply") at once, **Draft with Claude**
// (the button reads "Drafting…" for about a second, then the area holds the proposed answer and
// nothing is sent) and **Send reply** (immediate). After sending the card says "Answered. The
// thread stays open until Piotr resolves it.", my reply is the last note ("You"), the list tag
// reads Answered and the heading counts what is left.
//
// Locators the screen keeps: the card is the region "Thread"; in it the textbox "Your reply", the
// buttons "Draft with Claude" / "Drafting…" and "Send reply"; the list is the listbox "Threads";
// the heading level 1.

const REPLY =
  'Nothing is lost: the photo stays in the SQLite queue until it’s sent. Only the attempt count is in memory, so after a restart the backoff starts again from 2 s. That felt acceptable, but I can persist it if you prefer.';
const SENT = 'Answered. The thread stays open until Piotr resolves it.';

const threads = (page: Page) => page.getByRole('listbox', { name: 'Threads' });
const card = (page: Page) => page.getByRole('region', { name: 'Thread' });

async function question(page: Page) {
  await page.goto('/');
  await expect(page.getByTestId('title-bar')).toBeVisible();
  const mrs = page.getByRole('region', { name: 'Merge requests' });
  await mrs.getByRole('tab', { name: /^Mine/ }).click();
  await mrs.getByText('Retry in UploadWorker after network loss').click();
  await threads(page)
    .getByRole('option', { name: /Piotr S\./ })
    .click();
  await expect(card(page).getByRole('textbox', { name: 'Your reply' })).toBeVisible();
}

test('F-26.7 the question has the text area, Draft with Claude and Send reply, and no Reply button', async ({
  page,
}) => {
  await question(page);

  const thread = card(page);
  await expect(thread.getByRole('textbox', { name: 'Your reply' })).toHaveAttribute(
    'placeholder',
    'Write a reply…',
  );
  await expect(thread.getByRole('button', { name: 'Draft with Claude' })).toBeEnabled();
  await expect(thread.getByRole('button', { name: 'Send reply' })).toBeDisabled();
  await expect(thread.getByText('Replies on your MR go out right away.')).toBeVisible();
  await expect(thread.getByRole('button', { name: 'Reply', exact: true })).toHaveCount(0);
});

test('F-26.7 Draft with Claude shows Drafting… and then fills the proposed answer without sending it', async ({
  page,
}) => {
  await question(page);

  await card(page).getByRole('button', { name: 'Draft with Claude' }).click();

  await expect(card(page).getByRole('button', { name: 'Drafting…' })).toBeDisabled();
  await expect(card(page).getByRole('button', { name: 'Send reply' })).toBeDisabled();
  await expect(card(page).getByRole('textbox', { name: 'Your reply' })).toHaveValue(REPLY, {
    timeout: 8000,
  });
  await expect(card(page).getByRole('button', { name: 'Draft with Claude' })).toBeEnabled();
  await expect(card(page).getByRole('button', { name: 'Send reply' })).toBeEnabled();
  // Nothing went out: still a question, still two threads to answer.
  await expect(threads(page).getByRole('option', { name: /Piotr S\./ })).toContainText('Question');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('2 threads to answer');
  await expect(card(page).getByText(SENT, { exact: true })).toHaveCount(0);
});

test('F-26.7 Send reply answers at once: the sentence, my note, the Answered tag and one thread less', async ({
  page,
}) => {
  await question(page);
  await card(page).getByRole('button', { name: 'Draft with Claude' }).click();
  const area = card(page).getByRole('textbox', { name: 'Your reply' });
  await expect(area).toHaveValue(REPLY, { timeout: 8000 });
  await area.fill(`${REPLY} Zażółć.`);

  await card(page).getByRole('button', { name: 'Send reply' }).click();

  await expect(card(page).getByText(SENT, { exact: true })).toBeVisible();
  await expect(card(page).getByRole('textbox')).toHaveCount(0);
  await expect(card(page).getByRole('button', { name: 'Send reply' })).toHaveCount(0);
  await expect(card(page).getByText('You', { exact: true })).toBeVisible();
  await expect(card(page).getByText(`${REPLY} Zażółć.`, { exact: true })).toBeVisible();
  await expect(threads(page).getByRole('option', { name: /Piotr S\./ })).toContainText('Answered');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('1 thread to answer');
});

test('F-26.7 the typed reply stays when another thread is picked and the question is opened again', async ({
  page,
}) => {
  await question(page);
  const area = card(page).getByRole('textbox', { name: 'Your reply' });
  await area.fill('Typed before leaving');

  await threads(page)
    .getByRole('option', { name: /Marta K\./ })
    .click();
  await expect(card(page).getByRole('button', { name: 'Fix in Rider' })).toBeVisible();
  await threads(page)
    .getByRole('option', { name: /Piotr S\./ })
    .click();

  await expect(card(page).getByRole('textbox', { name: 'Your reply' })).toHaveValue(
    'Typed before leaving',
  );
});
