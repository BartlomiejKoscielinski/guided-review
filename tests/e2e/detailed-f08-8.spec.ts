import { expect, test, type Locator, type Page } from '@playwright/test';
import { openStep1 } from './stepHelpers';

// F-08.8: the S-04 footer against the mock backend (Main.dc.html's <footer>): the shortcut hints
// "J K hunk", "[ ] step", "N note", "C comment", "A ask", "Space reviewed", "? all shortcuts" with
// keys, then Claude's status after a square (--purple; --orange with the Claude Code status words
// when Claude Code is unusable, M4 decision 9) and the code Claude reads ("worktree @ a3f9c12",
// decision 10). The status text table is in src/screens/detailed/Footer.test.tsx.

/** --purple and --orange of src/styles/tokens.css as the browser reports them. */
const PURPLE = 'rgb(185, 60, 246)';
const ORANGE = 'rgb(239, 110, 46)';

const HINTS = [
  'J K hunk',
  '[ ] step',
  'N note',
  'C comment',
  'A ask',
  'Space reviewed',
  '? all shortcuts',
];

const footer = (page: Page) => page.locator('footer');

/** S-01 › !482 › S-02 › Start step 1, then Ctrl+D: S-04 on step 1 of the MR session. */
async function openDetailed(page: Page) {
  await openStep1(page);
  await page.keyboard.press('Control+d');
  await expect(page.getByRole('complementary', { name: 'Guide' })).toBeVisible();
}

/** The background of the square right before the Claude line's text. */
const squareOf = (line: Locator) =>
  line.evaluate((el) => {
    const square = Array.from(el.querySelectorAll('*')).find(
      (child) =>
        child.textContent === '' && getComputedStyle(child).backgroundColor !== 'rgba(0, 0, 0, 0)',
    );
    return square ? getComputedStyle(square).backgroundColor : null;
  });

test('F-08.8 the footer: shortcut hints, Claude status with a purple square, worktree @ a3f9c12', async ({
  page,
}) => {
  await openDetailed(page);
  const bar = footer(page);
  await expect(bar).toBeVisible();
  await expect(bar.locator('kbd')).toHaveText(['J', 'K', '[', ']', 'N', 'C', 'A', 'Space', '?']);
  for (const hint of HINTS) {
    await expect(bar.getByText(hint, { exact: true })).toBeVisible();
  }
  const line = bar.getByText(/^Claude: (idle|.*(ready|analyzing|failed).*)$/);
  await expect(line).toBeVisible();
  await expect.poll(() => squareOf(line)).toBe(PURPLE);
  await expect(bar.getByText('worktree @ a3f9c12', { exact: true })).toBeVisible();
});

test('F-08.8 Claude Code not signed in: the footer shows its status words after an orange square', async ({
  page,
}) => {
  await page.addInitScript(() => {
    localStorage.setItem('guided-review.mock.claude', JSON.stringify({ state: 'notSignedIn' }));
  });
  await openDetailed(page);
  const bar = footer(page);
  const line = bar.getByText('Claude Code: not signed in', { exact: true });
  await expect(line).toBeVisible();
  await expect.poll(() => squareOf(line)).toBe(ORANGE);
  await expect(bar.getByText(/^Claude: /)).toHaveCount(0);
  await expect(bar.getByText('? all shortcuts', { exact: true })).toBeVisible();
});
