import { expect, type Page } from '@playwright/test';

// Shared steps of the S-03 specs against the mock backend.

/** S-01 › !482 › S-02 › Start step 1: S-03 on step 1 of 8 in layout A. */
export async function openStep1(page: Page) {
  await page.goto('/');
  await expect(page.getByTestId('title-bar')).toBeVisible();
  const source = page.getByLabel(/Paste a merge request link/);
  await source.fill('!482');
  await expect(page.getByText('Merge request !482', { exact: true })).toBeVisible();
  await source.press('Enter');
  await expect(page.getByRole('heading', { name: 'Plan · 8 steps' })).toBeVisible();
  await page.getByRole('button', { name: /Start step 1/ }).click();
  await expect(page.getByText('Step 1 of 8')).toBeVisible();
}

// Session state survives app restarts (F-04.3). The mock keeps it in the browser's storage, as the
// core keeps it in SQLite, so reloading the page is starting the app again.

/** The state is written on change; a scroll position is written debounced, within this time. */
export const STATE_SAVED_MS = 500;

/** Gives the last change time to be written, then starts the app again (a page reload). */
export async function restartApp(page: Page, savedMs = STATE_SAVED_MS) {
  await page.waitForTimeout(savedMs);
  await page.reload();
}

export const stepsList = (page: Page) => page.getByRole('navigation', { name: 'Steps' });

/** Opens a step from layout A's steps list by its short title. */
export async function openStep(page: Page, title: RegExp, position: number) {
  await stepsList(page).getByRole('button', { name: title }).click();
  await expect(page.getByText(`Step ${String(position)} of 8`)).toBeVisible();
}
