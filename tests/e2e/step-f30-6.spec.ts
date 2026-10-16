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

// F-30.6 against the mock backend (M4 plan, decisions 14 and 15; the roadmap demo): a review of
// !482 with the keyboard only. ↓/↑ walk the changes (the current change has the focus outline, the
// one element marked aria-current="true"; a tall change scrolls a screen at a time first; past a
// file's last change ↓ marks the file and goes on; one pause at the end of the step), →/← the
// files, Space marks the current file, N the next note, D and X on the note, C the line composer
// and Esc to close it, Ctrl+D to Detailed and back, A ask, ? the list of shortcuts.

const QUEUE = 'src/Mobile.Core/Uploads/IUploadQueue.cs';
const PHOTO = 'src/Mobile.Core/Uploads/QueuedPhoto.cs';
const SQLITE = 'src/Mobile.Infrastructure/Uploads/SqliteUploadQueue.cs';
const VM = 'src/Mobile.App/ViewModels/DeliveryPhotoViewModel.cs';
const ADDED = 'Added to drafts. It reaches GitLab only when you publish.';
const DISMISSED = "Dismissed. Claude won't raise it again for this commit.";

const noteMark = (page: Page, n: number, title: string) =>
  page.getByRole('button', { name: `Note ${String(n)}: ${title}`, exact: true });
const card = (page: Page, title: string) =>
  page.getByRole('article', { name: `Claude note: ${title}` });
const region = (page: Page, path: string) => page.getByRole('region', { name: path });
const stepButton = (page: Page) => page.getByRole('button', { name: /^(Mark reviewed|Reviewed)$/ });

async function topOf(locator: Locator): Promise<number> {
  const box = await locator.boundingBox();
  if (!box) throw new Error('not rendered');
  return box.y;
}

test('F-30.6 a whole review with the keyboard only', async ({ page }) => {
  await openStep1(page);

  // → and ← move between the two files of step 1 and mark none.
  await page.keyboard.press('ArrowRight');
  await expect(region(page, PHOTO).locator('[aria-current="true"]')).toHaveCount(1);
  await page.keyboard.press('ArrowLeft');
  await expect(region(page, QUEUE).locator('[aria-current="true"]')).toHaveCount(1);
  await expect(fileToggle(page, QUEUE)).toHaveAttribute('aria-pressed', 'false');
  await expect(fileToggle(page, PHOTO)).toHaveAttribute('aria-pressed', 'false');

  // Space marks the current file reviewed (F-07.10) and does not move; the step is not reviewed.
  await page.keyboard.press('Space');
  await expect(fileToggle(page, QUEUE)).toHaveAttribute('aria-pressed', 'true');
  await expect(stepButton(page)).toHaveAttribute('aria-pressed', 'false');
  await expect(region(page, QUEUE).locator('[aria-current="true"]')).toHaveCount(1);

  // ↓ walks the rest of the step: past each file's last change it marks the file (the mark Space
  // made stays), and at the end of the step it pauses with the step shown as reviewed.
  for (let n = 0; n < 12; n++) {
    if ((await stepButton(page).getAttribute('aria-pressed')) === 'true') break;
    await page.keyboard.press('ArrowDown');
    await flushSaves(page);
  }
  await expect(stepButton(page)).toHaveAttribute('aria-pressed', 'true');
  await expect(fileToggle(page, QUEUE)).toHaveAttribute('aria-pressed', 'true');
  await expect(fileToggle(page, PHOTO)).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByText('Step 1 of 8')).toBeVisible();

  // The next ↓ opens step 2; ↑ pauses once at its start, then goes back and never unmarks.
  await page.keyboard.press('ArrowDown');
  await expect(page.getByText('Step 2 of 8')).toBeVisible();
  await expect(currentChange(page)).toHaveCount(1);
  await page.keyboard.press('ArrowUp');
  await flushSaves(page);
  await expect(page.getByText('Step 2 of 8')).toBeVisible();
  await page.keyboard.press('ArrowUp');
  await expect(page.getByText('Step 1 of 8')).toBeVisible();
  await expect(stepButton(page)).toHaveAttribute('aria-pressed', 'true');

  // Step 4: ↓ makes a change current, scrolled into view with its focus outline; ↑ goes back.
  await openStep(page, /ViewModel/, 4);
  await page.keyboard.press('ArrowDown');
  await expect(currentChange(page)).toHaveCount(1);
  await expect(currentChange(page)).toBeInViewport();
  await expect(region(page, VM).locator('[aria-current="true"]')).toHaveCount(1);
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('ArrowUp');
  await expect(currentChange(page)).toHaveCount(1);

  // N moves from the first Should fix (note 2) to note 3; D adds it to drafts.
  await expect(noteMark(page, 2, 'PendingCount won’t refresh after upload')).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await page.keyboard.press('n');
  await expect(noteMark(page, 3, 'Status texts are hardcoded')).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await page.keyboard.press('d');
  await expect(card(page, 'Status texts are hardcoded').getByText(ADDED)).toBeVisible();

  // N to note 4; X dismisses it.
  const cancel = 'catch (Exception) also catches camera cancellation';
  await page.keyboard.press('n');
  await expect(noteMark(page, 4, cancel)).toHaveAttribute('aria-pressed', 'true');
  await page.keyboard.press('x');
  await expect(card(page, cancel).getByText(DISMISSED)).toBeVisible();

  // C opens the composer with its field focused; letters type there; Esc closes it.
  await page.keyboard.press('c');
  const comment = page.getByRole('textbox', { name: 'Comment' });
  await expect(comment).toBeFocused();
  await page.keyboard.type('Why do we need this?');
  await expect(comment).toHaveValue('Why do we need this?');
  await page.keyboard.press('Escape');
  await expect(comment).toBeHidden();

  // Ctrl+D to Detailed: ↓ outlines a hunk header; Ctrl+D back.
  await page.keyboard.press('Control+d');
  await expect(page.getByText('Step 4 / 8', { exact: true })).toBeVisible();
  await page.keyboard.press('ArrowDown');
  await expect(currentChange(page)).toHaveCount(1);
  await expect(currentChange(page)).toContainText(/lines \d+–\d+ · /);
  await page.keyboard.press('Control+d');
  await expect(page.getByText('Step 4 of 8')).toBeVisible();
});

test('F-30.6 a change taller than the screen scrolls a screen at a time before ↓ marks the file', async ({
  page,
}) => {
  await openStep1(page);
  await openStep(page, /SqliteUploadQueue/, 2);
  expect(await scrollTop(page)).toBe(0);

  // Step 2 is one added file of 86 lines, a single change far taller than the screen.
  const walk = await walkTallChange(page, SQLITE, 86);
  expect(walk.marked).toBe(true);
  // ↓ shows every line before it marks: the last line was on screen before the marking press.
  expect(walk.shownBeforeMarking).toBe(true);
  // Make current, at least one screen of scrolling, mark.
  expect(walk.presses).toBeGreaterThanOrEqual(3);
  expect(walk.presses).toBeLessThanOrEqual(8);
  const scrolls = walk.tops.slice(0, -1);
  // The first press brings the change to the top of the screen, below the step's header.
  expect(scrolls[0]).toBeGreaterThan(0);
  for (let n = 1; n < scrolls.length; n++) {
    const step = (scrolls[n] ?? 0) - (scrolls[n - 1] ?? 0);
    expect(step).toBeGreaterThan(0);
    expect(step).toBeLessThanOrEqual(walk.height);
  }
  // The pause at the end of the step: it stays, shown as reviewed.
  await expect(page.getByText('Step 2 of 8')).toBeVisible();
  await expect(stepButton(page)).toHaveAttribute('aria-pressed', 'true');
});

test('F-30.6 → and ← scroll the file’s header to the top of the screen', async ({ page }) => {
  await openStep1(page);
  const header = (path: string) => region(page, path).locator(':scope > *').first();
  const columnTop = () => topOf(scroller(page));

  await page.keyboard.press('ArrowRight');
  await expect(region(page, PHOTO).locator('[aria-current="true"]')).toHaveCount(1);
  const top = await settledTop(page);
  const max = await scroller(page).evaluate((el) => el.scrollHeight - el.clientHeight);
  // The last file's header reaches the top unless the end of the column stops the scroll.
  const gap = (await topOf(header(PHOTO))) - (await columnTop());
  expect(gap <= 3 || top >= max - 1).toBe(true);

  await page.keyboard.press('ArrowLeft');
  await expect(region(page, QUEUE).locator('[aria-current="true"]')).toHaveCount(1);
  expect(await settledTop(page)).toBeGreaterThan(0);
  expect(Math.abs((await topOf(header(QUEUE))) - (await columnTop()))).toBeLessThanOrEqual(3);
});

test('F-30.6 A opens the answer card with the question field focused', async ({ page }) => {
  await openStep1(page);
  await page.keyboard.press('a');
  const answer = page.getByRole('article', { name: 'Claude answer' });
  await expect(answer.getByRole('textbox', { name: 'Ask Claude about this step' })).toBeFocused();
});

test('F-30.6 ? on S-03 opens Settings › Shortcuts', async ({ page }) => {
  await openStep1(page);
  await page.keyboard.press('?');
  await expect(page.getByRole('heading', { name: 'Shortcuts', level: 1 })).toBeVisible();
  await expect(
    page
      .getByRole('navigation', { name: 'Settings sections' })
      .getByRole('button', { name: 'Shortcuts', exact: true }),
  ).toHaveAttribute('aria-current', 'page');
});
