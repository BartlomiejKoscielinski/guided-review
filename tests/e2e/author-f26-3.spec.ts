import { expect, test, type Page } from '@playwright/test';

// F-26.3: S-10 Fix in Rider against the mock backend's !480 (Author.dc.html `fixRider`): the
// click on "Fix in Rider" in the thread card replaces the actions with the busy line "Opened
// UploadWorker.cs:46 in Rider. Waiting for your change…" and "Stop waiting"; the mock's Rider
// changes the file about 2.2 s later and the card says "Change detected from Rider. Commit it
// below.". Stop waiting and picking another thread end the waiting without that line.
//
// Locators the screen keeps: the region named "Thread" with the buttons "Fix with Claude",
// "Fix in Rider", "Reply", "Stop waiting"; the busy and detected lines are role=status elements in
// it; a listbox named "Threads" (role=option rows).

const BUSY = 'Opened UploadWorker.cs:46 in Rider. Waiting for your change…';
const DETECTED = 'Change detected from Rider. Commit it below.';

const bar = (page: Page) => page.getByTestId('title-bar');
const threads = (page: Page) => page.getByRole('listbox', { name: 'Threads' });
const card = (page: Page) => page.getByRole('region', { name: 'Thread' });

async function openAuthor(page: Page) {
  await page.goto('/');
  await expect(bar(page)).toBeVisible();
  const mrs = page.getByRole('region', { name: 'Merge requests' });
  await mrs.getByRole('tab', { name: /^Mine/ }).click();
  await mrs.getByText('Retry in UploadWorker after network loss').click();
  await expect(bar(page).getByText('You’re the author')).toBeVisible();
  await expect(card(page).getByRole('button', { name: 'Fix in Rider' })).toBeVisible();
}

test('F-26.3 Fix in Rider shows the busy line, then “Change detected from Rider. Commit it below.”', async ({
  page,
}) => {
  await openAuthor(page);

  await card(page).getByRole('button', { name: 'Fix in Rider' }).click();

  const busy = card(page).getByRole('status').filter({ hasText: BUSY });
  await expect(busy).toBeVisible();
  await expect(card(page).getByRole('button', { name: 'Stop waiting' })).toBeVisible();
  await expect(card(page).getByRole('button', { name: 'Fix in Rider' })).toHaveCount(0);
  await expect(card(page).getByRole('button', { name: 'Fix with Claude' })).toHaveCount(0);

  // The mock's Rider edits the file after about 2.2 s.
  const detected = card(page).getByRole('status').filter({ hasText: DETECTED });
  await expect(detected).toBeVisible({ timeout: 8000 });
  await expect(busy).toHaveCount(0);
  await expect(card(page).getByRole('button', { name: 'Stop waiting' })).toHaveCount(0);
});

test('F-26.3 Stop waiting brings the actions back and no change is reported afterwards', async ({
  page,
}) => {
  await openAuthor(page);
  await card(page).getByRole('button', { name: 'Fix in Rider' }).click();
  await expect(card(page).getByText(BUSY)).toBeVisible();

  await card(page).getByRole('button', { name: 'Stop waiting' }).click();

  await expect(card(page).getByText(BUSY)).toHaveCount(0);
  await expect(card(page).getByRole('button', { name: 'Fix with Claude' })).toBeVisible();
  await expect(card(page).getByRole('button', { name: 'Fix in Rider' })).toBeVisible();
  await expect(card(page).getByRole('button', { name: 'Reply' })).toBeVisible();
  // Past the mock's 2.2 s the file would have changed: the stopped watch says nothing.
  await page.waitForTimeout(3000);
  await expect(card(page).getByText(DETECTED)).toHaveCount(0);
  await expect(card(page).getByRole('button', { name: 'Fix in Rider' })).toBeVisible();
});

test('F-26.3 picking another thread ends the waiting; coming back shows the actions, not the change', async ({
  page,
}) => {
  await openAuthor(page);
  await card(page).getByRole('button', { name: 'Fix in Rider' }).click();
  await expect(card(page).getByText(BUSY)).toBeVisible();

  await threads(page)
    .getByRole('option', { name: /Piotr S\./ })
    .click();
  await expect(page.getByRole('button', { name: 'Open in Rider · line 36' })).toBeVisible();
  await page.waitForTimeout(3000);
  await expect(page.getByText(DETECTED)).toHaveCount(0);

  await threads(page)
    .getByRole('option', { name: /Marta K\./ })
    .click();
  await expect(card(page).getByRole('button', { name: 'Fix in Rider' })).toBeVisible();
  await expect(page.getByText(BUSY)).toHaveCount(0);
  await expect(page.getByText(DETECTED)).toHaveCount(0);
});
