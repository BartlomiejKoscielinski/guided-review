import { expect, test, type Page } from '@playwright/test';

// F-26.8: S-10 while the checkout is not on the MR's source branch, against the mock backend's !480
// with the scenario `{ "onSourceBranch": false }` in localStorage 'guided-review.mock.author'.
// Author mode is read-only: the notice "Check out feature/upload-retry to fix here. The app never
// switches your branch.", **Open in Rider · line 46** in the file bar; Fix with Claude and Fix in
// Rider are hidden; Reply stays, a question keeps Draft with Claude and Send reply.
//
// Locators the screen keeps: the card is the region "Thread"; the list is the listbox "Threads";
// the notice is one element holding the whole sentence.

const NOTICE = 'Check out feature/upload-retry to fix here. The app never switches your branch.';

const threads = (page: Page) => page.getByRole('listbox', { name: 'Threads' });
const card = (page: Page) => page.getByRole('region', { name: 'Thread' });

async function author(page: Page, onSourceBranch: boolean) {
  await page.addInitScript((value) => {
    localStorage.setItem('guided-review.mock.author', JSON.stringify({ onSourceBranch: value }));
  }, onSourceBranch);
  await page.goto('/');
  await expect(page.getByTestId('title-bar')).toBeVisible();
  const mrs = page.getByRole('region', { name: 'Merge requests' });
  await mrs.getByRole('tab', { name: /^Mine/ }).click();
  await mrs.getByText('Retry in UploadWorker after network loss').click();
  await expect(card(page)).toBeVisible();
}

test('F-26.8 off the source branch the notice shows, Fix is hidden and Reply and Open in Rider stay', async ({
  page,
}) => {
  await author(page, false);

  await expect(page.getByText(NOTICE, { exact: true })).toBeVisible();
  await expect(card(page).getByRole('button', { name: 'Fix with Claude' })).toHaveCount(0);
  await expect(card(page).getByRole('button', { name: 'Fix in Rider' })).toHaveCount(0);
  await expect(card(page).getByRole('button', { name: 'Reply', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Open in Rider · line 46' })).toBeVisible();
  await expect(page.getByRole('region', { name: 'Commit and push' })).toHaveCount(0);
});

test('F-26.8 off the source branch a question keeps Draft with Claude and Send reply', async ({
  page,
}) => {
  await author(page, false);

  await threads(page)
    .getByRole('option', { name: /Piotr S\./ })
    .click();

  await expect(page.getByText(NOTICE, { exact: true })).toBeVisible();
  await expect(card(page).getByRole('textbox', { name: 'Your reply' })).toBeVisible();
  await expect(card(page).getByRole('button', { name: 'Draft with Claude' })).toBeEnabled();
  await expect(card(page).getByRole('button', { name: 'Send reply' })).toBeVisible();
});

test('F-26.8 on the source branch the notice is absent and Fix with Claude and Fix in Rider show', async ({
  page,
}) => {
  await author(page, true);

  await expect(page.getByText(/The app never switches your branch\./)).toHaveCount(0);
  await expect(card(page).getByRole('button', { name: 'Fix with Claude' })).toBeVisible();
  await expect(card(page).getByRole('button', { name: 'Fix in Rider' })).toBeVisible();
});
