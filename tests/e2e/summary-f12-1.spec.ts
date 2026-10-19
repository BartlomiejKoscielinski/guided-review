import { expect, test, type Page } from '@playwright/test';
import { flushSaves, openStep1, restartApp } from './stepHelpers';

// F-12.1 against the mock backend (SummaryDesk.dc.html): S-05 of an MR session (!482) reads
// SUMMARY, the progress line ("All 8 steps reviewed." / "N of 8 steps reviewed.") and Back to
// steps. Until F-12.1 the screen was an empty stub whose heading is hidden from sight.

const SESSION_DATA_KEY = 'guided-review.mock.sessionData';
const ALL_STEPS = ['s1', 's2', 's3', 's4', 's5', 's6', 's7', 's8'];

const finishReview = (page: Page) =>
  page.getByTestId('title-bar').getByRole('button', { name: 'Finish review' });
const summaryHeading = (page: Page) => page.getByRole('heading', { name: /^summary$/i });
const backToSteps = (page: Page) => page.getByRole('button', { name: 'Back to steps' });

/** The heading is drawn: uppercase as in the mock and large (52px there), not the stub's 1px. */
async function expectDrawnHeading(page: Page) {
  const heading = summaryHeading(page);
  await expect(heading).toBeVisible();
  await expect(heading).toHaveText('SUMMARY', { useInnerText: true });
  const box = await heading.boundingBox();
  expect(box?.height ?? 0).toBeGreaterThan(30);
}

/**
 * Marks `ids` reviewed in the stored session data, then starts the app again (a page reload). The
 * marks are written by a script that runs before the app on the next load, so a save the page
 * makes while it closes cannot overwrite them.
 */
async function restartWithReviewed(page: Page, ids: string[]) {
  await flushSaves(page);
  await page.addInitScript(
    ({ key, reviewed }) => {
      const data = JSON.parse(localStorage.getItem(key) ?? '{}') as {
        plans?: Record<string, unknown>;
        marks?: Record<string, string[]>;
      };
      const session = Object.keys(data.plans ?? {})[0] ?? '';
      data.marks = { ...data.marks, [session]: reviewed };
      localStorage.setItem(key, JSON.stringify(data));
    },
    { key: SESSION_DATA_KEY, reviewed: ids },
  );
  await page.reload();
}

test('F-12.1 Finish review in an MR session opens SUMMARY with "1 of 8 steps reviewed." and Back to steps', async ({
  page,
}) => {
  await openStep1(page);
  await page.getByRole('button', { name: 'Mark reviewed' }).click();
  await expect(page.getByRole('button', { name: 'Reviewed', exact: true })).toBeVisible();

  await finishReview(page).click();
  await expectDrawnHeading(page);
  await expect(page.getByText('1 of 8 steps reviewed.', { exact: true })).toBeVisible();
  await expect(backToSteps(page)).toBeVisible();
  // The self-review's checklist is not the MR session's.
  await expect(page.getByRole('button', { name: 'Copy as checklist' })).toHaveCount(0);
  await expect(page.getByText('Nothing to fix.')).toHaveCount(0);
});

test('F-12.1 the progress line says "All 8 steps reviewed." when every step is reviewed', async ({
  page,
}) => {
  await openStep1(page);
  await restartWithReviewed(page, ALL_STEPS);
  await expect(page.getByText('Step 1 of 8')).toBeVisible();

  await finishReview(page).click();
  await expectDrawnHeading(page);
  await expect(page.getByText('All 8 steps reviewed.', { exact: true })).toBeVisible();
  await expect(page.getByText(/^\d of 8 steps reviewed\.$/)).toHaveCount(0);
  await expect(backToSteps(page)).toBeVisible();
});

test('F-12.1 Back to steps returns to the step screen', async ({ page }) => {
  await openStep1(page);
  await finishReview(page).click();
  await expectDrawnHeading(page);
  await expect(page.getByText('0 of 8 steps reviewed.', { exact: true })).toBeVisible();

  await backToSteps(page).click();
  await expect(page.getByText('Step 1 of 8')).toBeVisible();
  await expect(summaryHeading(page)).toHaveCount(0);
  await expect(page.getByRole('navigation', { name: 'Steps' })).toBeVisible();
});

test('F-12.1 Back to steps returns to the detailed step screen of a session in Detailed mode', async ({
  page,
}) => {
  await openStep1(page);
  await page.keyboard.press('Control+d');
  await expect(page.getByRole('complementary', { name: 'Guide' })).toBeVisible();
  await expect(page.getByText('Step 1 / 8', { exact: true })).toBeVisible();

  await finishReview(page).click();
  await expectDrawnHeading(page);
  await expect(page.getByText('0 of 8 steps reviewed.', { exact: true })).toBeVisible();

  await backToSteps(page).click();
  await expect(page.getByText('Step 1 / 8', { exact: true })).toBeVisible();
  await expect(page.getByRole('complementary', { name: 'Guide' })).toBeVisible();
  await expect(summaryHeading(page)).toHaveCount(0);
});

test('F-12.1 SUMMARY restored on start keeps its progress line and Back to steps', async ({
  page,
}) => {
  await openStep1(page);
  await page.getByRole('button', { name: 'Mark reviewed' }).click();
  await expect(page.getByRole('button', { name: 'Reviewed', exact: true })).toBeVisible();
  await finishReview(page).click();
  await expect(page.getByText('1 of 8 steps reviewed.', { exact: true })).toBeVisible();

  await restartApp(page);
  await expectDrawnHeading(page);
  await expect(page.getByText('1 of 8 steps reviewed.', { exact: true })).toBeVisible();
  await expect(backToSteps(page)).toBeVisible();
});
