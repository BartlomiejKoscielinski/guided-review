import { expect, test, type Locator, type Page } from '@playwright/test';
import { openStep1, restartApp } from './stepHelpers';

// F-14.1 against the mock backend (SummaryDesk.dc.html): S-05 of an MR session (!482) has the
// Approval tile to the right of the comments, on both tabs. Not approved by the user (the mock's
// start, "Approvals: 0 of 1"): the title "Not approved yet" in capitals, a dashed 44px square
// (--ring) and a dark tile. Approved by the user: a solid green tile with dark text, a dark square
// with a check, "Approved by you" and "Approvals: 1 of 1". M5 decision 14: "Approvals: X" when the
// MR asks for none; a restored start reads nothing from GitLab (F-30.4) and says to open the
// summary again. The mock backend's scenario knob `approval` (any of approvedBy, approvalsRequired,
// userHasApproved, userCanApprove, requirePasswordToApprove) is set in MOCK_GITLAB_KEY.
// Approve and Revoke are F-14.2's, the tile's notes F-14.3's. Not tried in the real app (stand-in
// GitLab: its /approvals answers required 0, GitLab EE unlicensed).
//
// Locators the screen keeps: the aside as role complementary named "Approval", the dashed or
// checked square as data-testid "approval-mark" (44 by 44 px, no rounded corners), the state and
// the count as separate text elements, the comments as role region named "Comments".

const GITLAB_KEY = 'guided-review.mock.gitlab';

const GREEN = 'rgb(99, 214, 118)';
const INK = 'rgb(16, 16, 16)';
const PANEL_2 = 'rgb(26, 26, 26)';
const TEXT = 'rgb(244, 244, 242)';
const RING = 'rgb(74, 74, 71)';

const ME = { username: 'bartek.k', name: 'Bartek K.' };
const ALICE = { username: 'alice', name: 'Alice Stand-in' };

const finishReview = (page: Page) =>
  page.getByTestId('title-bar').getByRole('button', { name: 'Finish review' });
const backToSteps = (page: Page) => page.getByRole('button', { name: 'Back to steps' });
const tile = (page: Page) => page.getByRole('complementary', { name: 'Approval', exact: true });
const mark = (page: Page) => tile(page).getByTestId('approval-mark');
const title = (page: Page, text: string) => tile(page).getByText(text, { exact: true });
const tab = (page: Page, name: string) =>
  page.getByRole('tablist', { name: 'Comments', exact: true }).getByRole('tab', { name });

async function setScenario(page: Page, scenario: object) {
  await page.addInitScript(
    ([key, value]) => {
      window.localStorage.setItem(key, value);
    },
    [GITLAB_KEY, JSON.stringify(scenario)] as [string, string],
  );
}

/** S-03 on step 1 of !482, then Finish review: S-05 (on Threads, the session has no drafts). */
async function openSummary(page: Page) {
  await openStep1(page);
  await finishReview(page).click();
  await expect(page.getByRole('heading', { name: /^summary$/i })).toBeVisible();
}

/** The tile, to the right of the Comments column and not below it. */
async function expectRightOfComments(page: Page) {
  const comments = await page.getByRole('region', { name: 'Comments', exact: true }).boundingBox();
  const aside = await tile(page).boundingBox();
  if (!comments || !aside) throw new Error('The comments or the tile have no box.');
  expect(aside.x).toBeGreaterThanOrEqual(comments.x + comments.width);
  expect(aside.y).toBeLessThan(comments.y + comments.height);
}

async function expectSquare(square: Locator) {
  await expect(square).toHaveCSS('width', '44px');
  await expect(square).toHaveCSS('height', '44px');
  await expect(square).toHaveCSS('border-top-left-radius', '0px');
}

test('F-14.1 an MR nobody approved: the dark tile at the right says NOT APPROVED YET with a dashed square and "Approvals: 0 of 1", on both tabs', async ({
  page,
}) => {
  await openSummary(page);

  await expect(tile(page)).toBeVisible();
  await expect(tile(page).getByRole('heading', { name: 'Approval', exact: true })).toBeVisible();
  await expectRightOfComments(page);
  const state = title(page, 'Not approved yet');
  await expect(state).toBeVisible();
  await expect(state).toHaveCSS('text-transform', 'uppercase');
  await expect(title(page, 'Approvals: 0 of 1')).toBeVisible();
  await expect(title(page, 'Approved by you')).toHaveCount(0);

  await expect(tile(page)).toHaveCSS('background-color', PANEL_2);
  await expect(tile(page)).toHaveCSS('color', TEXT);
  await expectSquare(mark(page));
  await expect(mark(page)).toHaveCSS('border-top-style', 'dashed');
  await expect(mark(page)).toHaveCSS('border-top-width', '2px');
  await expect(mark(page)).toHaveCSS('border-top-color', RING);
  await expect(mark(page).locator('svg')).toHaveCount(0);

  // The tile is not part of a tab: it stays as the tab changes.
  await tab(page, 'Drafts 0').click();
  await expect(tab(page, 'Drafts 0')).toHaveAttribute('aria-selected', 'true');
  await expect(title(page, 'Not approved yet')).toBeVisible();
  await expect(title(page, 'Approvals: 0 of 1')).toBeVisible();
  await expectRightOfComments(page);
});

test('F-14.1 approved by the user: a solid green tile with dark text, a dark square with a check, APPROVED BY YOU and "Approvals: 1 of 1"', async ({
  page,
}) => {
  await setScenario(page, { approval: { approvedBy: [ME], userHasApproved: true } });
  await openSummary(page);

  const state = title(page, 'Approved by you');
  await expect(state).toBeVisible();
  await expect(state).toHaveCSS('text-transform', 'uppercase');
  await expect(title(page, 'Approvals: 1 of 1')).toBeVisible();
  await expect(title(page, 'Not approved yet')).toHaveCount(0);
  await expectRightOfComments(page);

  await expect(tile(page)).toHaveCSS('background-color', GREEN);
  await expect(tile(page)).toHaveCSS('color', INK);
  await expectSquare(mark(page));
  await expect(mark(page)).toHaveCSS('background-color', INK);
  await expect(mark(page)).toHaveCSS('color', GREEN);
  await expect(mark(page)).toHaveCSS('border-top-style', 'none');
  await expect(mark(page).locator('svg')).toHaveCount(1);
});

test('F-14.1 a colleague approved and the user did not: still the dark tile and NOT APPROVED YET, "Approvals: 1 of 2"', async ({
  page,
}) => {
  await setScenario(page, { approval: { approvedBy: [ALICE], approvalsRequired: 2 } });
  await openSummary(page);

  await expect(title(page, 'Not approved yet')).toBeVisible();
  await expect(title(page, 'Approvals: 1 of 2')).toBeVisible();
  await expect(title(page, 'Approved by you')).toHaveCount(0);
  await expect(tile(page)).toHaveCSS('background-color', PANEL_2);
  await expect(mark(page)).toHaveCSS('border-top-style', 'dashed');
});

test('F-14.1 an MR that asks for no approval says "Approvals: 0", not "of 0"', async ({ page }) => {
  await setScenario(page, { approval: { approvalsRequired: 0 } });
  await openSummary(page);

  await expect(title(page, 'Not approved yet')).toBeVisible();
  await expect(title(page, 'Approvals: 0')).toBeVisible();
  await expect(tile(page)).not.toContainText(' of 0');
});

test('F-14.1 after the app starts again on S-05 the tile reads nothing from GitLab and says to open the summary again; opened again it shows the state', async ({
  page,
}) => {
  await setScenario(page, { approval: { approvedBy: [ME], userHasApproved: true } });
  await openSummary(page);
  await expect(title(page, 'Approved by you')).toBeVisible();

  await restartApp(page);

  await expect(tile(page)).toBeVisible();
  await expect(tile(page)).toContainText('Open the summary again to load the approval.');
  await expect(page.getByText('Approved by you')).toHaveCount(0);
  await expect(page.getByText('Not approved yet')).toHaveCount(0);
  await expect(page.getByText(/^Approvals:/)).toHaveCount(0);

  await backToSteps(page).click();
  await expect(page.getByText('Step 1 of 8')).toBeVisible();
  await finishReview(page).click();
  await expect(title(page, 'Approved by you')).toBeVisible();
  await expect(title(page, 'Approvals: 1 of 1')).toBeVisible();
  await expect(tile(page)).not.toContainText('Open the summary again');
});
