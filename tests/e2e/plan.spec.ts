import { expect, test, type Locator, type Page } from '@playwright/test';

// S-02 against the mock backend: Preparing with stages and Cancel (F-05.6), the M2 prepared
// header (M2 decision 2) and Browse files instead → S-06 MR browse with Open in Rider (F-24.1).

const TITLE = 'Offline queue for delivery photos';
const source = (page: Page) => page.getByLabel(/Paste a merge request link/);
const stages = (page: Page) => page.getByRole('region', { name: 'Preparation' });

async function openMr482(page: Page) {
  await source(page).fill('!482');
  await expect(page.getByText('Merge request !482', { exact: true })).toBeVisible();
  await source(page).press('Enter');
}

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await expect(page.getByTestId('title-bar')).toBeVisible();
});

test('F-05.6 Preparing shows the MR title and the stages, then the plan header', async ({
  page,
}) => {
  await openMr482(page);
  await expect(page.getByRole('heading', { level: 1, name: TITLE })).toBeVisible();
  await expect(stages(page).getByText('Fetching !482')).toBeVisible();
  await expect(stages(page).getByText('Creating worktree')).toBeVisible();
  await expect(stages(page).getByText('Computing diff · 16 files')).toBeVisible();
  await expect(page.getByTestId('title-bar').getByText('!482')).toBeVisible();

  await expect(page.getByRole('button', { name: 'Browse files instead' })).toBeVisible();
  await expect(page.getByText('feature/offline-upload → develop')).toBeVisible();
  await expect(page.getByText('pipeline passed')).toBeVisible();
  await expect(page.getByRole('heading', { level: 1, name: TITLE })).toBeVisible();
});

test('F-05.6 Cancel stops the preparation and goes back to S-01', async ({ page }) => {
  await openMr482(page);
  await expect(stages(page).getByText('Fetching !482')).toBeVisible();
  await page.getByRole('button', { name: 'Cancel' }).click();
  await expect(source(page)).toBeVisible();
  // The cancelled preparation never opens the plan.
  await page.waitForTimeout(2000);
  await expect(source(page)).toBeVisible();
  await expect(page.getByRole('button', { name: 'Browse files instead' })).toHaveCount(0);
});

test('F-24.1 Browse files instead opens the MR read-only with Open in Rider', async ({ page }) => {
  await openMr482(page);
  await page.getByRole('button', { name: 'Browse files instead' }).click();
  const details = page.getByRole('complementary', { name: 'Merge request details' });
  await expect(details.getByText(TITLE)).toBeVisible();
  await expect(page.getByRole('radio', { name: 'MR !482' })).toHaveAttribute(
    'aria-checked',
    'true',
  );
  await expect(page.getByRole('checkbox')).toHaveCount(0);
  await page.getByRole('button', { name: /UploadWorker\.cs/ }).click();
  await expect(page.getByText('UploadWorker: line 1', { exact: false }).first()).toBeVisible();
  await page.getByRole('button', { name: 'Open in Rider' }).click();
  await expect(page.getByRole('alert')).toHaveCount(0);
  await page.getByRole('radio', { name: 'Local changes' }).click();
  await expect(page.getByRole('complementary', { name: 'Merge request details' })).toHaveCount(0);
});

// S-02 plan on the mock (F-06.4, F-06.5, F-06.11): the toggle, a keyboard drag, Start step 1.

const stepRows = (page: Page) => page.locator('li[data-step]');

async function openPlan(page: Page) {
  await openMr482(page);
  await expect(page.getByRole('heading', { name: 'Plan · 8 steps' })).toBeVisible();
}

test('F-06.4 the strategy toggle reorders the steps without a new plan', async ({ page }) => {
  await openPlan(page);
  await expect(stepRows(page).first()).toContainText('Queue contract');
  await page.getByRole('radio', { name: 'Tests first' }).click();
  await expect(stepRows(page).first()).toContainText('Queue tests');
  await expect(
    page.getByText('Tests first: read them as the spec, then the implementation.'),
  ).toBeVisible();
  await page.getByRole('radio', { name: 'File order' }).click();
  await expect(stepRows(page).first()).toContainText('DI registration and worker start');
  await expect(page.getByText('Claude is planning · usually under a minute')).toHaveCount(0);
});

test('F-06.5 a keyboard drag moves a step and clears the strategy', async ({ page }) => {
  await openPlan(page);
  const handle = page.getByRole('button', { name: 'Move step: Queue contract' });
  await handle.focus();
  await page.keyboard.press('Space');
  // dnd-kit measures the rows when the drag starts; move only once the row is lifted and moved.
  const lifted = page.locator('li[data-dragging]');
  await expect(lifted).toHaveCount(1);
  await page.keyboard.press('ArrowDown');
  await expect(lifted).toHaveAttribute('style', /translate3d\(0px, [1-9]/);
  await page.keyboard.press('Space');
  await expect(stepRows(page).nth(0)).toContainText('SqliteUploadQueue');
  await expect(stepRows(page).nth(1)).toContainText('Queue contract');
  await expect(page.getByText('Your order. Pick a strategy to reset it.')).toBeVisible();
  await expect(page.getByRole('radio', { name: 'Contract to UI' })).toHaveAttribute(
    'aria-checked',
    'false',
  );
  // Picking a strategy clears the dragged order.
  await page.getByRole('radio', { name: 'Contract to UI' }).click();
  await expect(stepRows(page).nth(0)).toContainText('Queue contract');
});

// F-06.5 beyond the keyboard drag: the mouse, the order saved in the session, what a dragged
// order replaces, and what does not count as a drag.

const CAPTION = 'Your order. Pick a strategy to reset it.';
const CONTRACT_CAPTION = 'Contract to UI: start with what everything else builds on.';
const TESTS_CAPTION = 'Tests first: read them as the spec, then the implementation.';

const rowOf = (page: Page, title: string) =>
  stepRows(page).filter({ has: page.getByRole('button', { name: `Move step: ${title}` }) });

/** Drags a row by its handle with the mouse until its middle is on the middle of another row. */
async function dragWithMouse(page: Page, title: string, onto: string) {
  const handle = await page.getByRole('button', { name: `Move step: ${title}` }).boundingBox();
  const target = await rowOf(page, onto).boundingBox();
  if (!handle || !target) throw new Error('The rows are not on the screen.');
  const x = handle.x + handle.width / 2;
  const from = handle.y + handle.height / 2;
  await page.mouse.move(x, from);
  await page.mouse.down();
  // Past the activation distance first, then on to the other row.
  await page.mouse.move(x, from + 8, { steps: 4 });
  await page.mouse.move(x, target.y + target.height / 2, { steps: 12 });
  await page.mouse.up();
}

/** How far the lifted row has been moved down (negative: up), from its inline transform. */
const liftedOffset = async (lifted: Locator) => {
  const style = (await lifted.getAttribute('style')) ?? '';
  return Number(/translate3d\(0px, (-?\d+)px/.exec(style)?.[1] ?? 0);
};

/** Two animation frames: React has committed and run its effects (dnd-kit reads them on drop). */
const settled = (page: Page) =>
  page.evaluate(
    () =>
      new Promise<void>((done) => {
        requestAnimationFrame(() => {
          requestAnimationFrame(() => {
            done();
          });
        });
      }),
  );

/** Moves a row `by` places with the keyboard (Space lifts, arrows move, Space drops). */
async function dragWithKeyboard(page: Page, title: string, by: number) {
  await page.getByRole('button', { name: `Move step: ${title}` }).focus();
  await page.keyboard.press('Space');
  const lifted = page.locator('li[data-dragging]');
  await expect(lifted).toHaveCount(1);
  await settled(page);
  for (let i = 0; i < Math.abs(by); i += 1) {
    const before = await liftedOffset(lifted);
    await page.keyboard.press(by > 0 ? 'ArrowDown' : 'ArrowUp');
    // dnd-kit measures the rows when the drag starts; drop only once the row has moved a place.
    await expect
      .poll(async () => Math.sign((await liftedOffset(lifted)) - before))
      .toBe(Math.sign(by));
    await settled(page);
  }
  await page.keyboard.press('Space');
  await expect(page.locator('li[data-dragging]')).toHaveCount(0);
}

const titlesOf = async (page: Page) =>
  (await stepRows(page).locator('[class*="stepTitle"]').allTextContents()).map((t) => t.trim());

test('F-06.5 a mouse drag on the handle moves the row, renumbers the plan and clears the strategy', async ({
  page,
}) => {
  await openPlan(page);
  await dragWithMouse(page, 'Queue contract', 'UploadWorker with retries');
  await expect(stepRows(page).nth(0)).toContainText('SqliteUploadQueue');
  await expect(stepRows(page).nth(1)).toContainText('UploadWorker with retries');
  await expect(stepRows(page).nth(2)).toContainText('Queue contract');
  // The rows are numbered by their new place.
  await expect(stepRows(page).nth(0)).toHaveText(/^1\s*SqliteUploadQueue/);
  await expect(stepRows(page).nth(2)).toHaveText(/^3\s*Queue contract/);
  await expect(stepRows(page).nth(3)).toHaveText(/^4\s*ViewModel/);
  await expect(page.getByRole('heading', { name: 'Plan · 8 steps' })).toBeVisible();
  // While the order is dragged, no strategy is selected.
  await expect(page.getByText(CAPTION)).toBeVisible();
  for (const name of ['Contract to UI', 'Tests first', 'File order']) {
    await expect(page.getByRole('radio', { name })).toHaveAttribute('aria-checked', 'false');
  }
  // Picking a strategy clears the dragged order.
  await page.getByRole('radio', { name: 'Tests first' }).click();
  await expect(page.getByText(CAPTION)).toHaveCount(0);
  await expect(page.getByText(TESTS_CAPTION)).toBeVisible();
  await expect(stepRows(page).nth(0)).toContainText('Queue tests');
});

test('F-06.5 the dragged order is saved in the session and is still there after a restart', async ({
  page,
}) => {
  await openPlan(page);
  await dragWithMouse(page, 'Queue contract', 'UploadWorker with retries');
  await expect(page.getByText(CAPTION)).toBeVisible();
  const dragged = await titlesOf(page);
  expect(dragged.slice(0, 3)).toEqual([
    'SqliteUploadQueue',
    'UploadWorker with retries',
    'Queue contract',
  ]);

  // The state is written on change; reloading the page starts the app again (F-04.3).
  await page.waitForTimeout(500);
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Plan · 8 steps' })).toBeVisible();
  expect(await titlesOf(page)).toEqual(dragged);
  await expect(page.getByText(CAPTION)).toBeVisible();
  await expect(page.getByRole('radio', { name: 'Contract to UI' })).toHaveAttribute(
    'aria-checked',
    'false',
  );

  // Picking a strategy clears it, also after a restart.
  await page.getByRole('radio', { name: 'Contract to UI' }).click();
  await expect(stepRows(page).nth(0)).toContainText('Queue contract');
  await page.waitForTimeout(500);
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Plan · 8 steps' })).toBeVisible();
  await expect(stepRows(page).nth(0)).toContainText('Queue contract');
  await expect(page.getByText(CONTRACT_CAPTION)).toBeVisible();
});

test('F-06.5 a dragged order replaces the strategy order it started from', async ({ page }) => {
  await openPlan(page);
  await page.getByRole('radio', { name: 'Tests first' }).click();
  await expect(stepRows(page).nth(0)).toContainText('Queue tests');
  await dragWithKeyboard(page, 'Queue tests', 1);
  // Tests first was Queue tests, Queue contract, SqliteUploadQueue, ...; the first two swapped.
  await expect(stepRows(page).nth(0)).toContainText('Queue contract');
  await expect(stepRows(page).nth(1)).toContainText('Queue tests');
  await expect(stepRows(page).nth(2)).toContainText('SqliteUploadQueue');
  await expect(page.getByText(CAPTION)).toBeVisible();
  await expect(page.getByRole('radio', { name: 'Tests first' })).toHaveAttribute(
    'aria-checked',
    'false',
  );
  // Picking the strategy the drag started from also resets the order.
  await page.getByRole('radio', { name: 'Tests first' }).click();
  await expect(stepRows(page).nth(0)).toContainText('Queue tests');
  await expect(stepRows(page).nth(1)).toContainText('Queue contract');
  await expect(page.getByText(TESTS_CAPTION)).toBeVisible();
});

test('F-06.5 a second drag builds on the dragged order', async ({ page }) => {
  await openPlan(page);
  await dragWithKeyboard(page, 'Queue contract', 1);
  await expect(stepRows(page).nth(1)).toContainText('Queue contract');
  await dragWithKeyboard(page, 'UploadWorker with retries', -1);
  // SqliteUploadQueue, Queue contract, UploadWorker with retries  ->  the worker moved up one.
  expect((await titlesOf(page)).slice(0, 3)).toEqual([
    'SqliteUploadQueue',
    'UploadWorker with retries',
    'Queue contract',
  ]);
  await expect(page.getByText(CAPTION)).toBeVisible();
});

test('F-06.5 a drop where the row started, or a cancelled drag, is not a dragged order', async ({
  page,
}) => {
  await openPlan(page);
  const handle = page.getByRole('button', { name: 'Move step: Queue contract' });
  await handle.focus();
  await page.keyboard.press('Space');
  await expect(page.locator('li[data-dragging]')).toHaveCount(1);
  await page.keyboard.press('Space');
  await expect(page.locator('li[data-dragging]')).toHaveCount(0);

  await handle.focus();
  await page.keyboard.press('Space');
  const lifted = page.locator('li[data-dragging]');
  await expect(lifted).toHaveCount(1);
  await page.keyboard.press('ArrowDown');
  await expect(lifted).toHaveAttribute('style', /translate3d\(0px, [1-9]/);
  await page.keyboard.press('Escape');
  await expect(lifted).toHaveCount(0);

  await expect(stepRows(page).nth(0)).toContainText('Queue contract');
  await expect(stepRows(page).nth(1)).toContainText('SqliteUploadQueue');
  await expect(page.getByText(CAPTION)).toHaveCount(0);
  await expect(page.getByText(CONTRACT_CAPTION)).toBeVisible();
  await expect(page.getByRole('radio', { name: 'Contract to UI' })).toHaveAttribute(
    'aria-checked',
    'true',
  );
});

test('F-06.5 the aside points at the steps by their place in the dragged order', async ({
  page,
}) => {
  await openPlan(page);
  const aside = page.getByRole('complementary', { name: 'Plan details' });
  await expect(aside).toContainText('database size during a long offline period. Steps 2, 4');
  await dragWithKeyboard(page, 'Queue contract', 1);
  // SqliteUploadQueue is step 1 now; ViewModel stays step 4.
  await expect(aside).toContainText('database size during a long offline period. Steps 1, 4');
});

test('F-06.5 Start step 1 opens the first step of the dragged order, and Next follows it', async ({
  page,
}) => {
  await openPlan(page);
  await dragWithKeyboard(page, 'Queue contract', 1);
  await expect(stepRows(page).nth(0)).toContainText('SqliteUploadQueue');
  await page.getByRole('button', { name: /Start step 1/ }).click();
  await expect(page.getByText('Step 1 of 8')).toBeVisible();
  await expect(page.getByRole('heading', { level: 1, name: 'SqliteUploadQueue' })).toBeVisible();
  const steps = page.getByRole('navigation', { name: 'Steps' });
  await expect(steps.getByRole('button').nth(0)).toContainText('SqliteUploadQueue');
  await expect(steps.getByRole('button').nth(1)).toContainText('Queue contract');
  await page.getByRole('button', { name: 'Next step' }).click();
  await expect(page.getByText('Step 2 of 8')).toBeVisible();
  await expect(page.getByRole('heading', { level: 1, name: 'Queue contract' })).toBeVisible();
});

test('F-06.11 Enter starts step 1', async ({ page }) => {
  await openPlan(page);
  await page.getByRole('heading', { level: 1, name: TITLE }).click();
  await page.keyboard.press('Enter');
  // The app routes in memory; S-03's title bar has Finish review.
  await expect(page.getByRole('button', { name: 'Finish review' })).toBeVisible();
});

// F-06.6 the Skim row and Show (M3 plan: Show opens the S-06-like browse of the MR filtered to the
// row's files). The mock !482 skim row groups the 5 files of Overview.dc.html.

const SKIM_FILES = [
  'RetryPolicy.cs',
  'DeliveryPhotoPage.xaml',
  'RetryPolicyTests.cs',
  'Mobile.App.csproj',
  'AppResources.resx',
];
const OTHER_FILES = [
  'QueuedPhoto.cs',
  'IUploadQueue.cs',
  'SqliteUploadQueue.cs',
  'UploadWorker.cs',
  'DependencyInjection.cs',
  'DeliveryPhotoViewModel.cs',
  'PhotoUploadService.cs',
  'OfflineBanner.xaml',
  'PendingCountConverter.cs',
  'AndroidManifest.xml',
  'SqliteUploadQueueTests.cs',
];

const skimRow = (page: Page) => page.locator('li', { hasText: 'Skim: 5 mechanical files' });
const filesTree = (page: Page) => page.getByRole('tree', { name: 'Files' });
/** A file row's button in the S-06 tree (the name starts with the file name). */
const fileButton = (tree: Locator, name: string) =>
  tree.getByRole('button', { name: new RegExp(`^${name.replace(/\./g, '\\.')}`) });

/** The Skim row sits below the last step row. */
async function expectBelowSteps(page: Page) {
  const last = await stepRows(page).last().boundingBox();
  const skim = await skimRow(page).boundingBox();
  if (!last || !skim) throw new Error('The rows are not on the screen.');
  expect(skim.y).toBeGreaterThanOrEqual(last.y + last.height);
}

test('F-06.6 the plan ends with the Skim row: "Skim: 5 mechanical files", the reason and Show', async ({
  page,
}) => {
  await openPlan(page);
  const skim = skimRow(page);
  await expect(skim).toHaveCount(1);
  await expect(skim.getByText('Skim: 5 mechanical files', { exact: true })).toBeVisible();
  await expect(
    skim.getByText(
      'Formatting (3), csproj with a new package, 3 keys in Strings.resx. Checked: no logic changes.',
    ),
  ).toBeVisible();
  await expect(skim.getByRole('button', { name: 'Show' })).toBeVisible();
  // Below the steps, with no drag handle, whichever order the steps are in.
  await expect(skim.getByRole('button', { name: /^Move step:/ })).toHaveCount(0);
  await expectBelowSteps(page);
  await page.getByRole('radio', { name: 'Tests first' }).click();
  await expect(stepRows(page).first()).toContainText('Queue tests');
  await expect(skim).toHaveCount(1);
  await expectBelowSteps(page);
});

test('F-06.6 Show opens the MR browse with only the skim files', async ({ page }) => {
  await openPlan(page);
  await skimRow(page).getByRole('button', { name: 'Show' }).click();
  const tree = filesTree(page);
  await expect(tree).toBeVisible();
  for (const name of SKIM_FILES) await expect(fileButton(tree, name)).toHaveCount(1);
  for (const name of OTHER_FILES) await expect(fileButton(tree, name)).toHaveCount(0);
  // The diff next to the tree is read-only, as in the MR browse.
  await expect(page.getByRole('checkbox')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Open in Rider' })).toBeVisible();
});

test('F-06.6 Browse files instead still lists the whole change, the skim files with the rest', async ({
  page,
}) => {
  await openPlan(page);
  await page.getByRole('button', { name: 'Browse files instead' }).click();
  const tree = filesTree(page);
  await expect(tree).toBeVisible();
  for (const name of [...SKIM_FILES, ...OTHER_FILES]) {
    await expect(fileButton(tree, name)).toHaveCount(1);
  }
});
