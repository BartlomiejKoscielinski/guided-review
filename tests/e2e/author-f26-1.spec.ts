import { expect, test, type Page } from '@playwright/test';

// F-26.1: S-10 Your MR, title bar and left panel, against the mock backend's !480 (Author.dc.html):
// "You’re the author", the pipeline status, "Feedback on your MR", "2 threads to answer", the
// branch, two threads with their tags, "1 resolved earlier · typo in a log message" and the
// safety note.
//
// Locators the screen keeps: title bar data-testid "title-bar" with the link "Pipeline passed";
// <aside aria-label="Threads on your MR">; <h1> "2 threads to answer"; a listbox named "Threads"
// with role=option rows whose text holds the author, "UploadWorker.cs:46" and the status word.

const bar = (page: Page) => page.getByTestId('title-bar');
const panel = (page: Page) => page.getByRole('complementary', { name: 'Threads on your MR' });
const threads = (page: Page) => page.getByRole('listbox', { name: 'Threads' });

async function openAuthor(page: Page) {
  await page.goto('/');
  await expect(bar(page)).toBeVisible();
  const mrs = page.getByRole('region', { name: 'Merge requests' });
  await mrs.getByRole('tab', { name: /^Mine/ }).click();
  await mrs.getByText('Retry in UploadWorker after network loss').click();
  await expect(bar(page).getByText('You’re the author')).toBeVisible();
}

test('F-26.1 the title bar names the author and the pipeline status', async ({ page }) => {
  await openAuthor(page);

  await expect(bar(page).getByText('!480')).toBeVisible();
  await expect(bar(page).getByRole('link', { name: 'Pipeline passed' })).toHaveAttribute(
    'href',
    '/mr/480/pipeline',
  );
});

test('F-26.1 thread list: heading, branch, two threads with tags, resolved summary and note', async ({
  page,
}) => {
  await openAuthor(page);

  const aside = panel(page);
  await expect(aside.getByText('Feedback on your MR')).toBeVisible();
  await expect(aside.getByRole('heading', { level: 1, name: '2 threads to answer' })).toBeVisible();
  await expect(aside.getByText('feature/upload-retry → develop')).toBeVisible();

  const marta = threads(page).getByRole('option', { name: /Marta K\./ });
  await expect(marta).toContainText('UploadWorker.cs:46');
  await expect(marta).toContainText('The delay grows linearly.');
  await expect(marta.getByText('Change requested')).toBeVisible();
  const piotr = threads(page).getByRole('option', { name: /Piotr S\./ });
  await expect(piotr).toContainText('UploadWorker.cs:36');
  await expect(piotr.getByText('Question')).toBeVisible();

  await expect(aside.getByText('1 resolved earlier · typo in a log message')).toBeVisible();
  await expect(aside.getByText('Fixes stay on your branch')).toBeVisible();
});

test('F-26.1 arrow keys move the selection through the thread list', async ({ page }) => {
  await openAuthor(page);
  const marta = threads(page).getByRole('option', { name: /Marta K\./ });
  const piotr = threads(page).getByRole('option', { name: /Piotr S\./ });
  await expect(marta).toHaveAttribute('aria-selected', 'true');

  await marta.focus();
  await page.keyboard.press('ArrowDown');

  await expect(piotr).toHaveAttribute('aria-selected', 'true');
  await expect(piotr).toBeFocused();
  await expect(marta).toHaveAttribute('aria-selected', 'false');
  await piotr.click();
  await expect(piotr).toHaveAttribute('aria-selected', 'true');
});
