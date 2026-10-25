import { expect, test, type Page } from '@playwright/test';

// F-26.5: S-10 after Commit, against the mock backend's !480 (Author.dc.html `cPush`). The
// region "Commit and push" shows "Committed", the short sha and "not pushed yet", the caption
// "Sent to Marta’s thread after push", the textbox "Reply to send" ("Fixed in <sha>. <sentence>."),
// the checkbox "Resolve the thread" (on) and **Push and reply**, which shows
// "Pushing to origin/feature/upload-retry…" and then leaves the form. The list tags the thread
// "Fixed locally · not pushed" meanwhile.
//
// Locators the screen keeps: the region named "Commit and push"; inside it the elements with the
// own text "Committed" and "not pushed yet", the textbox "Reply to send", the checkbox
// "Resolve the thread", the button "Push and reply"; the busy line is a role=status element.

const DETECTED = 'Change detected from Rider. Commit it below.';
const SHA = /\b[0-9a-f]{7}\b/;

const bar = (page: Page) => page.getByTestId('title-bar');
const threads = (page: Page) => page.getByRole('listbox', { name: 'Threads' });
const card = (page: Page) => page.getByRole('region', { name: 'Thread' });
const panel = (page: Page) => page.getByRole('region', { name: 'Commit and push' });

async function committedFix(page: Page, message: string) {
  await page.goto('/');
  await expect(bar(page)).toBeVisible();
  const mrs = page.getByRole('region', { name: 'Merge requests' });
  await mrs.getByRole('tab', { name: /^Mine/ }).click();
  await mrs.getByText('Retry in UploadWorker after network loss').click();
  await expect(card(page).getByRole('button', { name: 'Fix in Rider' })).toBeVisible();
  await card(page).getByRole('button', { name: 'Fix in Rider' }).click();
  await expect(card(page).getByText(DETECTED)).toBeVisible({ timeout: 8000 });
  await panel(page).getByRole('textbox', { name: 'Commit message' }).fill(message);
  await panel(page).getByRole('button', { name: 'Commit', exact: true }).click();
  await expect(panel(page).getByText('not pushed yet', { exact: true })).toBeVisible();
}

test('F-26.5 after Commit the panel offers the reply, “Resolve the thread” (on) and Push and reply', async ({
  page,
}) => {
  await committedFix(page, 'Backoff doubles and stops at 60 s.');

  await expect(panel(page).getByText('Committed', { exact: true })).toBeVisible();
  await expect(panel(page)).toContainText(SHA);
  await expect(panel(page).getByText('Sent to Marta’s thread after push')).toBeVisible();
  await expect(panel(page).getByRole('textbox', { name: 'Reply to send' })).toHaveValue(
    /^Fixed in [0-9a-f]{7}\. Backoff doubles and stops at 60 s\.$/,
  );
  await expect(panel(page).getByRole('checkbox', { name: 'Resolve the thread' })).toBeChecked();
  await expect(panel(page).getByRole('button', { name: 'Push and reply' })).toBeEnabled();
  await expect(
    panel(page).getByText('The reply waits for the push, so the link always works.'),
  ).toBeVisible();
  await expect(threads(page).getByRole('option', { name: /Marta K\./ })).toContainText(
    'Fixed locally · not pushed',
  );
});

test('F-26.5 Push and reply shows the pushing line, then the form is gone', async ({ page }) => {
  await committedFix(page, 'Backoff doubles.');
  await panel(page)
    .getByRole('textbox', { name: 'Reply to send' })
    .fill('Fixed in 7c1e2a9. Edited.');
  await panel(page).getByRole('checkbox', { name: 'Resolve the thread' }).uncheck();

  await panel(page).getByRole('button', { name: 'Push and reply' }).click();

  await expect(page.getByText('Pushing to origin/feature/upload-retry…')).toBeVisible();
  await expect(panel(page).getByRole('button', { name: 'Push and reply' })).toHaveCount(0);
  await expect(page.getByText('Pushing to origin/feature/upload-retry…')).toHaveCount(0, {
    timeout: 8000,
  });
  await expect(panel(page).getByRole('textbox', { name: 'Reply to send' })).toHaveCount(0);
});

test('F-26.5 the typed reply and the switch stay when you pick another thread and come back', async ({
  page,
}) => {
  await committedFix(page, 'Backoff doubles.');
  await panel(page).getByRole('textbox', { name: 'Reply to send' }).fill('Fixed in 7c1e2a9. Kept.');
  await panel(page).getByRole('checkbox', { name: 'Resolve the thread' }).uncheck();

  await threads(page)
    .getByRole('option', { name: /Piotr S\./ })
    .click();
  await expect(panel(page)).toHaveCount(0);
  await threads(page)
    .getByRole('option', { name: /Marta K\./ })
    .click();

  await expect(panel(page).getByRole('textbox', { name: 'Reply to send' })).toHaveValue(
    'Fixed in 7c1e2a9. Kept.',
  );
  await expect(panel(page).getByRole('checkbox', { name: 'Resolve the thread' })).not.toBeChecked();
});
