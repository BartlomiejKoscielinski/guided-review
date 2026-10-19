import { expect, test, type Locator, type Page } from '@playwright/test';
import { openStep, openStep1 } from './stepHelpers';

// F-13.2 against the mock backend (SummaryDesk.dc.html): each row of S-05's Threads tab shows the
// thread's first message (plain text, one line), under it "author · N replies · file:line" (the
// location in the mono font; "You" for the signed-in user's own threads; no file:line on a comment
// on the MR itself), and to the right Show in code (a 32px square link) and Resolve (green) or
// Reopen (grey). Resolve and Reopen go to GitLab at once and the step's thread card follows;
// Show in code opens the step the thread shows in, in the session's mode, with the card scrolled
// into view, and is absent for a thread that shows in no step.
// The mock backend has !482's three open threads: SqliteUploadQueue.cs:24 (step 2, one reply),
// SqliteUploadQueue.cs:61 (step 2, no reply) and DeliveryPhotoViewModel.cs:48 (step 4, one reply).
// Not tried in the real app (stand-in GitLab): the mock backend answers the threads and steps.

const SEMAPHORE = 'Kick only releases a semaphore, the upload runs in the background.';
const TABLE = 'Is the table created on every start?';
const ATTEMPTS = 'What happens to a photo that keeps failing?';
const KICK = 'Kick() is called on the UI thread. Does the worker block anything here?';

const finishReview = (page: Page) =>
  page.getByTestId('title-bar').getByRole('button', { name: 'Finish review' });
const backToSteps = (page: Page) => page.getByRole('button', { name: 'Back to steps' });
const tablist = (page: Page) => page.getByRole('tablist', { name: 'Comments', exact: true });
const tab = (page: Page, name: string) => tablist(page).getByRole('tab', { name, exact: true });
const group = (page: Page) => page.getByRole('group', { name: 'Thread filter', exact: true });
const panel = (page: Page) => page.getByRole('tabpanel');
const rows = (page: Page) => panel(page).getByRole('listitem');
const row = (page: Page, text: string) => rows(page).filter({ hasText: text });
const resolveIn = (target: Locator) => target.getByRole('button', { name: 'Resolve', exact: true });
const reopenIn = (target: Locator) => target.getByRole('button', { name: 'Reopen', exact: true });
const showIn = (target: Locator, place: string) =>
  target.getByLabel(`Show in code: ${place}`, { exact: true });
/** The thread card S-03 and S-04 show under a diff line. */
const card = (page: Page, line: number) =>
  page.getByRole('region', { name: `Thread at line ${String(line)}`, exact: true });

/** S-05 of !482 opened with Finish review from step 1: the Threads tab. */
async function openThreads(page: Page, open: string) {
  await openStep1(page);
  await finishReview(page).click();
  await expect(tab(page, open)).toHaveAttribute('aria-selected', 'true');
}

// ---- seeded threads: the mock GitLab's state is read from localStorage when the app starts ----

const USERS = {
  pawel: { username: 'pawel.s', name: 'Paweł S.' },
  marta: { username: 'marta.k', name: 'Marta K.' },
  you: { username: 'bartek.k', name: 'Bartek K.' },
  ola: { username: 'ola.m', name: 'Ola M.' },
} as const;

interface Seed {
  resolved: boolean;
  /** Path and line; none for a comment on the MR itself. */
  at?: readonly [string, number];
  author: keyof typeof USERS;
  body: string;
  replies: readonly (keyof typeof USERS)[];
}

async function seedThreads(page: Page, seeds: readonly Seed[]) {
  const threads = seeds.map((s, i) => ({
    id: `d-seed-${String(i + 1)}`,
    resolvable: true,
    resolved: s.resolved,
    outdated: false,
    ...(s.at
      ? {
          position: {
            oldPath: s.at[0],
            newPath: s.at[0],
            newLine: s.at[1],
            headSha: '9c41e07',
            baseSha: '5e2a9c4',
          },
        }
      : {}),
    notes: [s.author, ...s.replies].map((who, n) => ({
      id: 70000 + i * 10 + n,
      author: USERS[who],
      body: n === 0 ? s.body : 'Agreed.',
      createdAt: `2026-10-12T${String(9 + n).padStart(2, '0')}:${String(10 + i)}:00.000Z`,
    })),
  }));
  await page.addInitScript((data) => {
    localStorage.setItem('guided-review.mock.sessionData', JSON.stringify({ threads: data }));
  }, threads);
}

const VM = 'src/Mobile.App/ViewModels/DeliveryPhotoViewModel.cs';
const QUEUE = 'src/Mobile.Infrastructure/Uploads/SqliteUploadQueue.cs';
const MANIFEST = 'src/Mobile.App/Platforms/Android/AndroidManifest.xml';
const XAML = 'src/Mobile.App/Views/DeliveryPhotoPage.xaml';
/** Not a file of !482: a thread on it shows in no step. */
const GONE = 'src/Mobile.Core/Uploads/PendingUpload.cs';

const NETWORK = 'Do we need ACCESS_NETWORK_STATE here?';
const INDEX = 'No index on CreatedAt, but every read sorts by it.';
const BANNER = 'Banner color should come from resources, not be hardcoded.';
const RECORD = 'Maybe a record instead of a class?';

/** SummaryDesk.dc.html's five threads: three open, two resolved, two of them the user's own. */
const MOCK_FIVE: readonly Seed[] = [
  { resolved: false, at: [VM, 48], author: 'pawel', body: KICK, replies: ['marta'] },
  { resolved: false, at: [QUEUE, 34], author: 'pawel', body: INDEX, replies: ['you'] },
  { resolved: false, at: [MANIFEST, 12], author: 'you', body: NETWORK, replies: ['pawel'] },
  { resolved: true, at: [XAML, 22], author: 'ola', body: BANNER, replies: ['you', 'ola'] },
  { resolved: true, at: [GONE, 3], author: 'you', body: RECORD, replies: ['pawel'] },
];

test('F-13.2 resolve from the summary updates the step card: Resolve on a row, then the card on step 4 is Resolved, and Reopen on the row opens it again', async ({
  page,
}) => {
  await openStep1(page);
  await openStep(page, /ViewModel/, 4);
  await expect(card(page, 48)).toContainText(SEMAPHORE);
  await expect(resolveIn(card(page, 48))).toBeVisible();
  await finishReview(page).click();
  await expect(tab(page, 'Threads 3 open')).toHaveAttribute('aria-selected', 'true');

  const kick = row(page, KICK);
  await resolveIn(kick).click();
  await expect(reopenIn(kick)).toBeVisible();
  await expect(resolveIn(kick)).toHaveCount(0);
  await expect(kick).toContainText('Paweł S. · 1 reply · resolved · DeliveryPhotoViewModel.cs:48');
  await expect(tab(page, 'Threads 2 open')).toBeVisible();
  await expect(group(page).getByRole('button')).toHaveText(['All', 'Open 2', 'Resolved 1']);

  await backToSteps(page).click();
  await expect(page.getByText('Step 4 of 8')).toBeVisible();
  await expect(card(page, 48).getByText('Resolved', { exact: true })).toBeVisible();
  await expect(reopenIn(card(page, 48))).toBeVisible();
  await expect(resolveIn(card(page, 48))).toHaveCount(0);

  await finishReview(page).click();
  await reopenIn(row(page, KICK)).click();
  await expect(resolveIn(row(page, KICK))).toBeVisible();
  await expect(row(page, KICK)).not.toContainText('resolved');
  await expect(tab(page, 'Threads 3 open')).toBeVisible();

  await backToSteps(page).click();
  await expect(resolveIn(card(page, 48))).toBeVisible();
  await expect(card(page, 48).getByText('Resolved', { exact: true })).toHaveCount(0);
});

test('F-13.2 each of !482\'s three threads is a row: first message, "author · N replies · file:line", Show in code and Resolve', async ({
  page,
}) => {
  await openThreads(page, 'Threads 3 open');
  await expect(rows(page)).toHaveCount(3);
  const expected = [
    [TABLE, 'Paweł S. · 1 reply · SqliteUploadQueue.cs:24', 'SqliteUploadQueue.cs:24'],
    [ATTEMPTS, 'Paweł S. · 0 replies · SqliteUploadQueue.cs:61', 'SqliteUploadQueue.cs:61'],
    [KICK, 'Paweł S. · 1 reply · DeliveryPhotoViewModel.cs:48', 'DeliveryPhotoViewModel.cs:48'],
  ] as const;
  for (const [text, meta, place] of expected) {
    const thread = row(page, text);
    await expect(thread).toHaveCount(1);
    await expect(thread).toContainText(meta);
    await expect(showIn(thread, place)).toBeVisible();
    await expect(showIn(thread, place)).toHaveAttribute('title', 'Show in code');
    await expect(resolveIn(thread)).toBeVisible();
    await expect(reopenIn(thread)).toHaveCount(0);
    // The message is above its meta line.
    const message = await thread.getByText(text).boundingBox();
    const where = await thread.getByText(place, { exact: true }).boundingBox();
    expect(message?.y ?? Infinity).toBeLessThan(where?.y ?? 0);
  }
  // The location is the file name; the path is its title.
  await expect(
    panel(page).getByText('DeliveryPhotoViewModel.cs:48', { exact: true }),
  ).toHaveAttribute('title', 'src/Mobile.App/ViewModels/DeliveryPhotoViewModel.cs');
});

test('F-13.2 Show in code opens the step the thread shows in with its card scrolled into view: step 2 at line 61, then step 4 at line 48', async ({
  page,
}) => {
  await openThreads(page, 'Threads 3 open');
  await showIn(row(page, ATTEMPTS), 'SqliteUploadQueue.cs:61').click();
  await expect(page.getByText('Step 2 of 8')).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Summary' })).toHaveCount(0);
  await expect(card(page, 61)).toContainText(ATTEMPTS);
  await expect(card(page, 61)).toBeInViewport({ ratio: 1 });

  await finishReview(page).click();
  await expect(tab(page, 'Threads 3 open')).toHaveAttribute('aria-selected', 'true');
  await showIn(row(page, KICK), 'DeliveryPhotoViewModel.cs:48').click();
  await expect(page.getByText('Step 4 of 8')).toBeVisible();
  await expect(card(page, 48)).toContainText(SEMAPHORE);
  await expect(card(page, 48)).toBeInViewport({ ratio: 1 });
});

test('F-13.2 in a Detailed session Show in code opens S-04 on the same step with the card in view', async ({
  page,
}) => {
  await openStep1(page);
  await page.keyboard.press('Control+d');
  await expect(page.getByRole('complementary', { name: 'Guide' })).toBeVisible();
  await finishReview(page).click();
  await expect(tab(page, 'Threads 3 open')).toHaveAttribute('aria-selected', 'true');

  await showIn(row(page, KICK), 'DeliveryPhotoViewModel.cs:48').click();
  await expect(page.getByRole('complementary', { name: 'Guide' })).toBeVisible();
  await expect(page.getByText('Step 4 / 8')).toBeVisible();
  await expect(card(page, 48)).toContainText(SEMAPHORE);
  await expect(card(page, 48)).toBeInViewport({ ratio: 1 });
});

test('F-13.2 the mock\'s five threads: "You" on the user\'s own, "· resolved" and Reopen on the resolved ones, Show in code only where a step shows the thread', async ({
  page,
}) => {
  await seedThreads(page, MOCK_FIVE);
  await openThreads(page, 'Threads 3 open');
  await expect(group(page).getByRole('button')).toHaveText(['All', 'Open 3', 'Resolved 2']);
  await expect(rows(page)).toHaveCount(5);

  const metas = [
    [KICK, 'Paweł S. · 1 reply · DeliveryPhotoViewModel.cs:48'],
    [INDEX, 'Paweł S. · 1 reply · SqliteUploadQueue.cs:34'],
    [NETWORK, 'You · 1 reply · AndroidManifest.xml:12'],
    [BANNER, 'Ola M. · 2 replies · resolved · DeliveryPhotoPage.xaml:22'],
    [RECORD, 'You · 1 reply · resolved · PendingUpload.cs:3'],
  ] as const;
  for (const [text, meta] of metas) await expect(row(page, text)).toContainText(meta);
  // Replies by the user do not make the thread theirs.
  await expect(row(page, INDEX)).not.toContainText('You ·');

  for (const text of [KICK, INDEX, NETWORK]) {
    await expect(resolveIn(row(page, text))).toBeVisible();
    await expect(reopenIn(row(page, text))).toHaveCount(0);
  }
  for (const text of [BANNER, RECORD]) {
    await expect(reopenIn(row(page, text))).toBeVisible();
    await expect(resolveIn(row(page, text))).toHaveCount(0);
  }
  // Steps show these three; PendingUpload.cs is not in the MR, so its row has no way to open it.
  await expect(showIn(row(page, KICK), 'DeliveryPhotoViewModel.cs:48')).toBeVisible();
  await expect(showIn(row(page, INDEX), 'SqliteUploadQueue.cs:34')).toBeVisible();
  await expect(showIn(row(page, NETWORK), 'AndroidManifest.xml:12')).toBeVisible();
  await expect(row(page, RECORD).getByLabel(/^Show in code/)).toHaveCount(0);

  // Reopen on a resolved row: Open 4 / Resolved 1.
  await reopenIn(row(page, RECORD)).click();
  await expect(resolveIn(row(page, RECORD))).toBeVisible();
  await expect(group(page).getByRole('button')).toHaveText(['All', 'Open 4', 'Resolved 1']);
  await expect(tab(page, 'Threads 4 open')).toBeVisible();
});

test('F-13.2 a comment on the MR itself has no file:line and no Show in code, and a long first message keeps to one line', async ({
  page,
}) => {
  const thanks = 'Thanks for the quick turnaround on this one.';
  const long = `${'The retry loop never gives up on a permanent failure, so the queue keeps growing. '.repeat(8)}End.`;
  await seedThreads(page, [
    { resolved: false, author: 'ola', body: thanks, replies: ['pawel'] },
    { resolved: false, at: [QUEUE, 61], author: 'pawel', body: long, replies: [] },
  ]);
  await openThreads(page, 'Threads 2 open');

  const general = row(page, thanks);
  await expect(general).toContainText('Ola M. · 1 reply');
  await expect(general).not.toContainText(/reply\s*·/);
  await expect(general).not.toContainText(/\.\w+:\d+/);
  await expect(general.getByLabel(/^Show in code/)).toHaveCount(0);
  await expect(resolveIn(general)).toBeVisible();
  await resolveIn(general).click();
  await expect(reopenIn(general)).toBeVisible();
  await expect(general).toContainText('Ola M. · 1 reply · resolved');

  // One line of the 15px / 1.55 text; the actions stay inside the row.
  const message = row(page, 'The retry loop').getByText('The retry loop', { exact: false }).first();
  const box = await message.boundingBox();
  expect(box?.height ?? Infinity).toBeLessThan(30);
  const rowBox = await row(page, 'The retry loop').boundingBox();
  const resolveBox = await resolveIn(row(page, 'The retry loop')).boundingBox();
  expect((resolveBox?.x ?? Infinity) + (resolveBox?.width ?? 0)).toBeLessThanOrEqual(
    (rowBox?.x ?? 0) + (rowBox?.width ?? 0),
  );
});

test('F-13.2 the keyboard reaches Show in code, then Resolve, in each row; Enter resolves and the focus moves to Reopen', async ({
  page,
}) => {
  await openThreads(page, 'Threads 3 open');
  const kick = row(page, KICK);
  const link = showIn(kick, 'DeliveryPhotoViewModel.cs:48');
  await link.focus();
  await expect(link).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(resolveIn(kick)).toBeFocused();
  await page.keyboard.press('Shift+Tab');
  await expect(link).toBeFocused();
  await page.keyboard.press('Tab');
  await page.keyboard.press('Enter');
  await expect(reopenIn(kick)).toBeVisible();
  await expect(reopenIn(kick)).toBeFocused();
  await page.keyboard.press('Space');
  await expect(resolveIn(kick)).toBeVisible();
  await expect(resolveIn(kick)).toBeFocused();
});

test('F-13.2 the rows are drawn as in the mock: dark rows 2px apart, 15px message, 12.5px grey meta with the location in mono, a 32px Show in code square, green Resolve and grey Reopen buttons', async ({
  page,
}) => {
  await seedThreads(page, MOCK_FIVE);
  await openThreads(page, 'Threads 3 open');
  const open = row(page, KICK);
  const done = row(page, BANNER);

  // The row: a dark panel with 16px padding, rows 2px apart.
  await expect(open).toHaveCSS('display', 'grid');
  await expect(open).toHaveCSS('background-color', 'rgb(20, 20, 20)');
  await expect(open).toHaveCSS('padding-top', '16px');
  await expect(open).toHaveCSS('padding-left', '16px');
  await expect(open).toHaveCSS('column-gap', '14px');
  const first = await rows(page).nth(0).boundingBox();
  const second = await rows(page).nth(1).boundingBox();
  expect(Math.round((second?.y ?? 0) - ((first?.y ?? 0) + (first?.height ?? 0)))).toBe(2);

  // The first message: 15px on 1.55, light while open, grey once resolved.
  const message = open.getByText(KICK, { exact: true });
  await expect(message).toHaveCSS('font-size', '15px');
  await expect(message).toHaveCSS('line-height', '23.25px');
  await expect(message).toHaveCSS('color', 'rgb(244, 244, 242)');
  await expect(message).toHaveCSS('margin-top', '0px');
  await expect(done.getByText(BANNER, { exact: true })).toHaveCSS('color', 'rgb(140, 140, 135)');

  // The meta line is grey 12.5px; the location in it is 11.5px JetBrains Mono.
  const place = open.getByText('DeliveryPhotoViewModel.cs:48', { exact: true });
  await expect(place).toHaveCSS('font-family', /JetBrains Mono/);
  await expect(place).toHaveCSS('font-size', '11.5px');
  const meta = place.locator('xpath=..');
  await expect(meta).toHaveCSS('font-size', '12.5px');
  await expect(meta).toHaveCSS('color', 'rgb(140, 140, 135)');

  // Show in code: a 32px square, grey, no underline.
  const link = showIn(open, 'DeliveryPhotoViewModel.cs:48');
  const linkBox = await link.boundingBox();
  expect(Math.round(linkBox?.width ?? 0)).toBe(32);
  expect(Math.round(linkBox?.height ?? 0)).toBe(32);
  await expect(link).toHaveCSS('color', 'rgb(140, 140, 135)');
  await expect(link).toHaveCSS('text-decoration-line', 'none');

  // Resolve: green with the dark ink, 32px, Barlow Condensed 800 uppercase.
  const resolve = resolveIn(open);
  await expect(resolve).toHaveCSS('background-color', 'rgb(99, 214, 118)');
  await expect(resolve).toHaveCSS('color', 'rgb(16, 16, 16)');
  await expect(resolve).toHaveCSS('font-family', /Barlow Condensed/);
  await expect(resolve).toHaveCSS('font-size', '14px');
  await expect(resolve).toHaveCSS('font-weight', '800');
  await expect(resolve).toHaveCSS('text-transform', 'uppercase');
  await expect(resolve).toHaveCSS('letter-spacing', '0.56px');
  await expect(resolve).toHaveCSS('padding-left', '14px');
  await expect(resolve).toHaveCSS('border-top-width', '0px');
  await expect(resolve).toHaveCSS('border-radius', '0px');
  expect(Math.round((await resolve.boundingBox())?.height ?? 0)).toBe(32);

  // Reopen: the grey fill, 700, 12px padding.
  const reopen = reopenIn(done);
  await expect(reopen).toHaveCSS('background-color', 'rgb(38, 38, 38)');
  await expect(reopen).toHaveCSS('color', 'rgb(244, 244, 242)');
  await expect(reopen).toHaveCSS('font-family', /Barlow Condensed/);
  await expect(reopen).toHaveCSS('font-size', '14px');
  await expect(reopen).toHaveCSS('font-weight', '700');
  await expect(reopen).toHaveCSS('text-transform', 'uppercase');
  await expect(reopen).toHaveCSS('padding-left', '12px');
  await expect(reopen).toHaveCSS('border-radius', '0px');
  expect(Math.round((await reopen.boundingBox())?.height ?? 0)).toBe(32);
});
