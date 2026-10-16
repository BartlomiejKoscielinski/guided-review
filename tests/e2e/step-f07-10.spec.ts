import { expect, test, type Locator, type Page } from '@playwright/test';
import { openStep, openStep1, restartApp, stepsList } from './stepHelpers';

// F-07.10 on S-03 against the mock backend: the file header of each file of a step has a Reviewed
// toggle (pressed = green fill, "Mark <path> reviewed" for assistive technology). Pressing it marks
// that file only, a step is reviewed when all its files are, Mark reviewed marks all its files and
// on a reviewed step unmarks them, Space toggles the current file (the first file of the step
// before any move, else the file of the hunk J made current), and the marks survive a restart.
// Step 5 has two files (PendingCountConverter.cs, then OfflineBanner.xaml).

const CONVERTER = 'src/Mobile.App/Converters/PendingCountConverter.cs';
const BANNER = 'src/Mobile.App/Views/OfflineBanner.xaml';
// --green of src/styles/tokens.css as the browser reports it.
const GREEN = 'rgb(99, 214, 118)';

const region = (page: Page, path: string) => page.getByRole('region', { name: path, exact: true });
/** The Reviewed toggle in the header of a file of the step. */
const toggle = (page: Page, path: string) =>
  region(page, path).getByRole('button', { name: `Mark ${path} reviewed`, exact: true });
const markReviewed = (page: Page) =>
  page.getByRole('button', { name: 'Mark reviewed', exact: true });
const reviewed = (page: Page) => page.getByRole('button', { name: 'Reviewed', exact: true });
const fill = (button: Locator) => button.evaluate((el) => getComputedStyle(el).backgroundColor);

/** S-01 › !482 › S-02 › Start step 1, then step 5 from the steps list. */
async function openStep5(page: Page) {
  await openStep1(page);
  await openStep(page, /Offline banner/, 5);
}

/** Moves the focus off the control just clicked, so Space reaches the review keys. */
const focusBody = (page: Page) => page.getByRole('heading', { level: 1 }).click();

async function expectMarks(page: Page, converter: boolean, banner: boolean) {
  await expect(toggle(page, CONVERTER)).toHaveAttribute('aria-pressed', String(converter));
  await expect(toggle(page, BANNER)).toHaveAttribute('aria-pressed', String(banner));
}

test('F-07.10 each file header has a Reviewed toggle; pressing it fills it green and marks that file only', async ({
  page,
}) => {
  await openStep5(page);
  for (const path of [CONVERTER, BANNER]) {
    await expect(toggle(page, path)).toContainText('Reviewed');
    // In the file's header, above its diff.
    const head = await region(page, path).boundingBox();
    const box = await toggle(page, path).boundingBox();
    expect((box?.y ?? Number.NaN) - (head?.y ?? Number.NaN)).toBeLessThan(80);
  }
  await expectMarks(page, false, false);
  expect(await fill(toggle(page, CONVERTER))).not.toBe(GREEN);
  await expect(stepsList(page)).toContainText('0/8');

  await toggle(page, CONVERTER).click();
  await expectMarks(page, true, false);
  // Green, also under the pointer that just clicked it.
  await expect.poll(() => fill(toggle(page, CONVERTER))).toBe(GREEN);
  expect(await fill(toggle(page, BANNER))).not.toBe(GREEN);
  // One file of two: the step is not reviewed yet.
  await expect(markReviewed(page)).toHaveAttribute('aria-pressed', 'false');
  await expect(stepsList(page)).toContainText('0/8');

  await toggle(page, BANNER).click();
  await expectMarks(page, true, true);
  await expect(reviewed(page)).toHaveAttribute('aria-pressed', 'true');
  await expect(stepsList(page)).toContainText('1/8');

  // One file taken back: the step is not reviewed any more, the other file stays green.
  await toggle(page, CONVERTER).click();
  await expectMarks(page, false, true);
  await expect(markReviewed(page)).toHaveAttribute('aria-pressed', 'false');
  await expect(stepsList(page)).toContainText('0/8');
  await expect.poll(() => fill(toggle(page, BANNER))).toBe(GREEN);
});

test('F-07.10 Mark reviewed marks every file of the step; on a reviewed step it unmarks them', async ({
  page,
}) => {
  await openStep5(page);
  await toggle(page, BANNER).click();
  await markReviewed(page).click();
  await expect(reviewed(page)).toHaveAttribute('aria-pressed', 'true');
  await expectMarks(page, true, true);
  await expect.poll(() => fill(toggle(page, CONVERTER))).toBe(GREEN);
  await expect(stepsList(page)).toContainText('1/8');

  await reviewed(page).click();
  await expect(markReviewed(page)).toHaveAttribute('aria-pressed', 'false');
  await expectMarks(page, false, false);
  await expect(stepsList(page)).toContainText('0/8');
});

test('F-07.10 Space toggles the first file before any move, and after J the file of the current change', async ({
  page,
}) => {
  await openStep5(page);
  await focusBody(page);
  await page.keyboard.press('Space');
  await expectMarks(page, true, false);
  // The step has two files: marking the first does not mark the step.
  await expect(markReviewed(page)).toBeVisible();

  // J, J: the hunk in the second file is current; Space marks that file, and does not move.
  await page.keyboard.press('j');
  await page.keyboard.press('j');
  await expect(region(page, BANNER).locator('[aria-current="true"]')).toHaveCount(1);
  await page.keyboard.press('Space');
  await expectMarks(page, true, true);
  await expect(reviewed(page)).toHaveAttribute('aria-pressed', 'true');
  await expect(region(page, BANNER).locator('[aria-current="true"]')).toHaveCount(1);

  await page.keyboard.press('Space');
  await expectMarks(page, true, false);
  await expect(markReviewed(page)).toBeVisible();
});

test('F-07.10 the marks survive a restart, per step and file', async ({ page }) => {
  await openStep5(page);
  await toggle(page, CONVERTER).click();
  await expectMarks(page, true, false);

  await restartApp(page);
  await expect(page.getByText('Step 5 of 8')).toBeVisible();
  await expectMarks(page, true, false);
  await expect(markReviewed(page)).toHaveAttribute('aria-pressed', 'false');
  await expect.poll(() => fill(toggle(page, CONVERTER))).toBe(GREEN);

  await toggle(page, BANNER).click();
  await expect(reviewed(page)).toHaveAttribute('aria-pressed', 'true');
  await restartApp(page);
  await expect(page.getByText('Step 5 of 8')).toBeVisible();
  await expectMarks(page, true, true);
  await expect(reviewed(page)).toHaveAttribute('aria-pressed', 'true');
  await expect(stepsList(page)).toContainText('1/8');
  // Another step has no marks.
  await openStep(page, /ViewModel/, 4);
  await expect(page.getByRole('button', { name: /^Mark .* reviewed$/ })).toHaveAttribute(
    'aria-pressed',
    'false',
  );
});

test('F-07.10 layouts B and C show the same marks and the step’s button follows the files', async ({
  page,
}) => {
  await openStep5(page);
  await markReviewed(page).click();
  await expectMarks(page, true, true);

  // B: the toolbar's Reviewed is pressed; one file taken back and it is Mark reviewed again.
  await page.keyboard.press('Control+2');
  const bar = page.getByRole('toolbar', { name: 'Step navigation' });
  await expect(bar.getByRole('button', { name: 'Reviewed', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await expectMarks(page, true, true);
  await toggle(page, CONVERTER).click();
  await expect(bar.getByRole('button', { name: 'Mark reviewed', exact: true })).toHaveAttribute(
    'aria-pressed',
    'false',
  );
  await expectMarks(page, false, true);

  // C: the guide panel's button says the same, and the file headers keep the marks.
  await page.keyboard.press('Control+3');
  const guide = page.getByRole('complementary', { name: 'Guide' });
  await expect(guide.getByRole('button', { name: 'Mark reviewed', exact: true })).toBeVisible();
  await expectMarks(page, false, true);
  await toggle(page, CONVERTER).click();
  await expect(guide.getByRole('button', { name: 'Reviewed', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
});
