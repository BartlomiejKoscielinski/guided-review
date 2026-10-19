import { expect, test, type Locator, type Page } from '@playwright/test';
import { openStep1 } from './stepHelpers';

// F-13.3 against the mock backend (SummaryDesk.dc.html, M5 decision 12): the Threads tab of S-05
// has a "Check with Claude" button (purple square) when an open thread was written on an older
// version. Claude runs only when it is clicked; the thread it judges addressed by a later commit
// shows the chip "Claude: index added in a91f2c0" (purple square, under the meta line); when none
// is addressed the tab says "Claude found no thread addressed by a later commit."; a failed check
// says "Couldn't check the threads." with Retry. Nothing is resolved by Claude.
// The mock backend stands in for Claude with a rule: an open thread written on version 3b8d1f0 is
// addressed by commit a91f2c0 ("index added"); a thread written on any other older version is a
// candidate Claude does not find addressed. The mock's own !482 threads are all written on the
// reviewed version, so these specs seed the design mock's five threads.
// Not tried in the real app: `claude_thread_check` (git log -p between the thread's head and the
// reviewed head, a Claude run on click) needs the stand-in GitLab with a thread written on an
// older version and a signed-in Claude Code.

const CLAUDE_KEY = 'guided-review.mock.claude';
const CHECK = 'Check with Claude';
const CHIP = 'Claude: index added in a91f2c0';
const RUNNING = 'Claude is checking the threads…';
const NONE = 'Claude found no thread addressed by a later commit.';
const FAILED = "Couldn't check the threads.";

const finishReview = (page: Page) =>
  page.getByTestId('title-bar').getByRole('button', { name: 'Finish review' });
const tablist = (page: Page) => page.getByRole('tablist', { name: 'Comments', exact: true });
const tab = (page: Page, name: string) => tablist(page).getByRole('tab', { name, exact: true });
const panel = (page: Page) => page.getByRole('tabpanel');
const row = (page: Page, text: string): Locator =>
  panel(page).getByRole('listitem').filter({ hasText: text });
const checkButton = (page: Page) => page.getByRole('button', { name: CHECK, exact: true });
const chips = (page: Page) => page.getByText(/^Claude: /);

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

/** The version !482 is reviewed on, the one the mock's outdated threads were written on, another. */
const CURRENT = '9c41e07';
const WRITTEN_ON = '3b8d1f0';
const OTHER_OLDER = '2c7a4be';

interface Seed {
  resolved: boolean;
  path: string;
  line: number;
  /** The version the thread was written on; older than the reviewed one when not CURRENT. */
  head: string;
  author: keyof typeof USERS;
  body: string;
  replies: readonly (keyof typeof USERS)[];
}

async function seedThreads(page: Page, seeds: readonly Seed[]) {
  const threads = seeds.map((s, i) => ({
    id: `d-seed-${String(i + 1)}`,
    resolvable: true,
    resolved: s.resolved,
    outdated: s.head !== CURRENT,
    position: {
      oldPath: s.path,
      newPath: s.path,
      newLine: s.line,
      headSha: s.head,
      baseSha: '5e2a9c4',
    },
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

const KICK = 'Kick() is called on the UI thread. Does the worker block anything here?';
const INDEX = 'No index on CreatedAt, but every read sorts by it.';
const NETWORK = 'Do we need ACCESS_NETWORK_STATE here?';
const BANNER = 'Banner color should come from resources, not be hardcoded.';

/** SummaryDesk.dc.html's threads with the versions they were written on: KICK on the reviewed one. */
const seeds = (network: string): readonly Seed[] => [
  {
    resolved: false,
    path: VM,
    line: 48,
    head: CURRENT,
    author: 'pawel',
    body: KICK,
    replies: ['marta'],
  },
  {
    resolved: false,
    path: QUEUE,
    line: 34,
    head: WRITTEN_ON,
    author: 'pawel',
    body: INDEX,
    replies: ['you'],
  },
  {
    resolved: false,
    path: MANIFEST,
    line: 12,
    head: network,
    author: 'you',
    body: NETWORK,
    replies: ['pawel'],
  },
  {
    resolved: true,
    path: XAML,
    line: 22,
    head: OTHER_OLDER,
    author: 'ola',
    body: BANNER,
    replies: ['you', 'ola'],
  },
];

test('F-13.3 the threads of !482 are all written on the reviewed version: the Threads tab has no Check with Claude', async ({
  page,
}) => {
  await openThreads(page, 'Threads 3 open');
  await expect(row(page, 'Kick() is called on the UI thread')).toBeVisible();
  await expect(checkButton(page)).toHaveCount(0);
});

test('F-13.3 with an open thread written on an older version the tab offers Check with Claude, and nothing runs or shows a chip until it is clicked', async ({
  page,
}) => {
  await seedThreads(page, seeds(OTHER_OLDER));
  await openThreads(page, 'Threads 3 open');
  await expect(checkButton(page)).toBeVisible();
  await expect(checkButton(page)).toBeEnabled();
  await expect(chips(page)).toHaveCount(0);
  await expect(page.getByText(RUNNING, { exact: true })).toHaveCount(0);
  await expect(page.getByText(NONE, { exact: true })).toHaveCount(0);
});

test('F-13.3 Check with Claude puts "Claude: index added in a91f2c0" on the index thread only, and the thread stays open', async ({
  page,
}) => {
  await seedThreads(page, seeds(OTHER_OLDER));
  await openThreads(page, 'Threads 3 open');
  await checkButton(page).click();

  await expect(page.getByText(RUNNING, { exact: true })).toBeVisible();
  await expect(checkButton(page)).toBeDisabled();
  const chip = row(page, INDEX).getByText(CHIP, { exact: true });
  await expect(chip).toBeVisible();
  await expect(page.getByText(RUNNING, { exact: true })).toHaveCount(0);
  await expect(chips(page)).toHaveCount(1);
  await expect(row(page, KICK).getByText(/^Claude: /)).toHaveCount(0);
  await expect(row(page, NETWORK).getByText(/^Claude: /)).toHaveCount(0);
  await expect(row(page, BANNER).getByText(/^Claude: /)).toHaveCount(0);
  // Claude resolves nothing: the row still has Resolve and the tab still counts three open.
  await expect(
    row(page, INDEX).getByRole('button', { name: 'Resolve', exact: true }),
  ).toBeVisible();
  await expect(tab(page, 'Threads 3 open')).toBeVisible();
  await expect(checkButton(page)).toBeEnabled();
});

test('F-13.3 when no thread is addressed the tab says "Claude found no thread addressed by a later commit."', async ({
  page,
}) => {
  // Only NETWORK is a candidate, and it was written on a version Claude finds nothing after.
  const only = seeds(OTHER_OLDER).map((s) => (s.body === INDEX ? { ...s, head: CURRENT } : s));
  await seedThreads(page, only);
  await openThreads(page, 'Threads 3 open');
  await checkButton(page).click();
  await expect(page.getByText(NONE, { exact: true })).toBeVisible();
  await expect(chips(page)).toHaveCount(0);
  await expect(page.getByText(RUNNING, { exact: true })).toHaveCount(0);
});

test('F-13.3 a failed check says "Couldn\'t check the threads." with Retry, and Retry asks again', async ({
  page,
}) => {
  await page.addInitScript(
    ([key, scenario]: [string, string]) => {
      window.localStorage.setItem(key, scenario);
    },
    [CLAUDE_KEY, JSON.stringify({ suggestFails: 'limited' })] as [string, string],
  );
  await seedThreads(page, seeds(OTHER_OLDER));
  await openThreads(page, 'Threads 3 open');
  await checkButton(page).click();

  const alert = page.getByRole('alert').filter({ hasText: FAILED });
  await expect(alert).toBeVisible();
  await expect(chips(page)).toHaveCount(0);
  await expect(page.getByText(RUNNING, { exact: true })).toHaveCount(0);
  await alert.getByRole('button', { name: 'Retry', exact: true }).click();
  await expect(page.getByText(RUNNING, { exact: true })).toBeVisible();
  await expect(alert).toBeVisible();
  await expect(page.getByText(RUNNING, { exact: true })).toHaveCount(0);
});

test('F-13.3 the chip survives a visit to Drafts and goes away when the reviewer resolves the thread', async ({
  page,
}) => {
  await seedThreads(page, seeds(OTHER_OLDER));
  await openThreads(page, 'Threads 3 open');
  await checkButton(page).click();
  await expect(row(page, INDEX).getByText(CHIP, { exact: true })).toBeVisible();

  await tablist(page)
    .getByRole('tab', { name: /^Drafts/ })
    .click();
  await expect(checkButton(page)).toHaveCount(0);
  await tab(page, 'Threads 3 open').click();
  await expect(row(page, INDEX).getByText(CHIP, { exact: true })).toBeVisible();

  await row(page, INDEX).getByRole('button', { name: 'Resolve', exact: true }).click();
  await expect(row(page, INDEX).getByRole('button', { name: 'Reopen', exact: true })).toBeVisible();
  await expect(chips(page)).toHaveCount(0);
});
