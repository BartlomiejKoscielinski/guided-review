import { expect, test, type Locator, type Page } from '@playwright/test';
import { flushSaves, openStep, openStep1 } from './stepHelpers';

// F-11.3 on S-03 and S-04 against the mock backend (M5 decision 4): a thread written on an older
// version shows under the line the core placed it on, with the word tag "Outdated"; a thread with
// no matching line is a card on the file header, between the header and the diff, tagged when it
// is outdated; a current thread on a line outside the hunks is on the file header too, without
// the tag; a thread on a file that is no longer in the MR shows in no step (S-05 lists it). The
// mock reads the threads from its stored session data, which the test seeds like the core's
// answer. Not tried in the real app (needs the stand-in GitLab with an old version).

const SESSION_DATA_KEY = 'guided-review.mock.sessionData';
const VM = 'src/Mobile.App/ViewModels/DeliveryPhotoViewModel.cs';
const LINE_BODY = 'Should the pending count refresh here as well?';
const FILE_BODY = 'This block moved after my first look. Is the null check still needed?';
const CONTEXT_BODY = 'Do we need a using for the queue namespace?';
const GONE_BODY = 'This file was dropped from the MR, where did the upload go?';

const ANNA = { username: 'anna.k', name: 'Anna K.' };
const MARTA = { username: 'marta.k', name: 'Marta K.' };
const note = (id: number, author: typeof ANNA, body: string) => ({
  id,
  author,
  body,
  createdAt: '2026-10-12T08:00:00.000Z',
});
const OLD = { headSha: '3b8d1f0', baseSha: '5e2a9c4' };

/**
 * Written on version 3b8d1f0 at line 9; the core placed it on line 14 (step 4's first hunk). A second
 * one found no line (file header), a third is current but on line 5, outside the hunks (file
 * header), and the last one is on a file that is not in the MR any more.
 */
const SEEDED = [
  {
    id: 'o-line',
    resolvable: true,
    resolved: false,
    outdated: true,
    placedLine: 14,
    position: { oldPath: VM, newPath: VM, newLine: 9, ...OLD },
    notes: [note(9101, ANNA, LINE_BODY)],
  },
  {
    id: 'o-file',
    resolvable: true,
    resolved: false,
    outdated: true,
    position: { oldPath: VM, newPath: VM, newLine: 60, ...OLD },
    notes: [note(9102, MARTA, FILE_BODY)],
  },
  {
    id: 'c-file',
    resolvable: true,
    resolved: false,
    outdated: false,
    position: { oldPath: VM, newPath: VM, newLine: 5, headSha: '9c41e07', baseSha: '5e2a9c4' },
    notes: [note(9103, ANNA, CONTEXT_BODY)],
  },
  {
    id: 'o-gone',
    resolvable: true,
    resolved: false,
    outdated: true,
    position: {
      oldPath: 'src/Mobile.App/Removed.cs',
      newPath: 'src/Mobile.App/Removed.cs',
      newLine: 12,
      ...OLD,
    },
    notes: [note(9104, MARTA, GONE_BODY)],
  },
];

const thread = (page: Page, line: number) =>
  page.getByRole('region', { name: `Thread at line ${String(line)}`, exact: true });
const icon = (page: Page, line: number) =>
  page.getByRole('button', { name: `Thread by Anna K. at line ${String(line)}`, exact: true });
const addLine = (page: Page, no: number) =>
  page.locator(`[data-kind="add"] [data-line-no="${String(no)}"]`).first();
const yOf = async (target: Locator) => (await target.boundingBox())?.y ?? NaN;
const fileOf = (page: Page) => page.getByRole('region', { name: VM, exact: true });
const headerCards = (page: Page) =>
  fileOf(page).getByRole('region', { name: `Thread on ${VM}`, exact: true });

/**
 * S-03 on step 4 of !482 with the seeded threads: the threads are written into the stored session
 * data by a script that runs before the app on the next load (as step-progress.spec.ts marks
 * steps reviewed), then the app starts again.
 */
async function openWithThreads(page: Page) {
  await openStep1(page);
  await openStep(page, /ViewModel/, 4);
  await flushSaves(page);
  await page.addInitScript(
    ({ key, threads }) => {
      const data = JSON.parse(localStorage.getItem(key) ?? '{}') as {
        threads?: { id: string }[];
      };
      const have = new Set((data.threads ?? []).map((t) => t.id));
      data.threads = [...(data.threads ?? []), ...threads.filter((t) => !have.has(t.id))];
      localStorage.setItem(key, JSON.stringify(data));
    },
    { key: SESSION_DATA_KEY, threads: SEEDED },
  );
  await page.reload();
  await expect(page.getByText('Step 4 of 8')).toBeVisible();
  await expect(fileOf(page)).toBeVisible();
}

/** The checks S-03 and S-04 share: the line card, the header cards and the thread that is nowhere. */
async function expectCards(page: Page) {
  // The outdated thread is under its placed line, tagged.
  const card = thread(page, 14);
  await expect(card).toContainText(LINE_BODY);
  await expect(card.getByText('Outdated', { exact: true })).toBeVisible();
  await expect(thread(page, 9)).toHaveCount(0);
  await expect(addLine(page, 15)).toBeVisible();
  const cardY = await yOf(card);
  expect(await yOf(addLine(page, 14))).toBeLessThan(cardY);
  expect(cardY).toBeLessThan(await yOf(addLine(page, 15)));

  // Two cards on the file header, in the order given: the outdated one tagged, the current not.
  const cards = headerCards(page);
  await expect(cards).toHaveCount(2);
  await expect(cards.nth(0)).toContainText(FILE_BODY);
  await expect(cards.nth(1)).toContainText(CONTEXT_BODY);
  await expect(cards.nth(0).getByText('Outdated', { exact: true })).toBeVisible();
  await expect(cards.nth(1).getByText('Outdated')).toHaveCount(0);
  // Between the file's path and the first line of its diff, and not on a line.
  const pathY = await yOf(fileOf(page).getByText(VM, { exact: true }).first());
  const firstLineY = await yOf(fileOf(page).locator('[data-line-no]').first());
  expect(pathY).toBeLessThan(await yOf(cards.nth(0)));
  expect(await yOf(cards.nth(1))).toBeLessThan(firstLineY);
  await expect(page.getByRole('button', { name: /^Thread by Marta K\./ })).toHaveCount(0);

  // The thread on the file that is not in the MR shows nowhere in the step.
  await expect(page.getByText(GONE_BODY)).toHaveCount(0);
}

test('F-11.3 in Focus an outdated thread is under its placed line and the others are cards on the file header', async ({
  page,
}) => {
  await openWithThreads(page);
  await expectCards(page);

  // The gutter icon on the placed line closes and opens the line card.
  await expect(icon(page, 14)).toHaveAttribute('aria-expanded', 'true');
  await icon(page, 14).click();
  await expect(thread(page, 14)).toHaveCount(0);
  await icon(page, 14).click();
  await expect(thread(page, 14)).toBeVisible();

  // The header card has the thread actions; resolving it keeps the Outdated tag.
  const card = headerCards(page).nth(0);
  await expect(card.getByRole('button', { name: 'Resolve', exact: true })).toBeVisible();
  await expect(card.getByRole('button', { name: 'Reply', exact: true })).toBeVisible();
  await card.getByRole('button', { name: 'Resolve', exact: true }).click();
  await expect(card.getByText('Resolved', { exact: true })).toBeVisible();
  await expect(card.getByRole('button', { name: 'Reopen', exact: true })).toBeVisible();
  await expect(card.getByText('Outdated', { exact: true })).toBeVisible();

  // Another step doesn't show the file, so it doesn't show the card.
  await openStep(page, /SqliteUploadQueue/, 2);
  await expect(page.getByText(FILE_BODY)).toHaveCount(0);
  await expect(page.getByText(CONTEXT_BODY)).toHaveCount(0);
});

test('F-11.3 in Detailed the same cards show: the placed line and the file header', async ({
  page,
}) => {
  await openWithThreads(page);
  await page.keyboard.press('Control+d');
  await expect(page.getByRole('complementary', { name: 'Guide' })).toBeVisible();
  await expect(page.getByText('Step 4 / 8')).toBeVisible();
  await expectCards(page);

  const card = headerCards(page).nth(0);
  await expect(card.getByRole('button', { name: 'Resolve', exact: true })).toBeVisible();
  await expect(card.getByRole('button', { name: 'Reply', exact: true })).toBeVisible();
});
