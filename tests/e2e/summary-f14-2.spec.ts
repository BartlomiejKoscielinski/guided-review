import { expect, test, type Page } from '@playwright/test';
import { openStep1 } from './stepHelpers';

// F-14.2 against the mock backend (SummaryDesk.dc.html): in the Approval tile of S-05, a green
// button "Approve MR" (50 px high, --green fill, dark ink, uppercase) sends the approval for the
// reviewed head; the tile turns solid green "Approved by you" with a dark button "Revoke approval"
// (44 px high, dark fill, light ink, uppercase). Revoke goes back. When the MR has a new version
// (scenario knob `mrChanged` in MOCK_GITLAB_KEY) the screen says "The MR has a new version since
// your review." with "See what changed" (S-09) and Approve MR is disabled. Not tried in the real
// app (the stand-in GitLab has no approval rules, GitLab EE unlicensed).
//
// Locators the screen keeps: the aside role complementary named "Approval" with the buttons by
// their names; the banner as text with the exact copy; "See what changed" as a button.

const GITLAB_KEY = 'guided-review.mock.gitlab';
const BANNER = 'The MR has a new version since your review.';

const GREEN = 'rgb(99, 214, 118)';
const INK = 'rgb(16, 16, 16)';
const TEXT = 'rgb(244, 244, 242)';

const finishReview = (page: Page) =>
  page.getByTestId('title-bar').getByRole('button', { name: 'Finish review' });
const tile = (page: Page) => page.getByRole('complementary', { name: 'Approval', exact: true });
const approve = (page: Page) => tile(page).getByRole('button', { name: 'Approve MR', exact: true });
const revoke = (page: Page) =>
  tile(page).getByRole('button', { name: 'Revoke approval', exact: true });

async function setScenario(page: Page, scenario: object) {
  await page.addInitScript(
    ([key, value]) => {
      window.localStorage.setItem(key, value);
    },
    [GITLAB_KEY, JSON.stringify(scenario)] as [string, string],
  );
}

async function openSummary(page: Page) {
  await openStep1(page);
  await finishReview(page).click();
  await expect(page.getByRole('heading', { name: /^summary$/i })).toBeVisible();
}

test('F-14.2 approve and revoke: Approve MR turns the tile green with "Approved by you", Revoke approval turns it back', async ({
  page,
}) => {
  await openSummary(page);

  const button = approve(page);
  await expect(button).toBeVisible();
  await expect(button).toBeEnabled();
  await expect(button).toHaveCSS('height', '50px');
  await expect(button).toHaveCSS('background-color', GREEN);
  await expect(button).toHaveCSS('color', INK);
  await expect(button).toHaveCSS('text-transform', 'uppercase');
  await expect(revoke(page)).toHaveCount(0);

  await button.click();

  await expect(tile(page).getByText('Approved by you', { exact: true })).toBeVisible();
  await expect(tile(page).getByText('Approvals: 1 of 1', { exact: true })).toBeVisible();
  await expect(tile(page)).toHaveCSS('background-color', GREEN);
  await expect(approve(page)).toHaveCount(0);
  const back = revoke(page);
  await expect(back).toBeVisible();
  await expect(back).toHaveCSS('height', '44px');
  await expect(back).toHaveCSS('background-color', INK);
  await expect(back).toHaveCSS('color', TEXT);
  await expect(back).toHaveCSS('text-transform', 'uppercase');

  await back.click();

  await expect(tile(page).getByText('Not approved yet', { exact: true })).toBeVisible();
  await expect(tile(page).getByText('Approvals: 0 of 1', { exact: true })).toBeVisible();
  await expect(approve(page)).toBeEnabled();
  await expect(revoke(page)).toHaveCount(0);
});

test('F-14.2 the MR changed since the review: the banner and See what changed show, Approve MR is disabled and sends nothing', async ({
  page,
}) => {
  await setScenario(page, { mrChanged: true });
  await openSummary(page);

  await expect(page.getByText(BANNER, { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'See what changed', exact: true })).toBeVisible();
  await expect(approve(page)).toBeDisabled();
  await expect(tile(page).getByText('Not approved yet', { exact: true })).toBeVisible();
});

test('F-14.2 See what changed leaves the summary for S-09', async ({ page }) => {
  await setScenario(page, { mrChanged: true });
  await openSummary(page);

  await page.getByRole('button', { name: 'See what changed', exact: true }).click();

  await expect(page.getByRole('heading', { name: /^summary$/i })).toHaveCount(0);
  await expect(page).toHaveURL(/since-last-review/);
});

test('F-14.2 Enter does not approve: with the summary open the tile stays "Not approved yet"', async ({
  page,
}) => {
  await openSummary(page);
  await expect(approve(page)).toBeEnabled();

  await page.keyboard.press('Enter');
  await page.keyboard.press('Control+Enter');

  await expect(tile(page).getByText('Not approved yet', { exact: true })).toBeVisible();
  await expect(revoke(page)).toHaveCount(0);
});
