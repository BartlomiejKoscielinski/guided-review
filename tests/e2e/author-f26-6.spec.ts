import { expect, test, type Page } from '@playwright/test';

// F-26.6: S-10 after Push and reply, against the mock backend's !480 (Author.dc.html `cDone`).
// The region "Commit and push" shows "Pushed", the sentence "Replied to Marta and resolved the
// thread." ("Replied to Marta. The thread stays open." with Resolve off) and a link: "Pipeline
// starting…" until the pipeline exists, then "Pipeline #18360 running"; it opens S-08. The thread
// moves in the list: "Resolved" (Resolve on) or "Replied" (off); the heading counts what is left.
//
// Locators the screen keeps: the region named "Commit and push"; inside it the own-text elements
// "Pushed" and the sentence, the links by name; the list is the listbox "Threads"; the heading
// level 1.

const DETECTED = 'Change detected from Rider. Commit it below.';

const threads = (page: Page) => page.getByRole('listbox', { name: 'Threads' });
const card = (page: Page) => page.getByRole('region', { name: 'Thread' });
const panel = (page: Page) => page.getByRole('region', { name: 'Commit and push' });

async function pushed(page: Page, resolve: boolean) {
  await page.goto('/');
  await expect(page.getByTestId('title-bar')).toBeVisible();
  const mrs = page.getByRole('region', { name: 'Merge requests' });
  await mrs.getByRole('tab', { name: /^Mine/ }).click();
  await mrs.getByText('Retry in UploadWorker after network loss').click();
  await card(page).getByRole('button', { name: 'Fix in Rider' }).click();
  await expect(card(page).getByText(DETECTED)).toBeVisible({ timeout: 8000 });
  await panel(page).getByRole('button', { name: 'Commit', exact: true }).click();
  await expect(panel(page).getByText('not pushed yet', { exact: true })).toBeVisible();
  if (!resolve) await panel(page).getByRole('checkbox', { name: 'Resolve the thread' }).uncheck();
  await panel(page).getByRole('button', { name: 'Push and reply' }).click();
  await expect(panel(page).getByText('Pushed', { exact: true })).toBeVisible({ timeout: 8000 });
}

test('F-26.6 after the push the panel says what was sent and links to the new pipeline', async ({
  page,
}) => {
  await pushed(page, true);

  await expect(
    panel(page).getByText('Replied to Marta and resolved the thread.', { exact: true }),
  ).toBeVisible();
  await expect(panel(page).getByRole('link', { name: 'Pipeline starting…' })).toBeVisible();
  const link = panel(page).getByRole('link', { name: 'Pipeline #18360 running' });
  await expect(link).toBeVisible({ timeout: 15_000 });
  await expect(panel(page).getByRole('link', { name: 'Pipeline starting…' })).toHaveCount(0);
  await link.click();
  await expect(
    page.getByRole('heading', { level: 1, name: 'Pipeline', exact: true }),
  ).toBeVisible();
});

test('F-26.6 the resolved thread reads Resolved and the heading counts what is left', async ({
  page,
}) => {
  await pushed(page, true);

  await expect(threads(page).getByRole('option', { name: /Marta K\./ })).toContainText('Resolved');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('1 thread to answer');
  await expect(page.getByText('1 resolved earlier · typo in a log message')).toBeVisible();
});

test('F-26.6 with Resolve off the thread stays open as Replied', async ({ page }) => {
  await pushed(page, false);

  await expect(
    panel(page).getByText('Replied to Marta. The thread stays open.', { exact: true }),
  ).toBeVisible();
  await expect(threads(page).getByRole('option', { name: /Marta K\./ })).toContainText('Replied');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('1 thread to answer');
});
