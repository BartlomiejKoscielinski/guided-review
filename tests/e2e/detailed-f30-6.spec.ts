import { expect, test, type Locator, type Page } from '@playwright/test';
import { flushSaves, openStep, openStep1 } from './stepHelpers';
import {
  currentChange,
  fileToggle,
  scrollTop,
  scroller,
  settledTop,
  walkTallChange,
} from './walkHelpers';

// F-30.6 on S-04 against the mock backend (M4 plan, decisions 14 and 15): the arrow-key walk in
// Detailed mode. The sticky file bar stays on top while the diff scrolls, so a change brought to
// the top sits right under it. The first test is the live check of 2026-10-16: on an S-04 freshly
// mounted by Ctrl+D the outline moved but the main column stayed at scrollTop 0.

const QUEUE = 'src/Mobile.Core/Uploads/IUploadQueue.cs';
const PHOTO = 'src/Mobile.Core/Uploads/QueuedPhoto.cs';
const SQLITE = 'src/Mobile.Infrastructure/Uploads/SqliteUploadQueue.cs';
const VM = 'src/Mobile.App/ViewModels/DeliveryPhotoViewModel.cs';
const PHOTO_SERVICE = 'src/Mobile.App/Services/PhotoUploadService.cs';

const region = (page: Page, path: string) => page.getByRole('region', { name: path });
const bar = (page: Page, path: string) => region(page, path).locator(':scope > *').first();
const stepButton = (page: Page) => page.getByRole('button', { name: /^(Mark reviewed|Reviewed)/ });

async function boxOf(locator: Locator) {
  const box = await locator.boundingBox();
  if (!box) throw new Error('not rendered');
  return box;
}

/** S-04 on a step, opened from S-03 with Ctrl+D (a freshly mounted screen). */
async function openDetailedStep(page: Page, title: RegExp, position: number) {
  await openStep1(page);
  if (position !== 1) await openStep(page, title, position);
  await page.keyboard.press('Control+d');
  await expect(page.getByText(`Step ${String(position)} / 8`, { exact: true })).toBeVisible();
  await expect(page.getByRole('complementary', { name: 'Guide' })).toBeVisible();
}

/** The gap between the bottom of a file's sticky bar and the top of the current change. */
async function gapUnderBar(page: Page, path: string): Promise<number> {
  const barBox = await boxOf(bar(page, path));
  const current = await boxOf(currentChange(page));
  return current.y - (barBox.y + barBox.height);
}

test('F-30.6 ↓ on an S-04 freshly mounted by Ctrl+D scrolls each hunk under the sticky file bar', async ({
  page,
}) => {
  await openDetailedStep(page, /ViewModel/, 4);
  expect(await scrollTop(page)).toBe(0);

  await page.keyboard.press('ArrowDown');
  await expect(currentChange(page)).toContainText('lines 12–31 · DeliveryPhotoViewModel');
  // The failed live check: the outline moved and the column stayed at 0.
  expect(await settledTop(page)).toBeGreaterThan(0);
  const columnTop = (await boxOf(scroller(page))).y;
  expect(Math.abs((await boxOf(bar(page, VM))).y - columnTop)).toBeLessThanOrEqual(3);
  expect(Math.abs(await gapUnderBar(page, VM))).toBeLessThanOrEqual(6);

  const first = await scrollTop(page);
  await page.keyboard.press('ArrowDown');
  await expect(currentChange(page)).toContainText('lines 39–60 · SendPhotoAsync');
  expect(await settledTop(page)).toBeGreaterThan(first);
  expect(Math.abs(await gapUnderBar(page, VM))).toBeLessThanOrEqual(6);

  // SendPhotoAsync holds the focused note's open callout, which can make it taller than the
  // screen (1040 px against 838 at 1600x1000): ↓ then first scrolls a screen through it (decision
  // 15) before it reaches RetryAsync, so at most one page comes first.
  for (let presses = 0; presses < 2; presses += 1) {
    const before = await settledTop(page);
    await page.keyboard.press('ArrowDown');
    const after = await settledTop(page);
    if ((await currentChange(page).textContent())?.includes('RetryAsync')) break;
    await expect(currentChange(page)).toContainText('lines 39–60 · SendPhotoAsync');
    expect(after).toBeGreaterThan(before);
  }
  // The last hunk may sit too near the end of the column to reach the top; it is on screen.
  await expect(currentChange(page)).toContainText('lines 61–74 · RetryAsync');
  await expect(currentChange(page)).toBeInViewport();
});

test('F-30.6 a change taller than the screen scrolls a screen at a time before ↓ marks the file and pauses at the end card', async ({
  page,
}) => {
  await openDetailedStep(page, /SqliteUploadQueue/, 2);
  const walk = await walkTallChange(page, SQLITE, 86);
  expect(walk.marked).toBe(true);
  expect(walk.shownBeforeMarking).toBe(true);
  expect(walk.presses).toBeGreaterThanOrEqual(3);
  expect(walk.presses).toBeLessThanOrEqual(8);
  const scrolls = walk.tops.slice(0, -1);
  expect(scrolls[0]).toBeGreaterThan(0);
  for (let n = 1; n < scrolls.length; n++) {
    const step = (scrolls[n] ?? 0) - (scrolls[n - 1] ?? 0);
    expect(step).toBeGreaterThan(0);
    expect(step).toBeLessThanOrEqual(walk.height);
  }
  // The pause at the end of the step: the end-of-step card is shown, the step is still step 2.
  await expect(page.getByText('Step 2 / 8', { exact: true })).toBeVisible();
  await expect(page.getByText('End of step 2', { exact: true })).toBeInViewport();
  await expect(stepButton(page)).toHaveAttribute('aria-pressed', 'true');
});

test('F-30.6 ↓ past the last file marks it, pauses on the end card, and the next ↓ opens the next step at its first change', async ({
  page,
}) => {
  await openDetailedStep(page, /Offline banner/, 5);
  const converter = 'src/Mobile.App/Converters/PendingCountConverter.cs';
  const banner = 'src/Mobile.App/Views/OfflineBanner.xaml';
  for (let n = 0; n < 8; n++) {
    if ((await stepButton(page).getAttribute('aria-pressed')) === 'true') break;
    await page.keyboard.press('ArrowDown');
    await flushSaves(page);
  }
  await expect(stepButton(page)).toHaveAttribute('aria-pressed', 'true');
  await expect(fileToggle(page, converter)).toHaveAttribute('aria-pressed', 'true');
  await expect(fileToggle(page, banner)).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByText('Step 5 / 8', { exact: true })).toBeVisible();
  await expect(page.getByText('End of step 5', { exact: true })).toBeInViewport();

  await page.keyboard.press('ArrowDown');
  await expect(page.getByText('Step 6 / 8', { exact: true })).toBeVisible();
  await expect(region(page, PHOTO_SERVICE).locator('[aria-current="true"]')).toHaveCount(1);
  await expect(currentChange(page)).toBeInViewport();
});

test('F-30.6 ← and → bring a file’s sticky bar to the top of the screen without marking', async ({
  page,
}) => {
  await openDetailedStep(page, /Queue contract/, 1);
  await page.keyboard.press('ArrowRight');
  await expect(region(page, PHOTO).locator('[aria-current="true"]')).toHaveCount(1);
  await settledTop(page);

  await page.keyboard.press('ArrowLeft');
  await expect(region(page, QUEUE).locator('[aria-current="true"]')).toHaveCount(1);
  expect(await settledTop(page)).toBeGreaterThan(0);
  const columnTop = (await boxOf(scroller(page))).y;
  // The file's header is its sticky bar: it reaches the top and the first change sits under it.
  expect(Math.abs((await boxOf(bar(page, QUEUE))).y - columnTop)).toBeLessThanOrEqual(3);
  expect(Math.abs(await gapUnderBar(page, QUEUE))).toBeLessThanOrEqual(6);
  await expect(fileToggle(page, QUEUE)).toHaveAttribute('aria-pressed', 'false');
  await expect(fileToggle(page, PHOTO)).toHaveAttribute('aria-pressed', 'false');
});
