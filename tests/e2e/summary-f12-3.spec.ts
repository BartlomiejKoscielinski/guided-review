import { expect, test, type Locator, type Page } from '@playwright/test';
import { openStep, openStep1, restartApp } from './stepHelpers';

// F-12.3 against the mock backend (SummaryDesk.dc.html): the Drafts tab of S-05 of an MR session
// (!482). The note "Only you can see drafts until you publish them.", then one row per draft:
// blue checkbox "Publish comment N", the 12px severity square, the text, file:line in mono and the
// pencil "Edit comment N". M5 decision 6: no square without a severity, the pencil edits in place
// (Save, Cancel, Ctrl+Enter, Esc). The drafts are made the way a reviewer makes them: Add to drafts
// on the notes of step 4 and a comment on a line. Published rows can't be reached here (Publish is
// F-12.5), so they are covered in Vitest. Not tried in the real app (stand-in GitLab, SQLite).

const NOTE = 'Only you can see drafts until you publish them.';

/** The suggested comments of the notes on step 4 (src/ipc/mock/fixtures/review.ts), nothing else. */
const NOTES = [
  {
    title: 'The whole photo goes into SQLite as byte[]',
    n: 1,
    word: 'Question',
    text: 'Did we consider saving the file in FileSystem.AppDataDirectory and keeping only the path in the queue?',
    loc: 'DeliveryPhotoViewModel.cs:46',
  },
  {
    title: 'PendingCount won’t refresh after upload',
    n: 2,
    word: 'Should fix',
    text: 'Could IUploadQueue publish changes (an event or WeakReferenceMessenger) so the ViewModel refreshes PendingCount after each upload?',
    loc: 'DeliveryPhotoViewModel.cs:49',
  },
  {
    title: 'Status texts are hardcoded',
    n: 3,
    word: 'Minor',
    text: 'Nit: take StatusText from AppResources, the keys are already in Strings.resx.',
    loc: 'DeliveryPhotoViewModel.cs:51',
  },
] as const;

const ORANGE = 'rgb(239, 110, 46)';
const BLUE = 'rgb(63, 124, 242)';

const finishReview = (page: Page) =>
  page.getByTestId('title-bar').getByRole('button', { name: 'Finish review' });
const panel = (page: Page) => page.getByRole('tabpanel');
const rows = (page: Page) => panel(page).getByRole('listitem');
const row = (page: Page, n: number) => rows(page).nth(n - 1);
const box = (page: Page, n: number) =>
  row(page, n).getByRole('checkbox', { name: `Publish comment ${String(n)}`, exact: true });
const pencil = (page: Page, n: number) =>
  row(page, n).getByRole('button', { name: `Edit comment ${String(n)}`, exact: true });
/** The square of a row: the parent of the severity word it hides. */
const square = (page: Page, n: number, word: string) =>
  row(page, n).getByText(word, { exact: true }).locator('xpath=..');

async function openViewModelStep(page: Page) {
  await openStep1(page);
  await openStep(page, /ViewModel/, 4);
  await expect(page.getByRole('button', { name: `Note 2: ${NOTES[1].title}` })).toBeVisible();
}

/** Add to drafts on one note of step 4. */
async function addDraftOf(page: Page, note: (typeof NOTES)[number]) {
  await page.getByRole('button', { name: `Note ${String(note.n)}: ${note.title}` }).click();
  const card = page.getByRole('article', { name: `Claude note: ${note.title}` });
  await card.getByRole('button', { name: 'Add to drafts' }).click();
  await expect(card.getByText(/Added to drafts\./)).toBeVisible();
}

/** A comment on lines 47 to 50 of step 4's diff: a draft on L50 with no severity (F-09.7). */
async function addLineComment(page: Page, text: string) {
  const line = (no: number) => page.locator(`[data-kind="add"] [data-line-no="${String(no)}"]`);
  await expect(line(47)).toBeVisible();
  await line(47).click();
  await line(50).click({ modifiers: ['Shift'] });
  await page
    .getByRole('group', { name: 'Selected lines' })
    .getByRole('button', { name: 'Comment' })
    .click();
  const card = page.getByRole('article', { name: 'Comment on L50' });
  await card.getByRole('textbox', { name: 'Comment' }).fill(text);
  await card.getByRole('button', { name: 'Add to drafts' }).click();
  await expect(card).toContainText('Added to drafts.');
}

/** The first of the element and its descendants painted `color` (background or accent-color). */
function paintedWith(target: Locator, color: string): Promise<boolean> {
  return target.evaluate((element, wanted) => {
    const all = [element, ...Array.from(element.querySelectorAll('*'))];
    return all.some((el) => {
      const style = getComputedStyle(el);
      return style.backgroundColor === wanted || style.accentColor === wanted;
    });
  }, color);
}

/** How many descendants are a filled 12 by 12 square, the size of the severity square. */
function filledSquares(target: Locator): Promise<number> {
  return target.evaluate((element) => {
    return Array.from(element.querySelectorAll('*')).filter((el) => {
      const rect = el.getBoundingClientRect();
      const bg = getComputedStyle(el).backgroundColor;
      const filled = bg !== 'rgba(0, 0, 0, 0)' && bg !== 'transparent';
      return Math.round(rect.width) === 12 && Math.round(rect.height) === 12 && filled;
    }).length;
  });
}

async function x(target: Locator): Promise<number> {
  const found = await target.boundingBox();
  if (!found) throw new Error('not visible');
  return found.x;
}

test('F-12.3 SUMMARY opens on Drafts with the note and one row per draft: blue checkbox, severity square, text, file:line, pencil', async ({
  page,
}) => {
  await openViewModelStep(page);
  for (const note of NOTES) await addDraftOf(page, note);
  await finishReview(page).click();

  await expect(page.getByRole('tab', { name: 'Drafts 3' })).toHaveAttribute(
    'aria-selected',
    'true',
  );
  await expect(panel(page).getByText(NOTE)).toBeVisible();
  await expect(rows(page)).toHaveCount(3);

  for (const note of NOTES) {
    const r = row(page, note.n);
    await expect(r.getByText(note.text, { exact: true })).toBeVisible();
    await expect(r).toContainText(note.loc);
    await expect(box(page, note.n)).toBeChecked();
    await expect(pencil(page, note.n)).toBeVisible();
    await expect(pencil(page, note.n)).toHaveAttribute('title', 'Edit');
    expect(await paintedWith(box(page, note.n), BLUE)).toBe(true);
    expect(await filledSquares(r)).toBe(1);
    // Left to right as in the mock: checkbox, square, text, pencil.
    const xs = [
      await x(box(page, note.n)),
      await x(square(page, note.n, note.word)),
      await x(r.getByText(note.text, { exact: true })),
      await x(pencil(page, note.n)),
    ];
    expect([...xs].sort((a, b) => a - b)).toEqual(xs);
    expect(new Set(xs).size).toBe(4);
  }
  // Rows are in the order the drafts were made, one under the other.
  const tops = await rows(page).evaluateAll((all) =>
    all.map((el) => el.getBoundingClientRect().top),
  );
  expect([...tops].sort((a, b) => a - b)).toEqual(tops);
});

test('F-12.3 the square follows the severity: orange Should fix, blue Question, gray Minor; a line comment has none', async ({
  page,
}) => {
  await openViewModelStep(page);
  for (const note of NOTES) await addDraftOf(page, note);
  await addLineComment(page, 'Is the worker started before the first Kick?');
  await finishReview(page).click();
  await expect(rows(page)).toHaveCount(4);

  const question = square(page, 1, 'Question');
  const fix = square(page, 2, 'Should fix');
  const minor = square(page, 3, 'Minor');
  await expect(question).toHaveCSS('background-color', BLUE);
  await expect(fix).toHaveCSS('background-color', ORANGE);
  for (const target of [question, fix, minor]) {
    const size = await target.boundingBox();
    expect(Math.round(size?.width ?? 0)).toBe(12);
    expect(Math.round(size?.height ?? 0)).toBe(12);
  }
  // Minor is the gray of the notes' gutter (the mock's #6E6E69 is not a token): no hue, mid-bright.
  const [r, g, b] = (await minor.evaluate((el) => getComputedStyle(el).backgroundColor))
    .match(/\d+/g)
    ?.map(Number) ?? [0, 0, 0];
  expect(Math.max(r ?? 0, g ?? 0, b ?? 0) - Math.min(r ?? 0, g ?? 0, b ?? 0)).toBeLessThanOrEqual(
    8,
  );
  expect(g ?? 0).toBeGreaterThan(90);
  expect(g ?? 0).toBeLessThan(170);

  // The comment on a line has its position, the text, a ticked checkbox and no square at all.
  const comment = row(page, 4);
  await expect(comment).toContainText('DeliveryPhotoViewModel.cs:50');
  await expect(comment).toContainText('Is the worker started before the first Kick?');
  await expect(box(page, 4)).toBeChecked();
  await expect(pencil(page, 4)).toBeVisible();
  expect(await filledSquares(comment)).toBe(0);
  expect(await filledSquares(row(page, 3))).toBe(1);
});

test('F-12.3 the rows are drawn as in the mock: panel fill, 15px text, 11.5px mono location, 13.5px muted note, 32px pencil', async ({
  page,
}) => {
  await openViewModelStep(page);
  await addDraftOf(page, NOTES[1]);
  await finishReview(page).click();
  const r = row(page, 1);

  await expect(panel(page).getByText(NOTE)).toHaveCSS('font-size', '13.5px');
  await expect(panel(page).getByText(NOTE)).toHaveCSS('color', 'rgb(140, 140, 135)');
  await expect(r).toHaveCSS('background-color', 'rgb(20, 20, 20)');
  await expect(r).toHaveCSS('border-top-width', '0px');
  await expect(r).toHaveCSS('border-radius', '0px');
  await expect(r).toHaveCSS('opacity', '1');
  const text = r.getByText(NOTES[1].text, { exact: true });
  await expect(text).toHaveCSS('font-size', '15px');
  await expect(text).toHaveCSS('color', 'rgb(244, 244, 242)');
  const loc = r.getByText(NOTES[1].loc);
  await expect(loc).toHaveCSS('font-family', /JetBrains Mono/);
  await expect(loc).toHaveCSS('font-size', '11.5px');
  await expect(loc).toHaveCSS('color', 'rgb(140, 140, 135)');
  // The file name is shown, the full path is in the title.
  await expect(loc).toHaveAttribute(
    'title',
    /src\/Mobile\.App\/ViewModels\/DeliveryPhotoViewModel\.cs/,
  );
  const edit = await pencil(page, 1).boundingBox();
  expect(Math.round(edit?.width ?? 0)).toBe(32);
  expect(Math.round(edit?.height ?? 0)).toBe(32);
  await expect(pencil(page, 1)).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)');
  await expect(pencil(page, 1)).toHaveCSS('border-top-width', '0px');
});

test('F-12.3 unticking a draft dims its row; the choice is kept after the app starts again', async ({
  page,
}) => {
  await openViewModelStep(page);
  await addDraftOf(page, NOTES[0]);
  await addDraftOf(page, NOTES[1]);
  await finishReview(page).click();
  await expect(row(page, 1)).toHaveCSS('opacity', '1');

  await box(page, 1).click();
  await expect(box(page, 1)).not.toBeChecked();
  await expect(row(page, 1)).toHaveCSS('opacity', '0.5');
  await expect(box(page, 2)).toBeChecked();
  await expect(row(page, 2)).toHaveCSS('opacity', '1');
  // An unticked draft is still a draft: the tab counts it and the pencil stays.
  await expect(page.getByRole('tab', { name: 'Drafts 2' })).toBeVisible();
  await expect(pencil(page, 1)).toBeVisible();

  await restartApp(page);
  await expect(rows(page)).toHaveCount(2);
  await expect(box(page, 1)).not.toBeChecked();
  await expect(row(page, 1)).toHaveCSS('opacity', '0.5');
  await expect(box(page, 2)).toBeChecked();

  await box(page, 1).click();
  await expect(box(page, 1)).toBeChecked();
  await expect(row(page, 1)).toHaveCSS('opacity', '1');
});

test('F-12.3 the pencil edits in place: Ctrl+Enter saves the new text, which is still there after a restart', async ({
  page,
}) => {
  await openViewModelStep(page);
  await addDraftOf(page, NOTES[1]);
  await finishReview(page).click();
  const r = row(page, 1);
  await expect(r.getByRole('textbox')).toHaveCount(0);

  await pencil(page, 1).click();
  const editor = r.getByRole('textbox');
  await expect(editor).toBeFocused();
  await expect(editor).toHaveValue(NOTES[1].text);
  await expect(r.getByRole('button', { name: 'Save', exact: true })).toBeEnabled();
  await expect(r.getByRole('button', { name: 'Cancel', exact: true })).toBeEnabled();
  // The location and the checkbox stay while the text is edited.
  await expect(r).toContainText(NOTES[1].loc);
  await expect(box(page, 1)).toBeVisible();

  await editor.fill('Let IUploadQueue raise Changed, and refresh PendingCount in the ViewModel.');
  await page.keyboard.press('Control+Enter');
  await expect(r.getByRole('textbox')).toHaveCount(0);
  await expect(
    r.getByText('Let IUploadQueue raise Changed, and refresh PendingCount in the ViewModel.', {
      exact: true,
    }),
  ).toBeVisible();
  await expect(r.getByText(NOTES[1].text, { exact: true })).toHaveCount(0);
  await expect(pencil(page, 1)).toBeFocused();
  await expect(box(page, 1)).toBeChecked();

  await restartApp(page);
  await expect(
    row(page, 1).getByText(
      'Let IUploadQueue raise Changed, and refresh PendingCount in the ViewModel.',
      {
        exact: true,
      },
    ),
  ).toBeVisible();
});

test('F-12.3 Esc and Cancel leave the text as it was; Save is off for a blank text', async ({
  page,
}) => {
  await openViewModelStep(page);
  await addDraftOf(page, NOTES[1]);
  await finishReview(page).click();
  const r = row(page, 1);

  await pencil(page, 1).click();
  await r.getByRole('textbox').fill('Throw this away.');
  await page.keyboard.press('Escape');
  await expect(r.getByRole('textbox')).toHaveCount(0);
  await expect(r.getByText(NOTES[1].text, { exact: true })).toBeVisible();
  await expect(r.getByText('Throw this away.')).toHaveCount(0);
  await expect(pencil(page, 1)).toBeFocused();
  // Esc closed the editor only: the summary is still open.
  await expect(panel(page).getByText(NOTE)).toBeVisible();

  await pencil(page, 1).click();
  await r.getByRole('textbox').fill('And this.');
  await r.getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(r.getByRole('textbox')).toHaveCount(0);
  await expect(r.getByText(NOTES[1].text, { exact: true })).toBeVisible();

  await pencil(page, 1).click();
  await r.getByRole('textbox').fill('   ');
  await expect(r.getByRole('button', { name: 'Save', exact: true })).toBeDisabled();
  await page.keyboard.press('Control+Enter');
  await expect(r.getByRole('textbox')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(r.getByText(NOTES[1].text, { exact: true })).toBeVisible();
});

test('F-12.3 the list is reachable by keyboard: Space ticks, Tab leads from the checkbox to the pencil, Enter opens the editor', async ({
  page,
}) => {
  await openViewModelStep(page);
  await addDraftOf(page, NOTES[0]);
  await addDraftOf(page, NOTES[1]);
  await finishReview(page).click();
  await expect(rows(page)).toHaveCount(2);

  await box(page, 2).focus();
  await page.keyboard.press('Space');
  await expect(box(page, 2)).not.toBeChecked();
  await page.keyboard.press('Space');
  await expect(box(page, 2)).toBeChecked();

  await page.keyboard.press('Tab');
  await expect(pencil(page, 2)).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(row(page, 2).getByRole('textbox')).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(pencil(page, 2)).toBeFocused();

  // The first row is not touched by any of it.
  await expect(box(page, 1)).toBeChecked();
  await expect(row(page, 1).getByRole('textbox')).toHaveCount(0);
});

test('F-12.3 the Threads tab shows no note and no drafts, and Drafts brings them back', async ({
  page,
}) => {
  await openViewModelStep(page);
  await addDraftOf(page, NOTES[1]);
  await finishReview(page).click();
  await expect(panel(page).getByText(NOTE)).toBeVisible();

  await page.getByRole('tab', { name: 'Threads 3 open' }).click();
  await expect(page.getByText(NOTE)).toHaveCount(0);
  await expect(page.getByText(NOTES[1].text, { exact: true })).toHaveCount(0);

  await page.getByRole('tab', { name: 'Drafts 1' }).click();
  await expect(panel(page).getByText(NOTE)).toBeVisible();
  await expect(row(page, 1).getByText(NOTES[1].text, { exact: true })).toBeVisible();
});
