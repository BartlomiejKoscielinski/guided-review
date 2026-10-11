import { expect, test, type Page } from '@playwright/test';

// The shell against the mock backend (ADR-016): title bar, dock, stub screens, Ctrl+, and
// last-screen restore. The mock keeps settings in localStorage, like the core keeps them in SQLite.

const dock = (page: Page) => page.getByRole('navigation', { name: 'App' });
const tile = (page: Page, name: string) =>
  dock(page).getByRole('button', { name: new RegExp(`^${name}`) });

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await expect(page.getByTestId('title-bar')).toBeVisible();
});

test('F-30.1 title bar is 44px with 46px caption buttons', async ({ page }) => {
  const bar = await page.getByTestId('title-bar').boundingBox();
  expect(bar?.height).toBe(44);
  for (const name of ['Minimize', 'Maximize', 'Close']) {
    const box = await page.getByRole('button', { name, exact: true }).boundingBox();
    expect(box?.width, name).toBe(46);
    expect(box?.height, name).toBe(44);
  }
  const close = await page.getByRole('button', { name: 'Close' }).boundingBox();
  expect((close?.x ?? 0) + (close?.width ?? 0)).toBe(page.viewportSize()?.width);
});

test('F-30.2 dock switches between stub screens', async ({ page }) => {
  const box = await dock(page).boundingBox();
  expect(box?.width).toBe(72);
  await expect(tile(page, 'MRs')).toHaveAttribute('aria-current', 'page');
  await tile(page, 'Changes').click();
  await expect(tile(page, 'Changes')).toHaveAttribute('aria-current', 'page');
  await expect(page.getByRole('main', { name: 'Changes' })).toBeVisible();
  await tile(page, 'Settings').click();
  await expect(tile(page, 'Settings')).toHaveAttribute('aria-current', 'page');
  await expect(page.getByTestId('title-bar').getByText('Settings', { exact: true })).toBeVisible();
  await tile(page, 'MRs').click();
  await expect(page.getByRole('main', { name: 'Start' })).toBeVisible();
});

test('F-30.2 Review tile is dimmed with a tooltip without a session', async ({ page }) => {
  const review = tile(page, 'Review');
  await expect(review).toHaveAttribute('aria-disabled', 'true');
  await expect(review).toHaveAttribute('title', 'No review open. Pick one in MRs.');
  // Playwright treats aria-disabled as not clickable; force the click to prove it does nothing.
  await review.click({ force: true });
  await expect(page.getByRole('main', { name: 'Start' })).toBeVisible();
});

test('F-30.2 Settings tile is purple and gets a white outline when active', async ({ page }) => {
  const settings = tile(page, 'Settings');
  await expect(settings).toHaveCSS('background-color', 'rgb(185, 60, 246)');
  await expect(settings).toHaveCSS('outline-style', 'none');
  await settings.click();
  await page.mouse.move(800, 500);
  await expect(settings).toHaveCSS('background-color', 'rgb(185, 60, 246)');
  await expect(settings).toHaveCSS('outline-color', 'rgb(244, 244, 242)');
  await expect(settings).toHaveCSS('outline-width', '2px');
});

test('F-19.4 Ctrl+, opens Settings', async ({ page }) => {
  await tile(page, 'Changes').click();
  await page.keyboard.press('Control+Comma');
  await expect(tile(page, 'Settings')).toHaveAttribute('aria-current', 'page');
  await expect(page.getByRole('main', { name: 'Settings' })).toBeVisible();
});

test('F-30.4 last screen is restored after reload', async ({ page }) => {
  await tile(page, 'Changes').click();
  await expect(tile(page, 'Changes')).toHaveAttribute('aria-current', 'page');
  await page.waitForFunction(() =>
    (localStorage.getItem('guided-review.mock.settings') ?? '').includes('"S-06"'),
  );
  await page.reload();
  await expect(tile(page, 'Changes')).toHaveAttribute('aria-current', 'page');
  await expect(page.getByRole('main', { name: 'Changes' })).toBeVisible();
});

test('fonts are bundled and cover Polish characters', async ({ page }) => {
  const loaded = await page.evaluate(async () => {
    const text = 'Paweł Zażółć';
    const results: boolean[] = [];
    for (const family of ['Barlow', 'Barlow Condensed', 'JetBrains Mono']) {
      const faces = await document.fonts.load(`600 16px "${family}"`, text);
      results.push(faces.length > 0 && document.fonts.check(`600 16px "${family}"`, text));
    }
    return results;
  });
  expect(loaded).toEqual([true, true, true]);
});
