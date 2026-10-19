import { expect, test, type Page } from '@playwright/test';
import { openStep, openStep1, restartApp } from './stepHelpers';

// F-12.6 against the mock backend (SummaryDesk.dc.html): publishing never approves the MR. On S-05
// of an MR session (!482) a Publish sends the ticked drafts and nothing else: afterwards the page
// shows the banner "Published 2 comments. The author got a single notification." and no approved
// state anywhere, not "Approved by you" (the Approval tile of F-14.1, solid green in the mock's
// `approved` state) and not the "Revoke approval" button, also after the app starts again. Which
// commands the screen calls is locked in MrSummaryNoApproval.test.tsx; the other half (approving
// published nothing, 'F-12.6 approving published nothing') needs the Approve button of F-14.2 and
// is written with it (docs/plans/M5.md, item 9). Not tried in the real app (stand-in GitLab).

const SINGLE = 'The author got a single notification.';

const NOTES = [
  { title: 'The whole photo goes into SQLite as byte[]', n: 1 },
  { title: 'PendingCount won’t refresh after upload', n: 2 },
] as const;

const finishReview = (page: Page) =>
  page.getByTestId('title-bar').getByRole('button', { name: 'Finish review' });
const panel = (page: Page) => page.getByRole('tabpanel');
const banner = (page: Page, text: string) => page.getByRole('status').filter({ hasText: text });

async function addDraftOf(page: Page, note: (typeof NOTES)[number]) {
  await page.getByRole('button', { name: `Note ${String(note.n)}: ${note.title}` }).click();
  const card = page.getByRole('article', { name: `Claude note: ${note.title}` });
  await card.getByRole('button', { name: 'Add to drafts' }).click();
  await expect(card.getByText(/Added to drafts\./)).toBeVisible();
}

/** Two drafts (notes 1 and 2 of step 4), then Finish review: S-05 on the Drafts tab. */
async function openDrafts(page: Page) {
  await openStep1(page);
  await openStep(page, /ViewModel/, 4);
  for (const note of NOTES) await addDraftOf(page, note);
  await finishReview(page).click();
  await expect(page.getByRole('heading', { name: /^summary$/i })).toBeVisible();
  await expect(panel(page).getByRole('listitem')).toHaveCount(2);
}

async function expectNotApproved(page: Page) {
  await expect(page.getByText(/approved by you/i)).toHaveCount(0);
  await expect(page.getByRole('button', { name: /revoke approval/i })).toHaveCount(0);
}

test('F-12.6 Publish sends the comments and does not approve the MR: no approved state after it, also after the app starts again', async ({
  page,
}) => {
  await openDrafts(page);
  await expectNotApproved(page);

  await page.getByRole('button', { name: 'Publish (2)', exact: true }).click();

  await expect(banner(page, `Published 2 comments. ${SINGLE}`)).toBeVisible();
  await expect(page.getByRole('button', { name: 'Published', exact: true })).toBeDisabled();
  await expectNotApproved(page);

  await restartApp(page);
  await expect(panel(page).getByRole('listitem')).toHaveCount(2);
  await expect(page.getByRole('button', { name: 'Published', exact: true })).toBeDisabled();
  await expectNotApproved(page);
});
