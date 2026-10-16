import { expect, type Page } from '@playwright/test';
import { flushSaves } from './stepHelpers';

// Helpers of the F-30.6 specs (step-f30-6.spec.ts, detailed-f30-6.spec.ts): the arrow-key walk in
// a real layout. S-03 and S-04 scroll their main column, the `main` inside the shell's `main`.

export const scroller = (page: Page) => page.locator('main main');

export const scrollTop = (page: Page) => scroller(page).evaluate((el) => el.scrollTop);

export const screenHeight = (page: Page) => scroller(page).evaluate((el) => el.clientHeight);

/** The scroll position once it stops changing (the walk's scroll may be smooth). */
export async function settledTop(page: Page): Promise<number> {
  let last = -1;
  await expect
    .poll(
      async () => {
        const now = await scrollTop(page);
        const stable = now === last;
        last = now;
        return stable;
      },
      { intervals: [120], timeout: 5000 },
    )
    .toBe(true);
  return last;
}

/** A file's Reviewed toggle (S-03 file header, S-04 sticky file bar). */
export const fileToggle = (page: Page, path: string) =>
  page.getByRole('button', { name: `Mark ${path} reviewed`, exact: true });

export async function isMarked(page: Page, path: string): Promise<boolean> {
  return (await fileToggle(page, path).getAttribute('aria-pressed')) === 'true';
}

/** The element marked as the current change (its focus outline). */
export const currentChange = (page: Page) => page.locator('[aria-current="true"]');

/** Whether a diff line (by its line number) is rendered and inside the scrolling column. */
export function lineShown(page: Page, line: number): Promise<boolean> {
  return page.evaluate((no) => {
    const column = document.querySelector('main main');
    if (!column) return false;
    const box = column.getBoundingClientRect();
    return Array.from(column.querySelectorAll(`[data-line-no="${String(no)}"]`)).some((el) => {
      const rect = el.getBoundingClientRect();
      return rect.top >= box.top && rect.bottom <= box.bottom + 1;
    });
  }, line);
}

export interface TallWalk {
  presses: number;
  /** The settled scroll position after each press. */
  tops: number[];
  height: number;
  /** The last line of the change was inside the screen before the press that marked the file. */
  shownBeforeMarking: boolean;
  marked: boolean;
}

/**
 * Presses ↓ on a change taller than the screen until its file is marked: the first press makes the
 * change current, then it scrolls a screen at a time, then the press after its last line is shown
 * marks the file (F-30.6, M4 decision 15). Gives up after ten presses.
 */
export async function walkTallChange(
  page: Page,
  path: string,
  lastLine: number,
): Promise<TallWalk> {
  const height = await screenHeight(page);
  const tops: number[] = [];
  let shownBeforeMarking = false;
  let presses = 0;
  let marked = false;
  while (presses < 10 && !marked) {
    const shown = await lineShown(page, lastLine);
    const before = await scrollTop(page);
    await page.keyboard.press('ArrowDown');
    presses += 1;
    // The press scrolls or marks (the mark is saved after the mock's latency).
    await expect
      .poll(async () => (await isMarked(page, path)) || (await scrollTop(page)) !== before, {
        timeout: 5000,
      })
      .toBe(true);
    tops.push(await settledTop(page));
    await flushSaves(page);
    marked = await isMarked(page, path);
    if (marked) shownBeforeMarking = shown;
  }
  return { presses, tops, height, shownBeforeMarking, marked };
}
