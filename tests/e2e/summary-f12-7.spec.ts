import { expect, test, type Page } from '@playwright/test';

// F-12.7 against the mock backend (SummaryDesk.dc.html, Start.dc.html, docs/plans/M5.md decision
// 15): drafts belong to the MR. A draft made outside a review (Explain failure on S-08, Add as a
// question on S-12; both screens come in later milestones) joins the latest session of its MR or
// creates a "drafts only" session. Such a session appears under "Pick up where you left off" with
// its draft count only; Continue opens S-05 without a progress line and without Back to steps;
// it leaves the list once all its drafts are published. The drafts are made through the mock
// backend's own `draftsCreateForMr` in the page (the producers are not built yet); the mock keeps
// them in localStorage like the core keeps them in SQLite, so a reload is the app starting again.
// Not tried in the real app (stand-in GitLab).

const PROJECT = 'mobile/mobile-app';
const FAILURE = 'Why did the Android build fail on the signing step?';
const QUESTION = 'Does anything outside this MR still call `UploadQueue.Enqueue`?';
const SINGLE = 'The author got a single notification.';

const dock = (page: Page) => page.getByRole('navigation', { name: 'App' });
const tile = (page: Page, name: string) =>
  dock(page).getByRole('button', { name: new RegExp(`^${name}`) });
const pickUp = (page: Page) => page.getByRole('region', { name: 'Pick up where you left off' });
const panel = (page: Page) => page.getByRole('tabpanel');

/** Drafts for !482 made outside a review, then the app starts again on S-01. */
async function startWithDraftsOutsideAReview(page: Page, bodies: string[]) {
  await page.goto('/');
  await expect(page.getByTestId('title-bar')).toBeVisible();
  for (const body of bodies) {
    await page.evaluate(`(async () => {
      const { createMockClient } = await import('/src/ipc/mock/index.ts');
      const ipc = createMockClient({ latencyMs: 0, storage: window.localStorage });
      await ipc.draftsCreateForMr(${JSON.stringify(PROJECT)}, 482, {
        body: ${JSON.stringify(body)},
        position: null,
        severity: 'q',
      });
    })()`);
  }
  await page.reload();
  await expect(page.getByTestId('title-bar')).toBeVisible();
}

/** The summary of the drafts-only session, opened with Continue on its card. */
async function openDraftsOnlySummary(page: Page) {
  await startWithDraftsOutsideAReview(page, [FAILURE, QUESTION]);
  await pickUp(page).getByRole('button', { name: 'Continue' }).click();
  await expect(page.getByRole('heading', { name: /^summary$/i })).toBeVisible();
  await expect(panel(page).getByRole('listitem')).toHaveCount(2);
}

const expectNoStepsUi = async (page: Page) => {
  await expect(page.getByRole('button', { name: 'Back to steps' })).toHaveCount(0);
  await expect(page.getByText(/steps? reviewed\./)).toHaveCount(0);
};

test('F-12.7 a draft made outside a review puts its MR under Pick up where you left off with the draft count only', async ({
  page,
}) => {
  await startWithDraftsOutsideAReview(page, [FAILURE, QUESTION]);

  const cards = pickUp(page);
  await expect(cards.getByRole('heading', { name: 'Pick up where you left off' })).toBeVisible();
  await expect(cards.getByText('!482', { exact: true })).toBeVisible();
  await expect(cards.getByText('2 drafts', { exact: true })).toBeVisible();
  await expect(cards.getByText(/step/)).toHaveCount(0);
  await expect(cards.getByRole('button', { name: 'Continue' })).toHaveCount(1);
});

test('F-12.7 Continue opens S-05 with the drafts, Publish, no progress line and no Back to steps', async ({
  page,
}) => {
  await openDraftsOnlySummary(page);

  await expect(panel(page).getByText(FAILURE)).toBeVisible();
  await expect(panel(page).getByText(QUESTION)).toBeVisible();
  await expect(page.getByRole('button', { name: 'Publish (2)', exact: true })).toBeEnabled();
  await expect(page.getByRole('tab', { name: /^Threads/ })).toBeVisible();
  await expectNoStepsUi(page);
});

test('F-12.7 Publish sends the drafts of the drafts-only session, also after the app starts again, and its card is gone', async ({
  page,
}) => {
  await openDraftsOnlySummary(page);

  await page.getByRole('button', { name: 'Publish (2)', exact: true }).click();

  await expect(
    page.getByRole('status').filter({ hasText: `Published 2 comments. ${SINGLE}` }),
  ).toBeVisible();
  await expect(page.getByRole('button', { name: 'Published', exact: true })).toBeDisabled();
  await expectNoStepsUi(page);

  // The app starts again on this summary: the published rows, still no steps.
  await page.waitForFunction(() =>
    (localStorage.getItem('guided-review.mock.settings') ?? '').includes('"S-05"'),
  );
  await page.reload();
  await expect(page.getByRole('heading', { name: /^summary$/i })).toBeVisible();
  await expect(panel(page).getByRole('listitem')).toHaveCount(2);
  await expect(panel(page).getByText(/· published/)).toHaveCount(2);
  await expectNoStepsUi(page);

  // Nothing is left to publish, so the session is not offered under Pick up any more.
  await tile(page, 'MRs').click();
  await expect(page.getByRole('main', { name: 'Start' })).toBeVisible();
  await expect(pickUp(page)).toHaveCount(0);
});

test('F-12.7 the Review tile resumes the drafts-only session at its summary', async ({ page }) => {
  // M5 tests decision: Review opens the first session of the same list Pick up shows.
  await startWithDraftsOutsideAReview(page, [FAILURE]);

  await expect(tile(page, 'Review')).not.toHaveAttribute('aria-disabled', 'true');
  await tile(page, 'Review').click();

  await expect(page.getByRole('heading', { name: /^summary$/i })).toBeVisible();
  await expect(panel(page).getByText(FAILURE)).toBeVisible();
  await expectNoStepsUi(page);
});
