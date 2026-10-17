import { expect, test, type Page } from '@playwright/test';
import { openStep, openStep1, restartApp } from './stepHelpers';

// F-12.5 against the mock backend (SummaryDesk.dc.html): Publish (N) on the Drafts tab of S-05 of
// an MR session (!482). One click publishes the ticked drafts (and the summary comment) in one
// batch; afterwards the blue banner "Published N comments and a summary. The author got a single
// notification." (role status), every sent row reads "file:line · published" and the button reads
// "Published" on the grey fill of the mock. M5 decision 9: a partial failure says "Published 3 of
// 4. 1 failed: <reason>." with Retry, the failed row keeps its tick and shows its reason, Retry
// sends only that row. M5 decision 8: a yellow banner for the draft comments already in GitLab's
// own review, Publish stays available. The mock backend's scenario knobs: `publishFails` (1-based
// places of the drafts whose first publish fails) and `foreignDrafts`, both in MOCK_GITLAB_KEY.
// Not tried in the real app (stand-in GitLab, SQLite, real positions).

const GITLAB_KEY = 'guided-review.mock.gitlab';
const SINGLE = 'The author got a single notification.';
const SUGGESTED = 'Suggested by Claude, edit as you like';
const LINE_GONE = 'the line is no longer in the MR';

const BLUE = 'rgb(63, 124, 242)';
const YELLOW = 'rgb(247, 207, 61)';
const INK = 'rgb(16, 16, 16)';
const GREY_FILL = 'rgb(38, 38, 38)';
const GREY_TEXT = 'rgb(126, 126, 121)';

/** The suggested comments of the notes on step 4 (src/ipc/mock/fixtures/review.ts), nothing else. */
const NOTES = [
  { title: 'The whole photo goes into SQLite as byte[]', n: 1 },
  { title: 'PendingCount won’t refresh after upload', n: 2 },
  { title: 'Status texts are hardcoded', n: 3 },
] as const;

const finishReview = (page: Page) =>
  page.getByTestId('title-bar').getByRole('button', { name: 'Finish review' });
const panel = (page: Page) => page.getByRole('tabpanel');
const rows = (page: Page) => panel(page).getByRole('listitem');
const row = (page: Page, n: number) => rows(page).nth(n - 1);
const box = (page: Page, n: number) =>
  row(page, n).getByRole('checkbox', { name: `Publish comment ${String(n)}`, exact: true });
const publish = (page: Page, name: string) => page.getByRole('button', { name, exact: true });
const banner = (page: Page, text: string) => page.getByRole('status').filter({ hasText: text });

async function setScenario(page: Page, scenario: object) {
  await page.addInitScript(
    ([key, value]) => {
      window.localStorage.setItem(key, value);
    },
    [GITLAB_KEY, JSON.stringify(scenario)] as [string, string],
  );
}

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

/** Four drafts (the three notes of step 4 and a line comment), then Finish review: S-05 Drafts. */
async function openDrafts(page: Page) {
  await openStep1(page);
  await openStep(page, /ViewModel/, 4);
  for (const note of NOTES) await addDraftOf(page, note);
  await addLineComment(page, 'Please cap the retries.');
  await finishReview(page).click();
  await expect(page.getByRole('heading', { name: /^summary$/i })).toBeVisible();
  await expect(rows(page)).toHaveCount(4);
}

/** Whether the element or one of its ancestors is filled with `color` (the banner's own box). */
function onFill(target: ReturnType<Page['locator']>, color: string) {
  return target.evaluate((element, wanted) => {
    for (let el: Element | null = element; el; el = el.parentElement) {
      if (getComputedStyle(el).backgroundColor === wanted) return true;
    }
    return false;
  }, color);
}

function paint(target: ReturnType<Page['locator']>, property: 'backgroundColor' | 'color') {
  return target.evaluate((element, name) => getComputedStyle(element)[name], property);
}

test('F-12.5 Publish (4) publishes the drafts and the summary in one click: blue banner, rows marked published, button Published', async ({
  page,
}) => {
  await openDrafts(page);
  await panel(page).getByRole('checkbox', { name: 'Add a summary comment', exact: true }).click();
  await expect(panel(page).getByRole('textbox', { name: SUGGESTED })).not.toHaveValue('');

  const button = publish(page, 'Publish (4)');
  await expect(button).toBeEnabled();
  expect(await paint(button, 'backgroundColor')).toBe(BLUE);
  expect(await paint(button, 'color')).toBe(INK);
  await expect(banner(page, 'Published')).toHaveCount(0);

  await button.click();

  const sent = banner(page, `Published 4 comments and a summary. ${SINGLE}`);
  await expect(sent).toBeVisible();
  expect(await paint(sent, 'backgroundColor')).toBe(BLUE);
  expect(await paint(sent, 'color')).toBe(INK);
  for (const n of [1, 2, 3, 4]) {
    await expect(row(page, n)).toContainText('· published');
    await expect(box(page, n)).toBeChecked();
    await expect(box(page, n)).toBeDisabled();
    await expect(row(page, n).getByRole('button', { name: /^Edit comment/ })).toHaveCount(0);
  }
  await expect(panel(page).getByText('Published to GitLab.')).toBeVisible();
  const done = publish(page, 'Published');
  await expect(done).toBeDisabled();
  expect(await paint(done, 'backgroundColor')).toBe(GREY_FILL);
  expect(await paint(done, 'color')).toBe(GREY_TEXT);

  // What was published stays published after the app starts again.
  await restartApp(page);
  await expect(rows(page)).toHaveCount(4);
  for (const n of [1, 2, 3, 4]) await expect(row(page, n)).toContainText('· published');
  await expect(publish(page, 'Published')).toBeDisabled();
});

test('F-12.5 Publish (N) counts the ticked drafts only, the summary comment is not counted, and the Threads tab has no Publish', async ({
  page,
}) => {
  await openDrafts(page);
  await expect(publish(page, 'Publish (4)')).toBeVisible();
  await box(page, 3).click();
  await expect(publish(page, 'Publish (3)')).toBeVisible();
  await panel(page).getByRole('checkbox', { name: 'Add a summary comment', exact: true }).click();
  await expect(panel(page).getByRole('textbox', { name: SUGGESTED })).not.toHaveValue('');
  await expect(publish(page, 'Publish (3)')).toBeVisible();

  await page.getByRole('tab', { name: /^Threads/ }).click();
  await expect(page.getByRole('button', { name: /^Publish \(/ })).toHaveCount(0);
  await page.getByRole('tab', { name: /^Drafts/ }).click();
  await expect(publish(page, 'Publish (3)')).toBeVisible();

  await publish(page, 'Publish (3)').click();
  await expect(banner(page, `Published 3 comments and a summary. ${SINGLE}`)).toBeVisible();
  await expect(row(page, 3)).not.toContainText('published');
  await expect(box(page, 3)).toBeEnabled();
});

test('F-12.5 a partial failure says how many went out and why, the failed row keeps its tick, and Retry sends only it', async ({
  page,
}) => {
  await setScenario(page, { publishFails: [2] });
  await openDrafts(page);

  await publish(page, 'Publish (4)').click();

  const failed = banner(page, `Published 3 of 4. 1 failed: ${LINE_GONE}.`);
  await expect(failed).toBeVisible();
  await expect(banner(page, SINGLE)).toHaveCount(0);
  await expect(row(page, 2).getByText(LINE_GONE, { exact: true })).toBeVisible();
  await expect(row(page, 2)).not.toContainText('· published');
  await expect(box(page, 2)).toBeChecked();
  await expect(box(page, 2)).toBeEnabled();
  for (const n of [1, 3, 4]) await expect(row(page, n)).toContainText('· published');

  await failed.getByRole('button', { name: 'Retry' }).click();

  await expect(banner(page, `Published 1 comment. ${SINGLE}`)).toBeVisible();
  await expect(row(page, 2)).toContainText('· published');
  await expect(row(page, 2).getByText(LINE_GONE)).toHaveCount(0);
  await expect(publish(page, 'Published')).toBeDisabled();
});

test("F-12.5 a yellow banner counts the draft comments in GitLab's own review, Publish stays available and sends them too", async ({
  page,
}) => {
  await setScenario(page, { foreignDrafts: 2 });
  await openDrafts(page);

  const warning = page.getByText(
    "You have 2 draft comments in GitLab's own review. Publishing here sends them too.",
  );
  await expect(warning).toBeVisible();
  expect(await onFill(warning, YELLOW)).toBe(true);
  await expect(publish(page, 'Publish (4)')).toBeEnabled();

  await publish(page, 'Publish (4)').click();

  await expect(banner(page, `Published 4 comments. ${SINGLE}`)).toBeVisible();
  await expect(page.getByText(/in GitLab's own review/)).toHaveCount(0);
});
