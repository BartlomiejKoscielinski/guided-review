import { expect, test, type Locator, type Page } from '@playwright/test';
import { openStep1 } from './stepHelpers';

// F-13.3 against the mock backend: the status region next to Check with Claude is in the
// accessibility tree before the first run, while it is still empty, so a screen reader announces
// "Claude is checking the threads…" and the none line when they appear in it (WCAG 4.1.3). An
// empty region hidden with display:none is not, and live regions added to the tree together with
// their text are often not read out. The empty region adds no gap next to the button either.
// The mock stands in for Claude: an open thread written on 3b8d1f0 is addressed by a91f2c0, one
// written on another older version is a candidate Claude does not find addressed.

const CLAUDE_KEY = 'guided-review.mock.claude';
const CHECK = 'Check with Claude';
const RUNNING = 'Claude is checking the threads…';
const NONE = 'Claude found no thread addressed by a later commit.';
const FAILED = "Couldn't check the threads.";
/** The column gap of the check bar (Threads.module.css `.check`). */
const GAP = 14;

const checkButton = (page: Page) => page.getByRole('button', { name: CHECK, exact: true });
/** The status region of the check bar: the button's sibling, found as the tree has it. */
const checkStatus = (page: Page): Locator =>
  checkButton(page).locator('xpath=..').getByRole('status');

/** One open thread on SqliteUploadQueue.cs written on `head`, an older version than 9c41e07. */
async function seedOneThread(page: Page, head: string) {
  const thread = {
    id: 'd-seed-1',
    resolvable: true,
    resolved: false,
    outdated: true,
    position: {
      oldPath: 'src/Mobile.Infrastructure/Uploads/SqliteUploadQueue.cs',
      newPath: 'src/Mobile.Infrastructure/Uploads/SqliteUploadQueue.cs',
      newLine: 34,
      headSha: head,
      baseSha: '5e2a9c4',
    },
    notes: [
      {
        id: 70000,
        author: { username: 'pawel.s', name: 'Paweł S.' },
        body: 'No index on CreatedAt, but every read sorts by it.',
        createdAt: '2026-10-12T09:10:00.000Z',
      },
    ],
  };
  await page.addInitScript((data) => {
    localStorage.setItem('guided-review.mock.sessionData', JSON.stringify({ threads: [data] }));
  }, thread);
}

async function openThreads(page: Page) {
  await openStep1(page);
  await page.getByTestId('title-bar').getByRole('button', { name: 'Finish review' }).click();
  await expect(
    page
      .getByRole('tablist', { name: 'Comments', exact: true })
      .getByRole('tab', { name: 'Threads 1 open', exact: true }),
  ).toHaveAttribute('aria-selected', 'true');
  await expect(checkButton(page)).toBeVisible();
}

test('F-13.3 the check status region is in the accessibility tree before the first run, and the running line appears in it', async ({
  page,
}) => {
  await seedOneThread(page, '3b8d1f0');
  await openThreads(page);
  await expect(checkStatus(page)).toHaveCount(1);
  await expect(checkStatus(page)).toHaveText('');
  await checkButton(page).click();
  await expect(checkStatus(page)).toHaveText(RUNNING);
  await expect(page.getByText(/^Claude: /)).toBeVisible();
  await expect(checkStatus(page)).toHaveText('');
});

test('F-13.3 the none line appears in the status region that was there before the run', async ({
  page,
}) => {
  await seedOneThread(page, '2c7a4be');
  await openThreads(page);
  await expect(checkStatus(page)).toHaveCount(1);
  await checkButton(page).click();
  await expect(checkStatus(page)).toHaveText(NONE);
});

test('F-13.3 the empty status region adds no gap between Check with Claude and the failure line', async ({
  page,
}) => {
  await page.addInitScript(
    ([key, scenario]: [string, string]) => {
      window.localStorage.setItem(key, scenario);
    },
    [CLAUDE_KEY, JSON.stringify({ suggestFails: 'limited' })] as [string, string],
  );
  await seedOneThread(page, '3b8d1f0');
  await openThreads(page);
  await checkButton(page).click();
  const alert = page.getByRole('alert').filter({ hasText: FAILED });
  await expect(alert).toBeVisible();
  await expect(checkStatus(page)).toHaveCount(1);
  const button = await checkButton(page).boundingBox();
  const failed = await alert.boundingBox();
  expect(button).not.toBeNull();
  expect(failed).not.toBeNull();
  if (button === null || failed === null) return;
  expect(failed.x - (button.x + button.width)).toBeCloseTo(GAP, 0);
});
