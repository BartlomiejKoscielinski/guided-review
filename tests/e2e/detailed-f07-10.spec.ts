import { expect, test, type Locator, type Page } from '@playwright/test';
import { openStep, openStep1, restartApp } from './stepHelpers';

// F-07.10 on S-04 against the mock backend: the sticky file bar of each file has the Reviewed
// toggle (pressed = green fill, "Mark <path> reviewed" for assistive technology) and stays in
// reach while the file scrolls; the marks are the same in Focus and Detailed and survive a restart;
// Space toggles the first file of the step; the footer hints and the header's Next step follow
// decision 15 (M4 plan row F-07.10).

const CONVERTER = 'src/Mobile.App/Converters/PendingCountConverter.cs';
const BANNER = 'src/Mobile.App/Views/OfflineBanner.xaml';
const VM = 'src/Mobile.App/ViewModels/DeliveryPhotoViewModel.cs';
// --green of src/styles/tokens.css as the browser reports it.
const GREEN = 'rgb(99, 214, 118)';

const region = (page: Page, path: string) => page.getByRole('region', { name: path, exact: true });
const toggle = (page: Page, path: string) =>
  region(page, path).getByRole('button', { name: `Mark ${path} reviewed`, exact: true });
const fill = (button: Locator) => button.evaluate((el) => getComputedStyle(el).backgroundColor);
const column = (page: Page) => page.locator('main main');
/** The step header's button: its name carries the Space hint after Mark reviewed / Reviewed. */
const stepButton = (page: Page, name: 'Mark reviewed' | 'Reviewed') =>
  column(page)
    .getByRole('button', { name: new RegExp(`^${name}`) })
    .first();

async function expectMarks(page: Page, converter: boolean, banner: boolean) {
  await expect(toggle(page, CONVERTER)).toHaveAttribute('aria-pressed', String(converter));
  await expect(toggle(page, BANNER)).toHaveAttribute('aria-pressed', String(banner));
}

/** Step 5 of !482 in Focus, then Ctrl+D: S-04 on the same step. */
async function openDetailed5(page: Page) {
  await openStep1(page);
  await openStep(page, /Offline banner/, 5);
  await page.keyboard.press('Control+d');
  await expect(page.getByRole('complementary', { name: 'Guide' })).toBeVisible();
  await expect(page.getByText('Step 5 / 8')).toBeVisible();
}

test('F-07.10 the sticky file bar has a green Reviewed toggle that stays in reach while the file scrolls', async ({
  page,
}) => {
  await openStep1(page);
  await openStep(page, /ViewModel/, 4);
  await page.keyboard.press('Control+d');
  await expect(page.getByRole('complementary', { name: 'Guide' })).toBeVisible();
  const yOf = async (locator: Locator) => (await locator.boundingBox())?.y ?? Number.NaN;
  const top = await yOf(column(page));
  const reviewed = toggle(page, VM);

  await expect(reviewed).toContainText('Reviewed');
  await expect(reviewed).toHaveAttribute('aria-pressed', 'false');
  expect(await fill(reviewed)).not.toBe(GREEN);
  // In the file bar, below the step header at first.
  expect(await yOf(reviewed)).toBeGreaterThan(top + 100);

  await column(page).hover();
  await page.mouse.wheel(0, 600);
  await expect.poll(() => yOf(page.getByRole('heading', { level: 1 }))).toBeLessThan(top);
  await expect(reviewed).toBeInViewport();
  expect(await yOf(reviewed)).toBeLessThan(top + 48);

  // The step has one file: its toggle marks the file and with it the step.
  await reviewed.click();
  await expect(reviewed).toHaveAttribute('aria-pressed', 'true');
  await expect.poll(() => fill(reviewed)).toBe(GREEN);
  await expect(stepButton(page, 'Reviewed')).toHaveAttribute('aria-pressed', 'true');
  await reviewed.click();
  await expect(reviewed).toHaveAttribute('aria-pressed', 'false');
  await expect(stepButton(page, 'Mark reviewed')).toHaveAttribute('aria-pressed', 'false');
});

test('F-07.10 marks are the same in Focus and Detailed, and Mark reviewed marks all files', async ({
  page,
}) => {
  await openStep1(page);
  await openStep(page, /Offline banner/, 5);
  await toggle(page, CONVERTER).click();
  await expectMarks(page, true, false);

  await page.keyboard.press('Control+d');
  await expect(page.getByText('Step 5 / 8')).toBeVisible();
  await expectMarks(page, true, false);
  await expect(stepButton(page, 'Mark reviewed')).toHaveAttribute('aria-pressed', 'false');
  await toggle(page, BANNER).click();
  await expectMarks(page, true, true);
  await expect(stepButton(page, 'Reviewed')).toHaveAttribute('aria-pressed', 'true');

  // The header's Reviewed on a reviewed step unmarks all its files; Mark reviewed marks them again.
  await stepButton(page, 'Reviewed').click();
  await expectMarks(page, false, false);
  await stepButton(page, 'Mark reviewed').click();
  await expectMarks(page, true, true);

  await page.keyboard.press('Control+d');
  await expect(page.getByText('Step 5 of 8')).toBeVisible();
  await expectMarks(page, true, true);
  await expect(page.getByRole('button', { name: 'Reviewed', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true',
  );

  await restartApp(page);
  await expect(page.getByText('Step 5 of 8')).toBeVisible();
  await expectMarks(page, true, true);
});

test('F-07.10 Space in Detailed toggles the first file of the step', async ({ page }) => {
  await openDetailed5(page);
  await page.getByRole('heading', { level: 1 }).click();
  await page.keyboard.press('Space');
  await expectMarks(page, true, false);
  await expect(stepButton(page, 'Mark reviewed')).toHaveAttribute('aria-pressed', 'false');
  await page.keyboard.press('Space');
  await expectMarks(page, false, false);
});

test('F-07.10 the footer hints follow the arrow keys and the header’s Next step has no ] hint', async ({
  page,
}) => {
  await openDetailed5(page);
  const bar = page.locator('footer');
  await expect(bar.locator('kbd')).toHaveText(['↑', '↓', '←', '→', 'Space', 'N', 'C', 'A', '?']);
  for (const hint of [
    '↑ ↓ change',
    '← → file',
    'Space file reviewed',
    'N note',
    'C comment',
    'A ask',
    '? all shortcuts',
  ]) {
    await expect(bar.getByText(hint, { exact: true })).toBeVisible();
  }
  // The header's Next step is named just that; the end-of-step card's keeps its ] until F-30.6.
  await expect(column(page).getByRole('button', { name: 'Next step', exact: true })).toHaveCount(1);
  await expect(column(page).getByRole('button', { name: /^Next step\s*\]$/ })).toHaveCount(1);
});
