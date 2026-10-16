import { expect, test, type Page } from '@playwright/test';
import { flushSaves, openStep1, restartApp } from './stepHelpers';

// Settings › Shortcuts (S-07, Settings.dc.html `{"section":"shortcuts"}`) against the mock backend,
// F-19.7 and M4 decision 16: a row's keys are a button ("Change shortcut for <action>"); the next
// key or chord becomes the shortcut ("Press the new keys…", Esc cancels); a key in use shows
// "Already used by <action>." and nothing changes; a changed row shows Reset and Reset all shows
// once anything is changed; changes are saved at once (the mock keeps settings in localStorage as
// the core keeps them in SQLite, so a page reload is starting the app again) and apply on S-03 and
// in the S-04 footer.

const QUEUE = 'src/Mobile.Core/Uploads/IUploadQueue.cs';
const PHOTO = 'src/Mobile.Core/Uploads/QueuedPhoto.cs';
const PROMPT = 'Press the new keys…';

const tile = (page: Page, name: string) =>
  page
    .getByRole('navigation', { name: 'App' })
    .getByRole('button', { name: new RegExp(`^${name}`) });
const region = (page: Page, path: string) => page.getByRole('region', { name: path });
const changeButton = (page: Page, action: string) =>
  page.getByRole('button', { name: `Change shortcut for ${action}`, exact: true });
/** The row of an action: the innermost element that holds its keys button and its label. */
const rowOf = (page: Page, action: string) =>
  page
    .locator('*')
    .filter({ has: changeButton(page, action), hasText: action })
    .last();
const resetOf = (page: Page, action: string) =>
  rowOf(page, action).getByRole('button', { name: 'Reset', exact: true });
const resetButtons = (page: Page) => page.getByRole('button', { name: 'Reset', exact: true });
const resetAll = (page: Page) => page.getByRole('button', { name: 'Reset all', exact: true });
const prompt = (page: Page) => page.getByText(PROMPT, { exact: true });

/** Settings › Shortcuts from any screen. */
async function openShortcuts(page: Page) {
  await tile(page, 'Settings').click();
  await expect(page.getByRole('heading', { name: 'General', level: 1 })).toBeVisible();
  await page
    .getByRole('navigation', { name: 'Settings sections' })
    .getByRole('button', { name: 'Shortcuts', exact: true })
    .click();
  await expect(page.getByRole('heading', { name: 'Shortcuts', level: 1 })).toBeVisible();
}

/** Clicks an action's keys and presses `key`: the new shortcut. */
async function changeTo(page: Page, action: string, key: string) {
  await changeButton(page, action).click();
  await expect(prompt(page)).toBeVisible();
  await page.keyboard.press(key);
  await expect(prompt(page)).toHaveCount(0);
}

/** `ui.shortcuts` as the mock has saved it (`null` while nothing was ever saved). */
async function savedShortcuts(page: Page): Promise<unknown> {
  return page.evaluate(() => {
    const saved = localStorage.getItem('guided-review.mock.settings');
    if (!saved) return null;
    const settings = JSON.parse(saved) as { ui?: { shortcuts?: unknown } };
    return settings.ui?.shortcuts ?? {};
  });
}

test('F-19.7 a key changed in Settings › Shortcuts works on S-03 at once, the old key does nothing, and it survives a restart', async ({
  page,
}) => {
  await openStep1(page);
  await openShortcuts(page);
  await expect(changeButton(page, 'Next file').locator('kbd')).toHaveText(['→']);
  await expect(resetButtons(page)).toHaveCount(0);
  await expect(resetAll(page)).toHaveCount(0);

  await changeButton(page, 'Next file').click();
  await expect(prompt(page)).toBeVisible();
  await page.keyboard.press('l');
  await expect(prompt(page)).toHaveCount(0);
  await expect(changeButton(page, 'Next file').locator('kbd')).toHaveText(['L']);
  await expect(resetOf(page, 'Next file')).toBeVisible();
  await expect(resetAll(page)).toBeVisible();
  await expect.poll(() => savedShortcuts(page)).toEqual({ nextFile: ['L'] });

  // The old key does nothing on S-03; the new one moves to the next file.
  await tile(page, 'Review').click();
  await expect(page.getByText('Step 1 of 8')).toBeVisible();
  await page.keyboard.press('ArrowRight');
  await expect(page.locator('[aria-current="true"]')).toHaveCount(0);
  await page.keyboard.press('l');
  await expect(region(page, PHOTO).locator('[aria-current="true"]')).toHaveCount(1);
  await page.keyboard.press('ArrowLeft');
  await expect(region(page, QUEUE).locator('[aria-current="true"]')).toHaveCount(1);

  // Starting the app again: still changed in Settings and on S-03.
  await restartApp(page);
  await expect(page.getByText('Step 1 of 8')).toBeVisible();
  await page.keyboard.press('ArrowRight');
  await expect(page.locator('[aria-current="true"]')).toHaveCount(0);
  await page.keyboard.press('l');
  await expect(region(page, PHOTO).locator('[aria-current="true"]')).toHaveCount(1);
  await openShortcuts(page);
  await expect(changeButton(page, 'Next file').locator('kbd')).toHaveText(['L']);
  await expect(resetOf(page, 'Next file')).toBeVisible();
  await flushSaves(page);
});

test('F-19.7 a key in use is refused with "Already used by <action>.", Ctrl+C is refused, Esc cancels, and nothing is saved', async ({
  page,
}) => {
  await page.goto('/');
  await expect(page.getByTestId('title-bar')).toBeVisible();
  await openShortcuts(page);

  await changeButton(page, 'Next note').click();
  await expect(prompt(page)).toBeVisible();
  await page.keyboard.press('d');
  await expect(page.getByText('Already used by Add to drafts.', { exact: true })).toBeVisible();
  await expect(prompt(page)).toBeVisible();
  await expect(changeButton(page, 'Next note').locator('kbd')).toHaveText(['N']);
  await expect(changeButton(page, 'Add to drafts').locator('kbd')).toHaveText(['D']);

  // A chord in use is refused without running the shortcut it belongs to.
  await page.keyboard.press('Control+k');
  await expect(page.getByText('Already used by Open anything.', { exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Shortcuts', level: 1 })).toBeVisible();
  await page.keyboard.press('Control+c');
  await expect(
    page.getByText("Ctrl+C is a text-editing shortcut and can't be assigned.", { exact: true }),
  ).toBeVisible();
  await expect(resetButtons(page)).toHaveCount(0);
  await expect(resetAll(page)).toHaveCount(0);

  await page.keyboard.press('Escape');
  await expect(prompt(page)).toHaveCount(0);
  await expect(page.getByText(/Already used by|can't be assigned/)).toHaveCount(0);
  await expect(changeButton(page, 'Next note').locator('kbd')).toHaveText(['N']);
  expect(await savedShortcuts(page)).toBeNull();

  // Esc itself can't be changed: the Close popover row has no keys button.
  await expect(page.getByRole('button', { name: /Close popover/ })).toHaveCount(0);
  await expect(page.getByRole('button', { name: /^Change shortcut for / })).toHaveCount(21);
});

test('F-19.7 Reset restores one row, Reset all every row, and the saved changes shrink with them', async ({
  page,
}) => {
  await page.goto('/');
  await expect(page.getByTestId('title-bar')).toBeVisible();
  await openShortcuts(page);

  await changeTo(page, 'Next note', 'm');
  await changeTo(page, 'Ask Claude', 'q');
  await expect(changeButton(page, 'Next note').locator('kbd')).toHaveText(['M']);
  await expect(changeButton(page, 'Ask Claude').locator('kbd')).toHaveText(['Q']);
  await expect(resetButtons(page)).toHaveCount(2);
  await expect(resetAll(page)).toBeVisible();
  await expect.poll(() => savedShortcuts(page)).toEqual({ nextNote: ['M'], ask: ['Q'] });

  await resetOf(page, 'Ask Claude').click();
  await expect(changeButton(page, 'Ask Claude').locator('kbd')).toHaveText(['A']);
  await expect(resetButtons(page)).toHaveCount(1);
  await expect(resetAll(page)).toBeVisible();
  await expect.poll(() => savedShortcuts(page)).toEqual({ nextNote: ['M'] });

  await resetAll(page).click();
  await expect(changeButton(page, 'Next note').locator('kbd')).toHaveText(['N']);
  await expect(resetButtons(page)).toHaveCount(0);
  await expect(resetAll(page)).toHaveCount(0);
  await expect.poll(() => savedShortcuts(page)).toEqual({});
});

test('F-19.7 the S-04 footer shows the changed key and the old one is gone', async ({ page }) => {
  await openStep1(page);
  await openShortcuts(page);
  await changeTo(page, 'Next note', 'm');
  await tile(page, 'Review').click();
  await expect(page.getByText('Step 1 of 8')).toBeVisible();
  await page.keyboard.press('Control+d');
  await expect(page.getByRole('complementary', { name: 'Guide' })).toBeVisible();

  const footer = page.locator('footer');
  await expect(footer).toContainText('M note');
  await expect(footer).not.toContainText('N note');
  await expect(footer.locator('kbd')).toHaveText(['↑', '↓', '←', '→', 'Space', 'M', 'C', 'A', '?']);
  await flushSaves(page);
});
