import { expect, test, type Page } from '@playwright/test';

// S-03 layout A against the mock backend, part 1 (M3 plan › 3e): step 1 from the plan, the steps
// list, the step's diff with its fold, notes, thread, and a decision with Undo (F-09.2).

async function openStep1(page: Page) {
  await page.goto('/');
  await expect(page.getByTestId('title-bar')).toBeVisible();
  const source = page.getByLabel(/Paste a merge request link/);
  await source.fill('!482');
  await expect(page.getByText('Merge request !482', { exact: true })).toBeVisible();
  await source.press('Enter');
  await expect(page.getByRole('heading', { name: 'Plan · 8 steps' })).toBeVisible();
  await page.getByRole('button', { name: /Start step 1/ }).click();
  await expect(page.getByText('Step 1 of 8')).toBeVisible();
}

test('F-07.1 F-07.2 the steps list opens a step; next goes on in the reader order', async ({
  page,
}) => {
  await openStep1(page);
  const steps = page.getByRole('navigation', { name: 'Steps' });
  await expect(steps.getByRole('button', { name: /Queue contract/ })).toHaveAttribute(
    'aria-current',
    'step',
  );
  await page.getByRole('button', { name: 'Next step' }).click();
  await expect(page.getByText('Step 2 of 8')).toBeVisible();
  await steps.getByRole('button', { name: /ViewModel/ }).click();
  await expect(page.getByText('Step 4 of 8')).toBeVisible();
  await expect(
    page.getByRole('heading', { level: 1, name: 'ViewModel: queue instead of upload' }),
  ).toBeVisible();
});

test('F-07.4 F-07.5 F-09.2 step 4: fold, thread, notes; Add to drafts and Undo', async ({
  page,
}) => {
  await openStep1(page);
  await page
    .getByRole('navigation', { name: 'Steps' })
    .getByRole('button', { name: /ViewModel/ })
    .click();
  await expect(page.getByText('Fields and constructor: 3 new dependencies')).toBeVisible();
  await expect(page.getByRole('region', { name: 'Thread at line 48' })).toContainText(
    'Kick() is called on the UI thread.',
  );
  await page
    .getByRole('button', { name: 'Note 2: PendingCount won’t refresh after upload' })
    .click();
  const card = page.getByRole('article', {
    name: 'Claude note: PendingCount won’t refresh after upload',
  });
  await card.getByRole('button', { name: 'Add to drafts' }).click();
  await expect(card.getByText(/Added to drafts\./)).toBeVisible();
  await expect(page.getByText('3 notes')).toBeVisible();
  await card.getByRole('button', { name: 'Undo' }).click();
  await expect(card.getByRole('button', { name: 'Add to drafts' })).toBeVisible();
  await expect(page.getByText('4 notes')).toBeVisible();

  await page.getByRole('button', { name: 'Show' }).click();
  await expect(page.getByText('Fields and constructor: 3 new dependencies')).toHaveCount(0);
  await expect(page.getByText('private readonly IUploadQueue _queue;')).toBeVisible();
});

test('F-06.9 the steps named in Already discussed (2 and 4) show their threads as context; step 1 shows none', async ({
  page,
}) => {
  await openStep1(page);
  const threads = page.getByRole('region', { name: /^Thread at line/ });
  await expect(threads).toHaveCount(0);

  // Step 2: the two open threads, the second one further down the file.
  await page.getByRole('button', { name: 'Next step' }).click();
  await expect(page.getByText('Step 2 of 8')).toBeVisible();
  const first = page.getByRole('region', { name: 'Thread at line 24' });
  await expect(first).toContainText('Is the table created on every start?');
  await expect(first).toContainText(
    'It runs once per connection; I can move it to the migration step.',
  );
  await page
    .locator('main[class*="main"]')
    .first()
    .evaluate((el) => {
      el.scrollTop = el.scrollHeight;
    });
  const second = page.getByRole('region', { name: 'Thread at line 61' });
  await expect(second).toContainText('What happens to a photo that keeps failing?');
  // Read-only until F-11: no Resolve, Reply or Reopen on a thread.
  await expect(first.getByRole('button')).toHaveCount(0);
  await expect(second.getByRole('button')).toHaveCount(0);
  await expect(page.getByRole('region', { name: 'Thread at line 48' })).toHaveCount(0);

  // Step 3 has none; step 4 has the third, with the reply.
  await page.getByRole('button', { name: 'Next step' }).click();
  await expect(page.getByText('Step 3 of 8')).toBeVisible();
  await expect(threads).toHaveCount(0);
  await page.getByRole('button', { name: 'Next step' }).click();
  await expect(page.getByText('Step 4 of 8')).toBeVisible();
  await expect(threads).toHaveCount(1);
  await expect(page.getByRole('region', { name: 'Thread at line 48' })).toContainText(
    'Kick only releases a semaphore, the upload runs in the background.',
  );
});

test('F-07.1 F-07.8 F-07.7 F-10.2 layouts B and C share the step, the note and the answer; Ctrl+1/2/3', async ({
  page,
}) => {
  await openStep1(page);
  await page
    .getByRole('navigation', { name: 'Steps' })
    .getByRole('button', { name: /ViewModel/ })
    .click();
  await page
    .getByRole('button', { name: 'Note 1: The whole photo goes into SQLite as byte[]' })
    .click();
  const main = page.locator('main[class*="main"]').first();
  await main.evaluate((el) => {
    el.scrollTop = 120;
  });

  await page.keyboard.press('Control+2');
  await expect(page.getByRole('navigation', { name: 'Steps' })).toHaveCount(0);
  await expect(page.getByRole('toolbar', { name: 'Step navigation' })).toContainText('Step 4 of 8');
  await expect(
    page.getByRole('article', { name: 'Claude note: The whole photo goes into SQLite as byte[]' }),
  ).toBeVisible();
  expect(await main.evaluate((el) => el.scrollTop)).toBe(120);

  await page.keyboard.press('Control+3');
  const guide = page.getByRole('complementary', { name: 'Guide' });
  await expect(guide.getByText('Worth a look')).toBeVisible();
  await expect(
    guide.getByRole('article', { name: 'Claude note: The whole photo goes into SQLite as byte[]' }),
  ).toBeVisible();

  await guide.getByRole('textbox', { name: 'Ask Claude about this step' }).fill('Why a queue?');
  await page.keyboard.press('Enter');
  const answer = guide.getByRole('article', { name: 'Claude answer' });
  await expect(answer.getByRole('button', { name: 'Add to drafts' })).toBeVisible();
  await answer.getByRole('button', { name: 'Add to drafts' }).click();
  await expect(answer.getByText(/Added to drafts/)).toBeVisible();

  await page.keyboard.press('Control+1');
  await expect(page.getByText('Step 4 of 8')).toBeVisible();
  await expect(page.getByRole('navigation', { name: 'Steps' })).toBeVisible();
});

// F-04.3: session state survives app restarts. The mock keeps it in the browser's storage, as the
// core keeps it in SQLite, so reloading the page is starting the app again.

/** The state is written on change; a scroll position is written debounced, within this time. */
const STATE_SAVED_MS = 500;
const SCROLL_SAVED_MS = 2000;

/** Gives the last change time to be written, then starts the app again (a page reload). */
async function restartApp(page: Page, savedMs = STATE_SAVED_MS) {
  await page.waitForTimeout(savedMs);
  await page.reload();
}

const mainOf = (page: Page) => page.locator('main[class*="main"]').first();
const scrollTopOf = (page: Page) => mainOf(page).evaluate((el) => el.scrollTop);
const stepsList = (page: Page) => page.getByRole('navigation', { name: 'Steps' });

async function openStep(page: Page, title: RegExp, position: number) {
  await stepsList(page).getByRole('button', { name: title }).click();
  await expect(page.getByText(`Step ${String(position)} of 8`)).toBeVisible();
}

const SECOND = 'PendingCount won’t refresh after upload';
const FIRST = 'The whole photo goes into SQLite as byte[]';

test('F-04.3 after a restart S-03 reopens on the step you were on', async ({ page }) => {
  await openStep1(page);
  await openStep(page, /ViewModel/, 4);

  await restartApp(page);
  await expect(page.getByText('Step 4 of 8')).toBeVisible();
  await expect(
    page.getByRole('heading', { level: 1, name: 'ViewModel: queue instead of upload' }),
  ).toBeVisible();
  await expect(stepsList(page).getByRole('button', { name: /ViewModel/ })).toHaveAttribute(
    'aria-current',
    'step',
  );
});

test('F-04.3 after a restart S-03 keeps the layout you chose', async ({ page }) => {
  await openStep1(page);
  await openStep(page, /ViewModel/, 4);
  await page.keyboard.press('Control+2');
  const toolbar = page.getByRole('toolbar', { name: 'Step navigation' });
  await expect(toolbar).toContainText('Step 4 of 8');

  await restartApp(page);
  await expect(toolbar).toContainText('Step 4 of 8');
  await expect(stepsList(page)).toHaveCount(0);

  // The last choice wins, also over a second restart.
  await page.keyboard.press('Control+3');
  const guide = page.getByRole('complementary', { name: 'Guide' });
  await expect(guide.getByText('Worth a look')).toBeVisible();
  await restartApp(page);
  await expect(guide.getByText('Worth a look')).toBeVisible();
  await expect(toolbar).toHaveCount(0);
  await expect(stepsList(page)).toHaveCount(0);
});

test('F-04.3 after a restart each step reopens at its own scroll position', async ({ page }) => {
  await openStep1(page);
  await openStep(page, /ViewModel/, 4);
  await mainOf(page).evaluate((el) => {
    el.scrollTop = 120;
  });
  await page.waitForTimeout(SCROLL_SAVED_MS);
  await openStep(page, /SqliteUploadQueue/, 2);
  await mainOf(page).evaluate((el) => {
    el.scrollTop = 300;
  });

  await restartApp(page, SCROLL_SAVED_MS);
  await expect(page.getByText('Step 2 of 8')).toBeVisible();
  await expect.poll(() => scrollTopOf(page)).toBe(300);
  await openStep(page, /ViewModel/, 4);
  await expect.poll(() => scrollTopOf(page)).toBe(120);
  // A step that was never scrolled opens at the top.
  await openStep(page, /Queue contract/, 1);
  await expect.poll(() => scrollTopOf(page)).toBe(0);
});

test('F-04.3 after a restart the note decisions are still on the notes', async ({ page }) => {
  await openStep1(page);
  await openStep(page, /ViewModel/, 4);
  await page.getByRole('button', { name: `Note 2: ${SECOND}` }).click();
  const drafted = page.getByRole('article', { name: `Claude note: ${SECOND}` });
  await drafted.getByRole('button', { name: 'Add to drafts' }).click();
  await expect(drafted.getByText(/Added to drafts\./)).toBeVisible();
  await page.getByRole('button', { name: `Note 1: ${FIRST}` }).click();
  const dismissed = page.getByRole('article', { name: `Claude note: ${FIRST}` });
  await dismissed.getByRole('button', { name: 'Dismiss' }).click();
  await expect(
    dismissed.getByText("Dismissed. Claude won't raise it again for this commit."),
  ).toBeVisible();
  await expect(page.getByText('2 notes')).toBeVisible();

  await restartApp(page);
  await expect(page.getByText('Step 4 of 8')).toBeVisible();
  await expect(page.getByText('2 notes')).toBeVisible();
  await page.getByRole('button', { name: `Note 2: ${SECOND}` }).click();
  await expect(
    drafted.getByText('Added to drafts. It reaches GitLab only when you publish.'),
  ).toBeVisible();
  await page.getByRole('button', { name: `Note 1: ${FIRST}` }).click();
  await expect(
    dismissed.getByText("Dismissed. Claude won't raise it again for this commit."),
  ).toBeVisible();

  // A decision made before the restart can be taken back after it.
  await dismissed.getByRole('button', { name: 'Undo' }).click();
  await expect(dismissed.getByRole('button', { name: 'Add to drafts' })).toBeVisible();
  await expect(page.getByText('3 notes')).toBeVisible();
});
