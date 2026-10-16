import { expect, test, type Locator, type Page } from '@playwright/test';
import { flushSaves, openStep, openStep1, restartApp, stepsList } from './stepHelpers';

// S-03 progress against the mock backend: the steps marked reviewed (F-07.2) drive the done
// checks in layout A's steps list and the progress segments in B's title bar and C's guide panel
// (F-07.1).

// F-07.1: done checks in the steps list (layout A) and progress segments (title bar in B, guide
// panel in C) come from the steps marked reviewed in the session's data. The mock keeps those next
// to the rest of the session, so the tests mark steps there and start the app again; what a click
// on Mark reviewed does is F-07.2.

const SESSION_DATA_KEY = 'guided-review.mock.sessionData';
// --green, --yellow and --line of src/styles/tokens.css as the browser reports them.
const GREEN = 'rgb(99, 214, 118)';
const YELLOW = 'rgb(247, 207, 61)';
const LINE = 'rgb(42, 42, 42)';

/**
 * Marks `ids` reviewed in the stored session data, then starts the app again (a page reload). The
 * marks are written by a script that runs before the app on the next load, so a save the page
 * makes while it closes cannot overwrite them.
 */
async function restartWithReviewed(page: Page, ids: string[]) {
  await flushSaves(page);
  await page.addInitScript(
    ({ key, reviewed }) => {
      const data = JSON.parse(localStorage.getItem(key) ?? '{}') as {
        plans?: Record<string, unknown>;
        marks?: Record<string, string[]>;
      };
      const session = Object.keys(data.plans ?? {})[0] ?? '';
      data.marks = { ...data.marks, [session]: reviewed };
      localStorage.setItem(key, JSON.stringify(data));
    },
    { key: SESSION_DATA_KEY, reviewed: ids },
  );
  await page.reload();
}

const backgrounds = (segments: Locator) =>
  segments.evaluateAll((els) => els.map((el) => getComputedStyle(el).backgroundColor));
const barSegments = (page: Page, step = 4) =>
  page
    .getByTestId('title-bar')
    .getByRole('button', { name: `Review plan: step ${String(step)} of 8` })
    .locator('span');
const guideSegments = (page: Page, step = 4) =>
  page
    .getByRole('complementary', { name: 'Guide' })
    .getByRole('img', { name: new RegExp(`^Step ${String(step)} of 8`) })
    .locator('span');

test('F-07.1 layout A: a reviewed step gets a green check square instead of its number; the list counts them', async ({
  page,
}) => {
  await openStep1(page);
  await openStep(page, /ViewModel/, 4);
  await restartWithReviewed(page, ['s1', 's2', 's3']);
  await expect(page.getByText('Step 4 of 8')).toBeVisible();

  const list = stepsList(page);
  await expect(list).toContainText('3/8');
  for (const title of [/Queue contract/, /SqliteUploadQueue/, /UploadWorker/]) {
    const square = list.getByRole('button', { name: title }).locator('span').first();
    await expect(square.locator('svg')).toHaveCount(1);
    expect(await backgrounds(square)).toEqual([GREEN]);
    await expect(square).toHaveText('');
  }
  // The current step stays the yellow row with its number; the steps after it stay numbered.
  const current = list.getByRole('button', { name: /ViewModel/ });
  await expect(current).toHaveAttribute('aria-current', 'step');
  await expect(current.locator('span').first()).toHaveText('4');
  const later = list
    .getByRole('button', { name: /Offline banner/ })
    .locator('span')
    .first();
  await expect(later).toHaveText('5');
  await expect(later.locator('svg')).toHaveCount(0);
});

test('F-07.1 layouts B and C: segments are green for reviewed steps, yellow on the current one, dark for the rest', async ({
  page,
}) => {
  await openStep1(page);
  await openStep(page, /ViewModel/, 4);

  // Nothing reviewed yet: being on step 4 does not make steps 1 to 3 done.
  await page
    .getByRole('radiogroup', { name: 'Layout' })
    .getByRole('radio', { name: 'Minimal layout (Ctrl+2)' })
    .click();
  await expect
    .poll(() => backgrounds(barSegments(page)))
    .toEqual([LINE, LINE, LINE, YELLOW, LINE, LINE, LINE, LINE]);

  // Steps 1 and 3 reviewed, step 2 skipped: the segments follow the marks, not the position.
  await restartWithReviewed(page, ['s1', 's3']);
  await expect(page.getByRole('toolbar', { name: 'Step navigation' })).toContainText('Step 4 of 8');
  const marked = [GREEN, LINE, GREEN, YELLOW, LINE, LINE, LINE, LINE];
  await expect.poll(() => backgrounds(barSegments(page))).toEqual(marked);

  await page.keyboard.press('Control+3');
  await expect(page.getByRole('complementary', { name: 'Guide' })).toBeVisible();
  await expect.poll(() => backgrounds(guideSegments(page))).toEqual(marked);

  // The layouts share the marks: back in A the same steps carry the check.
  await page.keyboard.press('Control+1');
  const list = stepsList(page);
  await expect(list).toContainText('2/8');
  await expect(list.getByRole('button', { name: /Queue contract/ }).locator('svg')).toHaveCount(1);
  await expect(list.getByRole('button', { name: /SqliteUploadQueue/ }).locator('svg')).toHaveCount(
    0,
  );
  await expect(list.getByRole('button', { name: /UploadWorker/ }).locator('svg')).toHaveCount(1);
});

test('F-07.1 the current step stays yellow in the segments and numbered in the list even when it is reviewed', async ({
  page,
}) => {
  await openStep1(page);
  await openStep(page, /ViewModel/, 4);
  await restartWithReviewed(page, ['s1', 's2', 's3', 's4']);
  await expect(stepsList(page)).toContainText('4/8');
  await expect(
    stepsList(page)
      .getByRole('button', { name: /ViewModel/ })
      .locator('span')
      .first(),
  ).toHaveText('4');

  await page.keyboard.press('Control+2');
  await expect
    .poll(() => backgrounds(barSegments(page)))
    .toEqual([GREEN, GREEN, GREEN, YELLOW, LINE, LINE, LINE, LINE]);
  await page.keyboard.press('Control+3');
  await expect
    .poll(() => backgrounds(guideSegments(page)))
    .toEqual([GREEN, GREEN, GREEN, YELLOW, LINE, LINE, LINE, LINE]);
});

// F-07.2, F-07.8, F-07.7: Mark reviewed in A's header, B's toolbar and C's guide panel, and Space,
// mark the step in the session's data; the checks and segments follow at once and after a restart.

test('F-07.2 F-07.8 F-07.7 Mark reviewed and Space in A, B and C; the marks survive a restart', async ({
  page,
}) => {
  await openStep1(page);
  const list = stepsList(page);

  // A: the header's button marks step 1 and turns to Reviewed; the list counts it.
  await expect(list).toContainText('0/8');
  await page.getByRole('button', { name: 'Mark reviewed' }).click();
  await expect(page.getByRole('button', { name: 'Reviewed', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await expect(list).toContainText('1/8');
  // Reviewed is green, also under the pointer that just clicked it (Review.dc.html).
  await expect
    .poll(() => backgrounds(page.getByRole('button', { name: 'Reviewed', exact: true })))
    .toEqual([GREEN]);

  // Space marks step 2, a second Space takes the mark back, a third puts it on again.
  await page.getByRole('button', { name: 'Next step' }).click();
  await expect(page.getByText('Step 2 of 8')).toBeVisible();
  await page.keyboard.press('Space');
  await expect(page.getByRole('button', { name: 'Reviewed', exact: true })).toBeVisible();
  await expect(list).toContainText('2/8');
  await page.keyboard.press('Space');
  await expect(page.getByRole('button', { name: 'Mark reviewed' })).toBeVisible();
  await expect(list).toContainText('1/8');
  await page.keyboard.press('Space');
  await expect(list).toContainText('2/8');
  await expect(list.getByRole('button', { name: /Queue contract/ }).locator('svg')).toHaveCount(1);

  // B: the toolbar's Mark reviewed marks step 3; the title bar's segments follow.
  await page.keyboard.press('Control+2');
  const bar = page.getByRole('toolbar', { name: 'Step navigation' });
  await bar.getByRole('button', { name: 'Next step' }).click();
  await expect(bar).toContainText('Step 3 of 8');
  await bar.getByRole('button', { name: 'Mark reviewed' }).click();
  await expect(bar.getByRole('button', { name: 'Reviewed', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await expect
    .poll(() => backgrounds(bar.getByRole('button', { name: 'Reviewed', exact: true })))
    .toEqual([GREEN]);
  await expect
    .poll(() => backgrounds(barSegments(page, 3)))
    .toEqual([GREEN, GREEN, YELLOW, LINE, LINE, LINE, LINE, LINE]);
  await bar.getByRole('button', { name: 'Next step' }).click();
  await expect
    .poll(() => backgrounds(barSegments(page)))
    .toEqual([GREEN, GREEN, GREEN, YELLOW, LINE, LINE, LINE, LINE]);

  // C: Space in the ask input types a space and marks nothing; the large button marks step 4.
  await page.keyboard.press('Control+3');
  const guide = page.getByRole('complementary', { name: 'Guide' });
  const ask = guide.getByRole('textbox', { name: 'Ask Claude about this step' });
  await ask.pressSequentially('why not');
  await expect(ask).toHaveValue('why not');
  await expect(guide.getByRole('button', { name: 'Mark reviewed' })).toHaveAttribute(
    'aria-pressed',
    'false',
  );
  await guide.getByRole('button', { name: 'Mark reviewed' }).click();
  await expect(guide.getByRole('button', { name: 'Reviewed', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await expect
    .poll(() => backgrounds(guide.getByRole('button', { name: 'Reviewed', exact: true })))
    .toEqual([GREEN]);
  // The current step stays yellow even when it is reviewed.
  await expect
    .poll(() => backgrounds(guideSegments(page)))
    .toEqual([GREEN, GREEN, GREEN, YELLOW, LINE, LINE, LINE, LINE]);

  // After a restart the marks are still there, in C and back in A.
  await restartApp(page);
  await expect(guide.getByRole('button', { name: 'Reviewed', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await page.keyboard.press('Control+1');
  await expect(list).toContainText('4/8');
  for (const title of [/Queue contract/, /SqliteUploadQueue/, /UploadWorker/]) {
    await expect(list.getByRole('button', { name: title }).locator('svg')).toHaveCount(1);
  }
});
