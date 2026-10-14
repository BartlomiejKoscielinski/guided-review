import { expect, test, type Page } from '@playwright/test';
import { openStep, openStep1, restartApp, stepsList } from './stepHelpers';

// S-03 layout A against the mock backend, part 1 (M3 plan › 3e): step 1 from the plan, the steps
// list, the step's diff with its fold, notes, thread, and a decision with Undo (F-09.2).

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
// core keeps it in SQLite, so reloading the page is starting the app again (`restartApp`).

/** A scroll position is written debounced, within this time. */
const SCROLL_SAVED_MS = 2000;

const mainOf = (page: Page) => page.locator('main[class*="main"]').first();
const scrollTopOf = (page: Page) => mainOf(page).evaluate((el) => el.scrollTop);

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

test('F-07.9 a new session starts in the layout you chose last, also after a restart', async ({
  page,
}) => {
  await openStep1(page);
  await page.keyboard.press('Control+3');
  const guide = page.getByRole('complementary', { name: 'Guide' });
  await expect(guide.getByText('Worth a look')).toBeVisible();

  // After a restart S-03 is back in C; Ctrl+K › !482 again opens a second session: it starts in C,
  // not in the default A.
  await restartApp(page);
  await expect(guide.getByText('Worth a look')).toBeVisible();
  await page.keyboard.press('Control+k');
  const source = page.getByLabel(/Paste a merge request link/);
  await source.fill('!482');
  await expect(page.getByText('Merge request !482', { exact: true })).toBeVisible();
  await source.press('Enter');
  await page.getByRole('button', { name: /Start step 1/ }).click();
  await expect(guide.getByText('Worth a look')).toBeVisible();
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

test('F-09.1 step 4: every note shows its severity word, title and body under its own line, with the suggested comment behind Edit and add', async ({
  page,
}) => {
  await openStep1(page);
  await openStep(page, /ViewModel/, 4);
  const notes = [
    {
      title: 'The whole photo goes into SQLite as byte[]',
      word: 'Question',
      line: 'var upload = new PendingUpload(DeliveryId, bytes, DateTimeOffset.UtcNow);',
      body: 'A camera photo is usually several MB, so during a long offline period the database grows fast.',
      comment:
        'Did we consider saving the file in FileSystem.AppDataDirectory and keeping only the path in the queue?',
    },
    {
      title: 'PendingCount won’t refresh after upload',
      word: 'Should fix',
      line: 'PendingCount = await _queue.CountAsync();',
      body: 'UploadWorker from step 3 removes items from the queue but never notifies the ViewModel',
      comment:
        'Could IUploadQueue publish changes (an event or WeakReferenceMessenger) so the ViewModel refreshes PendingCount after each upload?',
    },
    {
      title: 'Status texts are hardcoded',
      word: 'Minor',
      line: '? "Wysyłanie…"',
      body: 'Keys for these texts already exist in Strings.resx',
      comment: 'Nit: take StatusText from AppResources, the keys are already in Strings.resx.',
    },
    {
      title: 'catch (Exception) also catches camera cancellation',
      word: 'Should fix',
      line: 'catch (Exception ex)',
      body: 'When the user closes the camera, CaptureAsync throws OperationCanceledException.',
      comment:
        'Consider a separate catch (OperationCanceledException) without a message. Closing the camera isn’t a save error.',
    },
  ];
  for (const [i, note] of notes.entries()) {
    await page.getByRole('button', { name: `Note ${String(i + 1)}: ${note.title}` }).click();
    const card = page.getByRole('article', { name: `Claude note: ${note.title}` });
    await expect(card.getByText(note.word, { exact: true })).toBeVisible();
    await expect(card.getByText(note.title, { exact: true })).toBeVisible();
    await expect(card).toContainText(note.body);
    // The card sits in a row of its own right under the line the note names.
    const above = card.locator(
      'xpath=ancestor::*[@data-index][1]/preceding-sibling::*[@data-index][1]',
    );
    await expect(above).toContainText(note.line);

    await card.getByRole('button', { name: 'More' }).click();
    await page.getByRole('menuitem', { name: 'Edit and add' }).click();
    await expect(card.getByRole('textbox', { name: 'Suggested comment' })).toHaveValue(
      note.comment,
    );
    await card.getByRole('button', { name: 'Cancel' }).click();
  }
});
