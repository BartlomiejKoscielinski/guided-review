import { expect, test, type Page } from '@playwright/test';

// Settings › Shortcuts (S-07, Settings.dc.html `{"section":"shortcuts"}`) against the mock
// backend, F-19.3: every shortcut of F-30.6, grouped Review, Code, App (M4 decision 3).

const tile = (page: Page, name: string) =>
  page
    .getByRole('navigation', { name: 'App' })
    .getByRole('button', { name: new RegExp(`^${name}`) });
const group = (page: Page, name: string) => page.getByRole('region', { name, exact: true });

test('F-19.3 Settings › Shortcuts lists every shortcut grouped Review, Code, App', async ({
  page,
}) => {
  await page.goto('/');
  await expect(page.getByTestId('title-bar')).toBeVisible();
  await tile(page, 'Settings').click();
  await expect(page.getByRole('heading', { name: 'General', level: 1 })).toBeVisible();

  const nav = page.getByRole('navigation', { name: 'Settings sections' });
  await nav.getByRole('button', { name: 'Shortcuts', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Shortcuts', level: 1 })).toBeVisible();
  await expect(nav.getByRole('button', { name: 'Shortcuts', exact: true })).toHaveAttribute(
    'aria-current',
    'page',
  );

  const review = group(page, 'Review');
  await expect(review.getByRole('heading', { name: 'Review', level: 2 })).toBeVisible();
  await expect(review.getByText('Next change', { exact: true })).toBeVisible();
  await expect(review.getByText('Primary action (plan, re-review)', { exact: true })).toBeVisible();
  await expect(review.locator('kbd')).toHaveText([
    '↓',
    '↑',
    '→',
    '←',
    'Space',
    'N',
    'D',
    'X',
    'C',
    'A',
    'Enter',
  ]);

  const code = group(page, 'Code');
  await expect(code.getByRole('heading', { name: 'Code', level: 2 })).toBeVisible();
  await expect(code.getByText('Open in Rider', { exact: true })).toBeVisible();
  await expect(code.locator('kbd')).toHaveText(['F12', 'Shift', 'F12', 'Ctrl', 'Shift', 'O']);

  const app = group(page, 'App');
  await expect(app.getByRole('heading', { name: 'App', level: 2 })).toBeVisible();
  await expect(app.getByText('All shortcuts', { exact: true })).toBeVisible();
  await expect(app.locator('kbd')).toHaveText([
    'Ctrl',
    'K',
    'Ctrl',
    ',',
    'Ctrl',
    'D',
    'Ctrl',
    '1',
    'Ctrl',
    '2',
    'Ctrl',
    '3',
    'Esc',
    '?',
  ]);

  // The groups stack in the order Review, Code, App.
  const top = async (name: string) => (await group(page, name).boundingBox())?.y ?? -1;
  const [reviewTop, codeTop, appTop] = [await top('Review'), await top('Code'), await top('App')];
  expect(reviewTop).toBeGreaterThanOrEqual(0);
  expect(codeTop).toBeGreaterThan(reviewTop);
  expect(appTop).toBeGreaterThan(codeTop);
});
