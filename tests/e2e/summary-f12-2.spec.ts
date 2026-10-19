import { expect, test, type Page } from '@playwright/test';
import { openStep, openStep1, restartApp } from './stepHelpers';

// F-12.2 against the mock backend (SummaryDesk.dc.html): S-05 of an MR session (!482) has the tabs
// "Drafts N" and "Threads N open" in a tablist named Comments. Drafts counts the session's drafts,
// Threads the open threads of the MR (three in the mock backend, as the design mock's "3 open").
// M5 decision 5: the screen opens on Drafts when the session has unpublished drafts, else on
// Threads, and the choice is kept while the screen is open. Tabs are ARIA tabs with arrow keys.
// Not tried in the real app (stand-in GitLab): the mock backend answers the thread count here.

const NOTE = 'PendingCount won’t refresh after upload';
const SEMAPHORE = 'Kick only releases a semaphore, the upload runs in the background.';

const finishReview = (page: Page) =>
  page.getByTestId('title-bar').getByRole('button', { name: 'Finish review' });
const backToSteps = (page: Page) => page.getByRole('button', { name: 'Back to steps' });
const tablist = (page: Page) => page.getByRole('tablist', { name: 'Comments', exact: true });
const tab = (page: Page, name: string) => tablist(page).getByRole('tab', { name, exact: true });
const thread = (page: Page, line: number) =>
  page.getByRole('region', { name: `Thread at line ${String(line)}`, exact: true });

/** S-03 on step 4 (ViewModel) of !482, where the note and the thread at line 48 are. */
async function openViewModelStep(page: Page) {
  await openStep1(page);
  await openStep(page, /ViewModel/, 4);
  await expect(thread(page, 48)).toContainText(SEMAPHORE);
}

/** Add to drafts on step 4's second note: one draft in the session. */
async function addOneDraft(page: Page) {
  await page.getByRole('button', { name: `Note 2: ${NOTE}` }).click();
  const card = page.getByRole('article', { name: `Claude note: ${NOTE}` });
  await card.getByRole('button', { name: 'Add to drafts' }).click();
  await expect(card.getByText(/Added to drafts\./)).toBeVisible();
}

test('F-12.2 Finish review of a session without drafts opens SUMMARY on Threads: "Drafts 0" and "Threads 3 open"', async ({
  page,
}) => {
  await openStep1(page);
  await finishReview(page).click();

  await expect(tablist(page)).toBeVisible();
  await expect(tablist(page).getByRole('tab')).toHaveCount(2);
  await expect(tab(page, 'Drafts 0')).toBeVisible();
  await expect(tab(page, 'Threads 3 open')).toBeVisible();
  await expect(tab(page, 'Threads 3 open')).toHaveAttribute('aria-selected', 'true');
  await expect(tab(page, 'Drafts 0')).toHaveAttribute('aria-selected', 'false');
  // Drafts first, then Threads, as in the mock.
  const drafts = await tab(page, 'Drafts 0').boundingBox();
  const threads = await tab(page, 'Threads 3 open').boundingBox();
  expect(drafts?.x ?? Infinity).toBeLessThan(threads?.x ?? 0);
});

test('F-12.2 a draft added on step 4 makes SUMMARY open on Drafts with "Drafts 1"; the pick is kept while the screen is open and made again when it is opened again', async ({
  page,
}) => {
  await openViewModelStep(page);
  await addOneDraft(page);
  await finishReview(page).click();

  await expect(tab(page, 'Drafts 1')).toBeVisible();
  await expect(tab(page, 'Drafts 1')).toHaveAttribute('aria-selected', 'true');
  await expect(tab(page, 'Threads 3 open')).toHaveAttribute('aria-selected', 'false');

  await tab(page, 'Threads 3 open').click();
  await expect(tab(page, 'Threads 3 open')).toHaveAttribute('aria-selected', 'true');
  await expect(tab(page, 'Drafts 1')).toHaveAttribute('aria-selected', 'false');

  // Leaving the screen ends the choice: opened again, the summary opens on Drafts again.
  await backToSteps(page).click();
  await expect(page.getByText('Step 4 of 8')).toBeVisible();
  await finishReview(page).click();
  await expect(tab(page, 'Drafts 1')).toHaveAttribute('aria-selected', 'true');
  await expect(tab(page, 'Threads 3 open')).toHaveAttribute('aria-selected', 'false');
});

test('F-12.2 resolving the thread on step 4 lowers the count, also when SUMMARY was opened before; Reopen brings it back', async ({
  page,
}) => {
  await openViewModelStep(page);
  await finishReview(page).click();
  await expect(tab(page, 'Threads 3 open')).toBeVisible();

  await backToSteps(page).click();
  await expect(thread(page, 48)).toContainText(SEMAPHORE);
  await thread(page, 48).getByRole('button', { name: 'Resolve', exact: true }).click();
  await expect(thread(page, 48).getByText('Resolved', { exact: true })).toBeVisible();

  await finishReview(page).click();
  await expect(tab(page, 'Threads 2 open')).toBeVisible();
  await expect(tab(page, 'Threads 2 open')).toHaveAttribute('aria-selected', 'true');
  await expect(tab(page, 'Threads 3 open')).toHaveCount(0);

  await backToSteps(page).click();
  await expect(thread(page, 48)).toContainText(SEMAPHORE);
  await thread(page, 48).getByRole('button', { name: 'Reopen', exact: true }).click();
  await expect(thread(page, 48).getByText('Resolved', { exact: true })).toHaveCount(0);

  await finishReview(page).click();
  await expect(tab(page, 'Threads 3 open')).toBeVisible();
  await expect(tab(page, 'Threads 2 open')).toHaveCount(0);
});

test('F-12.2 the tabs switch by click and by arrow keys, and only the selected tab takes the Tab key', async ({
  page,
}) => {
  await openViewModelStep(page);
  await addOneDraft(page);
  await finishReview(page).click();
  const drafts = tab(page, 'Drafts 1');
  const threads = tab(page, 'Threads 3 open');
  await expect(drafts).toHaveAttribute('aria-selected', 'true');

  // Roving tab stop: from Back to steps one Tab press reaches the selected tab, the next leaves.
  await expect(drafts).toHaveAttribute('tabindex', '0');
  await expect(threads).toHaveAttribute('tabindex', '-1');
  await backToSteps(page).focus();
  await page.keyboard.press('Tab');
  await expect(drafts).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(threads).not.toBeFocused();
  await expect(drafts).not.toBeFocused();

  await drafts.focus();
  await page.keyboard.press('ArrowRight');
  await expect(threads).toHaveAttribute('aria-selected', 'true');
  await expect(threads).toBeFocused();
  await expect(drafts).toHaveAttribute('aria-selected', 'false');
  await expect(threads).toHaveAttribute('tabindex', '0');
  await expect(drafts).toHaveAttribute('tabindex', '-1');

  // Wraps at the end, and ArrowLeft wraps at the start.
  await page.keyboard.press('ArrowRight');
  await expect(drafts).toHaveAttribute('aria-selected', 'true');
  await expect(drafts).toBeFocused();
  await page.keyboard.press('ArrowLeft');
  await expect(threads).toHaveAttribute('aria-selected', 'true');
  await expect(threads).toBeFocused();

  await page.keyboard.press('Home');
  await expect(drafts).toHaveAttribute('aria-selected', 'true');
  await expect(drafts).toBeFocused();
  await page.keyboard.press('End');
  await expect(threads).toHaveAttribute('aria-selected', 'true');
  await expect(threads).toBeFocused();

  await drafts.click();
  await expect(drafts).toHaveAttribute('aria-selected', 'true');
  await expect(threads).toHaveAttribute('aria-selected', 'false');
});

test('F-12.2 the tabs are drawn as in the mock: dark strip, light selected tab, uppercase Barlow Condensed, mono count, square, no border', async ({
  page,
}) => {
  await openViewModelStep(page);
  await addOneDraft(page);
  await finishReview(page).click();
  const strip = tablist(page);
  const drafts = tab(page, 'Drafts 1');
  const threads = tab(page, 'Threads 3 open');
  await expect(drafts).toHaveAttribute('aria-selected', 'true');

  await expect(strip).toHaveCSS('background-color', 'rgb(26, 26, 26)');
  for (const target of [drafts, threads]) {
    await expect(target).toHaveCSS('text-transform', 'uppercase');
    await expect(target).toHaveCSS('font-family', /Barlow Condensed/);
    await expect(target).toHaveCSS('font-size', '15px');
    await expect(target).toHaveCSS('font-weight', '700');
    await expect(target).toHaveCSS('border-top-width', '0px');
    await expect(target).toHaveCSS('border-radius', '0px');
    const box = await target.boundingBox();
    expect(Math.round(box?.height ?? 0)).toBe(36);
    const count = target.locator('span');
    await expect(count).toHaveCSS('font-family', /JetBrains Mono/);
    await expect(count).toHaveCSS('font-size', '12px');
  }
  // The selected tab is the light fill, the other one is on the strip.
  await expect(drafts).toHaveCSS('background-color', 'rgb(244, 244, 242)');
  await expect(drafts).toHaveCSS('color', 'rgb(16, 16, 16)');
  await expect(threads).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)');
  await expect(threads).toHaveCSS('color', 'rgb(179, 179, 174)');

  await threads.click();
  await expect(threads).toHaveCSS('background-color', 'rgb(244, 244, 242)');
  await expect(threads).toHaveCSS('color', 'rgb(16, 16, 16)');
  await expect(drafts).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)');
  await expect(drafts).toHaveCSS('color', 'rgb(179, 179, 174)');
});

test('F-12.2 SUMMARY restored on start keeps "Drafts 1" from this PC and reads a bare "Threads" until the summary is opened again', async ({
  page,
}) => {
  await openViewModelStep(page);
  await addOneDraft(page);
  await finishReview(page).click();
  await expect(tab(page, 'Drafts 1')).toBeVisible();
  await expect(tab(page, 'Threads 3 open')).toBeVisible();

  // Restoring starts no GitLab work (F-30.4): the thread count is not read, so it is not claimed.
  await restartApp(page);
  await expect(tablist(page)).toBeVisible();
  await expect(tab(page, 'Drafts 1')).toBeVisible();
  await expect(tab(page, 'Drafts 1')).toHaveAttribute('aria-selected', 'true');
  await expect(tab(page, 'Threads')).toBeVisible();
  await expect(tab(page, 'Threads')).toHaveAttribute('aria-selected', 'false');
  await expect(page.getByRole('tab', { name: /open$/ })).toHaveCount(0);

  // Opened again (Back to steps, Finish review) the threads are read and counted.
  await backToSteps(page).click();
  await expect(page.getByText('Step 4 of 8')).toBeVisible();
  await finishReview(page).click();
  await expect(tab(page, 'Threads 3 open')).toBeVisible();
  await expect(tab(page, 'Drafts 1')).toBeVisible();
});
