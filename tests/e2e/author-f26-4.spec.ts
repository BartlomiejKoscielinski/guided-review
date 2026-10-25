import { expect, test, type Page } from '@playwright/test';

// F-26.4: S-10's commit panel after a fix, against the mock backend's !480 (Author.dc.html
// `cStage`). Fix in Rider, the mock's Rider changes the file about 2.2 s later, and the bottom of
// the main column shows the region "Commit and push": "Commit the fix", the textbox "Commit
// message" (prefilled "Address review on UploadWorker.cs:46"), the switch
// "As a fixup of b71e3a0 “Retry in UploadWorker”" (on) with its note, and **Commit**, which ends
// in "Committed" and the short sha.
//
// Locators the screen keeps: the region named "Commit and push"; inside it the textbox "Commit
// message", the checkbox named `As a fixup of b71e3a0 “Retry in UploadWorker”`, the buttons
// "Suggest" and "Commit"; the note is plain text in the region.

const DETECTED = 'Change detected from Rider. Commit it below.';
const MESSAGE = 'Address review on UploadWorker.cs:46';
const NOTE_ON =
  'Marked as a fixup of b71e3a0. Fold it in with git rebase --autosquash before merging, or merge with Squash commits.';
const NOTE_OFF = 'Stays a separate commit.';

const bar = (page: Page) => page.getByTestId('title-bar');
const threads = (page: Page) => page.getByRole('listbox', { name: 'Threads' });
const card = (page: Page) => page.getByRole('region', { name: 'Thread' });
const panel = (page: Page) => page.getByRole('region', { name: 'Commit and push' });
const fixup = (page: Page) =>
  panel(page).getByRole('checkbox', { name: 'As a fixup of b71e3a0 “Retry in UploadWorker”' });

async function openAuthor(page: Page) {
  await page.goto('/');
  await expect(bar(page)).toBeVisible();
  const mrs = page.getByRole('region', { name: 'Merge requests' });
  await mrs.getByRole('tab', { name: /^Mine/ }).click();
  await mrs.getByText('Retry in UploadWorker after network loss').click();
  await expect(bar(page).getByText('You’re the author')).toBeVisible();
  await expect(card(page).getByRole('button', { name: 'Fix in Rider' })).toBeVisible();
}

async function fixInRider(page: Page) {
  await openAuthor(page);
  await expect(panel(page)).toHaveCount(0);
  await card(page).getByRole('button', { name: 'Fix in Rider' }).click();
  await expect(card(page).getByText(DETECTED)).toBeVisible({ timeout: 8000 });
  await expect(panel(page)).toBeVisible();
}

test('F-26.4 after Fix in Rider the commit panel offers the message, the fixup switch on and Commit', async ({
  page,
}) => {
  await fixInRider(page);

  await expect(panel(page).getByText('Commit the fix')).toBeVisible();
  await expect(panel(page).getByRole('textbox', { name: 'Commit message' })).toHaveValue(MESSAGE);
  await expect(panel(page).getByRole('button', { name: 'Suggest' })).toBeVisible();
  await expect(fixup(page)).toBeChecked();
  await expect(panel(page)).toContainText(NOTE_ON);
  await expect(panel(page).getByRole('button', { name: 'Commit', exact: true })).toBeEnabled();
});

test('F-26.4 the fixup switch changes the note to “Stays a separate commit.” and back', async ({
  page,
}) => {
  await fixInRider(page);

  await fixup(page).uncheck();
  await expect(panel(page)).toContainText(NOTE_OFF);
  await expect(panel(page)).not.toContainText('Marked as a fixup');

  await fixup(page).check();
  await expect(panel(page)).toContainText(NOTE_ON);
  await expect(panel(page)).not.toContainText(NOTE_OFF);
});

test('F-26.4 Commit ends in “Committed” with the short sha, as a fixup and as a separate commit', async ({
  page,
}) => {
  await fixInRider(page);
  await panel(page).getByRole('textbox', { name: 'Commit message' }).fill('Backoff doubles.');
  await panel(page).getByRole('button', { name: 'Commit', exact: true }).click();

  await expect(panel(page).getByText('Committed', { exact: true })).toBeVisible();
  await expect(panel(page)).toContainText(/\b[0-9a-f]{7}\b/);
  await expect(panel(page).getByRole('button', { name: 'Commit', exact: true })).toHaveCount(0);
  await expect(panel(page).getByRole('textbox', { name: 'Commit message' })).toHaveCount(0);
});

test('F-26.4 with the switch off Commit also ends in “Committed”', async ({ page }) => {
  await fixInRider(page);
  await fixup(page).uncheck();

  await panel(page).getByRole('button', { name: 'Commit', exact: true }).click();

  await expect(panel(page).getByText('Committed', { exact: true })).toBeVisible();
});

test('F-26.4 picking another thread hides the panel; coming back brings it with the typed message and the switch', async ({
  page,
}) => {
  await fixInRider(page);
  await panel(page).getByRole('textbox', { name: 'Commit message' }).fill('Backoff doubles.');
  await fixup(page).uncheck();

  await threads(page)
    .getByRole('option', { name: /Piotr S\./ })
    .click();
  await expect(page.getByRole('button', { name: 'Open in Rider · line 36' })).toBeVisible();
  await expect(panel(page)).toHaveCount(0);

  await threads(page)
    .getByRole('option', { name: /Marta K\./ })
    .click();
  await expect(panel(page).getByRole('textbox', { name: 'Commit message' })).toHaveValue(
    'Backoff doubles.',
  );
  await expect(fixup(page)).not.toBeChecked();
});
