import { expect, test, type Page } from '@playwright/test';
import { openStep, openStep1, restartApp } from './stepHelpers';

// F-13.1 against the mock backend (SummaryDesk.dc.html): the Threads tab of S-05 of an MR session
// (!482) has the filters All / Open N / Resolved N as a group "Thread filter" of buttons with
// aria-pressed, in the tab bar's row to the right of the tabs; below, the resolvable threads by
// their first message. The mock backend has three open threads and none resolved, so a fresh
// summary reads "Open 3" and "Resolved 0"; resolving the thread at line 48 on step 4 makes it
// "Open 2" and "Resolved 1". The pick starts on All, is kept when the user goes to Drafts and
// back, and ends with the screen. "No threads in this view." stands in the list for an empty pick.
// Not tried in the real app (stand-in GitLab): the mock backend answers the threads here.

const NOTE = 'PendingCount won’t refresh after upload';
const SEMAPHORE = 'Kick only releases a semaphore, the upload runs in the background.';
/** The first messages of !482's three threads, as the list shows them (one thread per line). */
const TABLE = 'Is the table created on every start?';
const ATTEMPTS = 'What happens to a photo that keeps failing?';
const KICK = 'Kick() is called on the UI thread. Does the worker block anything here?';
const THREADS = [TABLE, ATTEMPTS, KICK] as const;
const EMPTY = 'No threads in this view.';

const finishReview = (page: Page) =>
  page.getByTestId('title-bar').getByRole('button', { name: 'Finish review' });
const backToSteps = (page: Page) => page.getByRole('button', { name: 'Back to steps' });
const tablist = (page: Page) => page.getByRole('tablist', { name: 'Comments', exact: true });
const tab = (page: Page, name: string) => tablist(page).getByRole('tab', { name, exact: true });
const group = (page: Page) => page.getByRole('group', { name: 'Thread filter', exact: true });
const filter = (page: Page, name: string) => group(page).getByRole('button', { name, exact: true });
const panel = (page: Page) => page.getByRole('tabpanel');
const thread = (page: Page, line: number) =>
  page.getByRole('region', { name: `Thread at line ${String(line)}`, exact: true });

/** Exactly these of the three threads are in the list. */
async function expectListed(page: Page, shown: readonly string[]) {
  for (const text of THREADS) {
    if (shown.includes(text)) await expect(panel(page).getByText(text)).toBeVisible();
    else await expect(panel(page).getByText(text)).toHaveCount(0);
  }
}

/** S-03 on step 4 (ViewModel) of !482, where the thread at line 48 is. */
async function openViewModelStep(page: Page) {
  await openStep1(page);
  await openStep(page, /ViewModel/, 4);
  await expect(thread(page, 48)).toContainText(SEMAPHORE);
}

/** Resolve the thread at line 48 on step 4, then Finish review: S-05 on Threads. */
async function resolveKickThenSummary(page: Page) {
  await openViewModelStep(page);
  await thread(page, 48).getByRole('button', { name: 'Resolve', exact: true }).click();
  await expect(thread(page, 48).getByText('Resolved', { exact: true })).toBeVisible();
  await finishReview(page).click();
  await expect(tab(page, 'Threads 2 open')).toHaveAttribute('aria-selected', 'true');
}

test('F-13.1 Finish review of a session without drafts opens Threads with the filters All, Open 3 and Resolved 0, All pressed, and the three threads listed', async ({
  page,
}) => {
  await openStep1(page);
  await finishReview(page).click();

  await expect(tab(page, 'Threads 3 open')).toHaveAttribute('aria-selected', 'true');
  await expect(group(page)).toBeVisible();
  await expect(group(page).getByRole('button')).toHaveText(['All', 'Open 3', 'Resolved 0']);
  await expect(filter(page, 'All')).toHaveAttribute('aria-pressed', 'true');
  await expect(filter(page, 'Open 3')).toHaveAttribute('aria-pressed', 'false');
  await expect(filter(page, 'Resolved 0')).toHaveAttribute('aria-pressed', 'false');
  await expectListed(page, THREADS);
  await expect(page.getByText(EMPTY)).toHaveCount(0);
});

test('F-13.1 Resolved 0 says "No threads in this view." and Open 3 and All list the three threads again', async ({
  page,
}) => {
  await openStep1(page);
  await finishReview(page).click();
  await expect(filter(page, 'All')).toHaveAttribute('aria-pressed', 'true');

  await filter(page, 'Resolved 0').click();
  await expect(filter(page, 'Resolved 0')).toHaveAttribute('aria-pressed', 'true');
  await expect(filter(page, 'All')).toHaveAttribute('aria-pressed', 'false');
  await expect(panel(page).getByText(EMPTY)).toBeVisible();
  await expectListed(page, []);

  await filter(page, 'Open 3').click();
  await expect(filter(page, 'Open 3')).toHaveAttribute('aria-pressed', 'true');
  await expect(filter(page, 'Resolved 0')).toHaveAttribute('aria-pressed', 'false');
  await expect(page.getByText(EMPTY)).toHaveCount(0);
  await expectListed(page, THREADS);

  await filter(page, 'Resolved 0').click();
  await expect(panel(page).getByText(EMPTY)).toBeVisible();
  await filter(page, 'All').click();
  await expect(page.getByText(EMPTY)).toHaveCount(0);
  await expectListed(page, THREADS);
});

test('F-13.1 resolving the thread on step 4 makes the summary read Open 2 and Resolved 1: Resolved lists it alone, Open the other two; Reopen brings back Open 3 and Resolved 0', async ({
  page,
}) => {
  await resolveKickThenSummary(page);
  await expect(group(page).getByRole('button')).toHaveText(['All', 'Open 2', 'Resolved 1']);
  await expectListed(page, THREADS);

  await filter(page, 'Resolved 1').click();
  await expect(filter(page, 'Resolved 1')).toHaveAttribute('aria-pressed', 'true');
  await expectListed(page, [KICK]);

  await filter(page, 'Open 2').click();
  await expect(filter(page, 'Open 2')).toHaveAttribute('aria-pressed', 'true');
  await expect(filter(page, 'Resolved 1')).toHaveAttribute('aria-pressed', 'false');
  await expectListed(page, [TABLE, ATTEMPTS]);
  // The numbers do not follow the pick.
  await expect(group(page).getByRole('button')).toHaveText(['All', 'Open 2', 'Resolved 1']);

  await backToSteps(page).click();
  await expect(thread(page, 48)).toContainText(SEMAPHORE);
  await thread(page, 48).getByRole('button', { name: 'Reopen', exact: true }).click();
  await expect(thread(page, 48).getByText('Resolved', { exact: true })).toHaveCount(0);
  await finishReview(page).click();
  await expect(group(page).getByRole('button')).toHaveText(['All', 'Open 3', 'Resolved 0']);
  await expectListed(page, THREADS);
});

test('F-13.1 the pick is kept on the Drafts tab and back, and ends with the screen: opened again the summary starts on All', async ({
  page,
}) => {
  await resolveKickThenSummary(page);
  await filter(page, 'Resolved 1').click();
  await expectListed(page, [KICK]);

  await tab(page, 'Drafts 0').click();
  await expect(tab(page, 'Drafts 0')).toHaveAttribute('aria-selected', 'true');
  await expect(group(page)).toHaveCount(0);
  await expect(page.getByRole('button', { name: /^(All|Open \d+|Resolved \d+)$/ })).toHaveCount(0);

  await tab(page, 'Threads 2 open').click();
  await expect(filter(page, 'Resolved 1')).toHaveAttribute('aria-pressed', 'true');
  await expectListed(page, [KICK]);

  await backToSteps(page).click();
  await expect(page.getByText('Step 4 of 8')).toBeVisible();
  await finishReview(page).click();
  await expect(filter(page, 'All')).toHaveAttribute('aria-pressed', 'true');
  await expect(filter(page, 'Resolved 1')).toHaveAttribute('aria-pressed', 'false');
  await expectListed(page, THREADS);
});

test('F-13.1 the filters are reached with Tab right after the selected tab and work with Enter and Space', async ({
  page,
}) => {
  await openStep1(page);
  await finishReview(page).click();
  const threads = tab(page, 'Threads 3 open');
  await expect(threads).toHaveAttribute('aria-selected', 'true');

  await threads.focus();
  await page.keyboard.press('Tab');
  await expect(filter(page, 'All')).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(filter(page, 'Open 3')).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(filter(page, 'Open 3')).toHaveAttribute('aria-pressed', 'true');
  await expect(filter(page, 'All')).toHaveAttribute('aria-pressed', 'false');
  await page.keyboard.press('Tab');
  await expect(filter(page, 'Resolved 0')).toBeFocused();
  await page.keyboard.press('Space');
  await expect(filter(page, 'Resolved 0')).toHaveAttribute('aria-pressed', 'true');
  await expect(panel(page).getByText(EMPTY)).toBeVisible();
  // The pressed filter keeps the focus ring where the user is.
  await expect(filter(page, 'Resolved 0')).toBeFocused();
});

test('F-13.1 the filters are drawn as in the mock: right of the tabs in their row, flat 32px buttons, uppercase Barlow Condensed, the pressed one on a dark fill', async ({
  page,
}) => {
  await openStep1(page);
  await finishReview(page).click();
  await expect(group(page)).toBeVisible();

  // Same row as the tabs, to the right of them.
  const strip = await tablist(page).boundingBox();
  const filters = await group(page).boundingBox();
  expect(filters?.x ?? 0).toBeGreaterThan((strip?.x ?? Infinity) + (strip?.width ?? 0));
  const stripMiddle = (strip?.y ?? 0) + (strip?.height ?? 0) / 2;
  const filtersMiddle = (filters?.y ?? 0) + (filters?.height ?? 0) / 2;
  expect(Math.abs(stripMiddle - filtersMiddle)).toBeLessThanOrEqual(2);

  await expect(group(page)).toHaveCSS('display', 'flex');
  await expect(group(page)).toHaveCSS('column-gap', '2px');
  for (const name of ['All', 'Open 3', 'Resolved 0']) {
    const button = filter(page, name);
    await expect(button).toHaveCSS('text-transform', 'uppercase');
    await expect(button).toHaveCSS('font-family', /Barlow Condensed/);
    await expect(button).toHaveCSS('font-size', '14px');
    await expect(button).toHaveCSS('font-weight', '700');
    await expect(button).toHaveCSS('letter-spacing', '0.56px');
    await expect(button).toHaveCSS('padding-left', '12px');
    await expect(button).toHaveCSS('padding-right', '12px');
    await expect(button).toHaveCSS('border-top-width', '0px');
    await expect(button).toHaveCSS('border-radius', '0px');
    const box = await button.boundingBox();
    expect(Math.round(box?.height ?? 0)).toBe(32);
  }
  // Pressed: the dark fill and the light text; not pressed: no fill and the grey text.
  await expect(filter(page, 'All')).toHaveCSS('background-color', 'rgb(38, 38, 38)');
  await expect(filter(page, 'All')).toHaveCSS('color', 'rgb(244, 244, 242)');
  await expect(filter(page, 'Open 3')).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)');
  await expect(filter(page, 'Open 3')).toHaveCSS('color', 'rgb(140, 140, 135)');

  await filter(page, 'Open 3').click();
  await expect(filter(page, 'Open 3')).toHaveCSS('background-color', 'rgb(38, 38, 38)');
  await expect(filter(page, 'Open 3')).toHaveCSS('color', 'rgb(244, 244, 242)');
  await expect(filter(page, 'All')).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)');
  await expect(filter(page, 'All')).toHaveCSS('color', 'rgb(140, 140, 135)');

  // The empty pick: a centred grey line on the list's dark fill.
  await filter(page, 'Resolved 0').click();
  const empty = panel(page).getByText(EMPTY, { exact: true });
  await expect(empty).toBeVisible();
  await expect(empty).toHaveCSS('text-align', 'center');
  await expect(empty).toHaveCSS('font-size', '14px');
  await expect(empty).toHaveCSS('color', 'rgb(140, 140, 135)');
  await expect(empty).toHaveCSS('background-color', 'rgb(20, 20, 20)');
  await expect(empty).toHaveCSS('padding-top', '28px');
  await expect(empty).toHaveCSS('padding-left', '16px');
});

test('F-13.1 F-30.4 SUMMARY restored on start does not read the threads: Threads says to open the summary again and has no filters, until it is opened again', async ({
  page,
}) => {
  await openStep1(page);
  await openStep(page, /ViewModel/, 4);
  await page.getByRole('button', { name: `Note 2: ${NOTE}` }).click();
  const card = page.getByRole('article', { name: `Claude note: ${NOTE}` });
  await card.getByRole('button', { name: 'Add to drafts' }).click();
  await expect(card.getByText(/Added to drafts\./)).toBeVisible();
  await finishReview(page).click();
  await expect(tab(page, 'Drafts 1')).toHaveAttribute('aria-selected', 'true');

  await restartApp(page);
  await expect(tab(page, 'Drafts 1')).toHaveAttribute('aria-selected', 'true');
  await tab(page, 'Threads').click();
  await expect(tab(page, 'Threads')).toHaveAttribute('aria-selected', 'true');
  await expect(panel(page).getByText('Open the summary again to load the threads.')).toBeVisible();
  await expect(group(page)).toHaveCount(0);

  await backToSteps(page).click();
  await expect(page.getByText('Step 4 of 8')).toBeVisible();
  await finishReview(page).click();
  await tab(page, 'Threads 3 open').click();
  await expect(group(page).getByRole('button')).toHaveText(['All', 'Open 3', 'Resolved 0']);
  await expectListed(page, THREADS);
});
