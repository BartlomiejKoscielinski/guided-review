import { expect, test, type Locator, type Page } from '@playwright/test';
import { openStep, openStep1, restartApp } from './stepHelpers';

// S-04 Step review · Detailed mode against the mock backend. F-08.1: the Focus | Detailed toggle
// in the title bar and Ctrl+D switch between S-03 and S-04 on the same step, and both modes show
// the same session state: the step, the note decisions, the focused note, the selected lines and
// Claude's answer.

const FIRST = 'The whole photo goes into SQLite as byte[]';
const SECOND = 'PendingCount won’t refresh after upload';

const addLine = (page: Page, no: number) =>
  page.locator(`[data-kind="add"] [data-line-no="${String(no)}"]`);
const mode = (page: Page) =>
  page.getByTestId('title-bar').getByRole('radiogroup', { name: 'Mode' });

// The app runs on a memory router: the screen shows in the title bar's Mode toggle and its content.
async function expectDetailed(page: Page) {
  await expect(mode(page).getByRole('radio', { name: 'Detailed' })).toBeChecked();
  await expect(page.getByRole('complementary', { name: 'Guide' })).toBeVisible();
  await expect(page.getByText('Step 4 of 8')).toHaveCount(0);
  await expect(page.getByRole('radiogroup', { name: 'Layout', exact: true })).toHaveCount(0);
}

async function expectFocus(page: Page) {
  await expect(mode(page).getByRole('radio', { name: 'Focus' })).toBeChecked();
  await expect(page.getByText('Step 4 of 8')).toBeVisible();
}

test('F-08.1 switching modes keeps the step, decisions, focused note and answer', async ({
  page,
}) => {
  await openStep1(page);
  await openStep(page, /ViewModel/, 4);
  await expect(addLine(page, 50)).toBeVisible();
  await expect(mode(page).getByRole('radio', { name: 'Focus' })).toBeChecked();

  // A decision: note 2 goes to the drafts.
  await page.getByRole('button', { name: `Note 2: ${SECOND}` }).click();
  const drafted = page.getByRole('article', { name: `Claude note: ${SECOND}` });
  await drafted.getByRole('button', { name: 'Add to drafts' }).click();
  await expect(drafted.getByText(/Added to drafts\./)).toBeVisible();
  await expect(page.getByText('3 notes')).toBeVisible();

  // The focused note: note 1.
  const first = page.getByRole('button', { name: `Note 1: ${FIRST}` });
  await first.click();
  await expect(first).toHaveAttribute('aria-pressed', 'true');

  // Selected lines and Claude's answer about them.
  const group = page.getByRole('group', { name: 'Selected lines' });
  await addLine(page, 50).click();
  await addLine(page, 52).click({ modifiers: ['Shift'] });
  await expect(group).toContainText('Lines 50–52');
  await group.getByRole('button', { name: 'Ask Claude' }).click();
  const answer = page.getByRole('article', { name: 'Claude answer' });
  await expect(answer.getByRole('textbox', { name: 'Ask Claude about this step' })).toBeFocused();
  await page.keyboard.type('Why two texts?');
  await page.keyboard.press('Enter');
  await expect(answer.getByRole('button', { name: 'Add to drafts' })).toBeVisible();
  await expect(answer).toContainText('Lines 50–52');
  const answered = await answer.innerText();

  // Detailed from the title bar, on the same step.
  await mode(page).getByRole('radio', { name: 'Detailed' }).click();
  await expectDetailed(page);

  // Ctrl+D back to Focus: everything is where the reader left it.
  await page.keyboard.press('Control+d');
  await expectFocus(page);
  await expect(page.getByText('3 notes')).toBeVisible();
  await expect(first).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByRole('button', { name: `Note 2: ${SECOND}` })).toHaveAttribute(
    'aria-pressed',
    'false',
  );
  await expect(group).toContainText('Lines 50–52');
  await expect(answer).toHaveText(answered, { useInnerText: true });
  await expect(answer.getByRole('button', { name: 'Add to drafts' })).toBeVisible();

  // Ctrl+D again opens Detailed; the title bar toggle brings Focus back with the decision kept.
  await page.keyboard.press('Control+d');
  await expectDetailed(page);
  await mode(page).getByRole('radio', { name: 'Focus' }).click();
  await expectFocus(page);
  await page.getByRole('button', { name: `Note 2: ${SECOND}` }).click();
  await expect(
    drafted.getByText('Added to drafts. It reaches GitLab only when you publish.'),
  ).toBeVisible();
});

test('F-08.1 after a restart the app opens Detailed again, on the step it was on', async ({
  page,
}) => {
  await openStep1(page);
  await openStep(page, /ViewModel/, 4);
  await page.keyboard.press('Control+d');
  await expectDetailed(page);

  await restartApp(page);
  await expectDetailed(page);
  await page.keyboard.press('Control+d');
  await expectFocus(page);
});

// F-08.2: the info header above the S-04 rail and main (Main.dc.html's <header>). The numbers are
// the S-02 header's; the steps marked reviewed and the drafts are the session's, so they are made
// in Focus first. --green, --yellow and --line of src/styles/tokens.css as the browser reports them.
const GREEN = 'rgb(99, 214, 118)';
const YELLOW = 'rgb(247, 207, 61)';
const LINE = 'rgb(42, 42, 42)';
const backgroundOf = (locator: ReturnType<Page['locator']>) =>
  locator.evaluateAll((els) => els.map((el) => getComputedStyle(el).backgroundColor));

test('F-08.2 the info header: branch block, author · age, files, step segments, drafts, pipeline to S-08', async ({
  page,
}) => {
  await openStep1(page);
  // Steps 1 to 3 marked reviewed in layout A, then step 4 is open.
  await page.getByRole('button', { name: 'Mark reviewed' }).click();
  await expect(page.getByRole('button', { name: 'Reviewed' })).toBeVisible();
  for (const position of [2, 3]) {
    await page.getByRole('button', { name: 'Next step' }).click();
    await expect(page.getByText(`Step ${String(position)} of 8`)).toBeVisible();
    await page.keyboard.press('Space');
    await expect(page.getByRole('button', { name: 'Reviewed' })).toBeVisible();
  }
  await page.getByRole('button', { name: 'Next step' }).click();
  await expect(page.getByText('Step 4 of 8')).toBeVisible();
  // One draft: note 2 goes to the drafts.
  await page.getByRole('button', { name: `Note 2: ${SECOND}` }).click();
  const drafted = page.getByRole('article', { name: `Claude note: ${SECOND}` });
  await drafted.getByRole('button', { name: 'Add to drafts' }).click();
  await expect(drafted.getByText(/Added to drafts\./)).toBeVisible();

  await page.keyboard.press('Control+d');
  await expectDetailed(page);
  const info = page.getByTestId('info-header');
  await expect(info).toBeVisible();

  const branch = info.getByText('feature/offline-upload → develop', { exact: true });
  await expect(branch).toBeVisible();
  await expect.poll(() => backgroundOf(branch)).toEqual([GREEN]);
  await expect(info.getByText('Marta K. · 2 h ago', { exact: true })).toBeVisible();
  await expect(info).toContainText('16 files +462 −61');
  await expect(info).not.toContainText('commits');

  const segments = info.getByRole('img', { name: 'Step 4 of 8' }).locator('span');
  await expect(segments).toHaveCount(8);
  await expect
    .poll(() => backgroundOf(segments))
    .toEqual([GREEN, GREEN, GREEN, YELLOW, LINE, LINE, LINE, LINE]);
  await expect(info).toContainText(/Steps\s*3\/8/);
  await expect(info).toContainText(/Drafts\s*1/);

  await info.getByRole('link', { name: 'Pipeline passed' }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Pipeline' })).toBeAttached();
});

// F-08.3: the rail. S-02 was shown on the way in, so "Change overview" is done; steps 1 to 3 are
// reviewed (green check), step 4 is current (yellow), the rest show their number; a draft made on
// step 4 shows as its count once another step is open; Skim and "Change coverage" close the rail.
test('F-08.3 the rail: Change overview, step states and draft counts, Skim, Change coverage', async ({
  page,
}) => {
  await openStep1(page);
  await page.getByRole('button', { name: 'Mark reviewed' }).click();
  await expect(page.getByRole('button', { name: 'Reviewed' })).toBeVisible();
  for (const position of [2, 3]) {
    await page.getByRole('button', { name: 'Next step' }).click();
    await expect(page.getByText(`Step ${String(position)} of 8`)).toBeVisible();
    await page.keyboard.press('Space');
    await expect(page.getByRole('button', { name: 'Reviewed' })).toBeVisible();
  }
  await page.getByRole('button', { name: 'Next step' }).click();
  await expect(page.getByText('Step 4 of 8')).toBeVisible();
  await page.getByRole('button', { name: `Note 2: ${SECOND}` }).click();
  const drafted = page.getByRole('article', { name: `Claude note: ${SECOND}` });
  await drafted.getByRole('button', { name: 'Add to drafts' }).click();
  await expect(drafted.getByText(/Added to drafts\./)).toBeVisible();

  await page.keyboard.press('Control+d');
  await expectDetailed(page);
  const rail = page.getByRole('navigation', { name: 'Review plan' });
  await expect(rail).toContainText('contract → UI');
  const row = (name: RegExp) => rail.getByRole('button', { name });

  const overview = row(/Change overview/);
  await expect(overview).toContainText('intent, risks, plan');
  await expect(overview.locator('svg')).toHaveCount(1);
  for (const done of [/Queue contract/, /SqliteUploadQueue/, /UploadWorker with retries/]) {
    await expect(row(done).locator('svg')).toHaveCount(1);
  }
  const current = row(/ViewModel: queue instead of upload/);
  await expect(current).toHaveAttribute('aria-current', 'step');
  await expect(current).toContainText('App · 1 file · +18 −9');
  await expect.poll(() => backgroundOf(current)).toEqual([YELLOW]);
  await expect(row(/Offline banner in the view/)).toContainText('5');
  await expect(row(/Offline banner in the view/).locator('svg')).toHaveCount(0);

  // Another step from the rail: step 4 now shows its one draft.
  await row(/Offline banner in the view/).click();
  await expect(row(/Offline banner in the view/)).toHaveAttribute('aria-current', 'step');
  await expect(row(/ViewModel: queue instead of upload/).getByTitle('1 draft')).toHaveText('1');

  await expect(rail).toContainText('Skim');
  await expect(rail).toContainText('5 files');
  await expect(rail).toContainText('Change coverage');
  await expect(rail).toContainText('16/16 files');
  await expect(rail).toContainText(
    'Every hunk belongs to a step. The order can change, the scope can’t.',
  );

  await overview.click();
  await expect(page.getByRole('heading', { name: 'Plan · 8 steps' })).toBeVisible();
});

// F-08.4: the S-04 step header (Main.dc.html): "Step n / 8" in the reader's order, "builds on"
// chips `<number> · <short title>` that open that step, Previous step, Mark reviewed (Space) and
// Next step (`]`) with the H1 title below. Step 1 builds on nothing; step 4 builds on 1 and 3.
test('F-08.4 a builds-on chip opens that step', async ({ page }) => {
  await openStep1(page);
  await page.keyboard.press('Control+d');
  await expectDetailed(page);
  const kicker = (n: number) => page.getByText(`Step ${String(n)} / 8`, { exact: true });
  const title = page.getByRole('heading', { level: 1 });
  // The header's Next step comes first; the end-of-step card (F-08.9) has one of its own below.
  const next = page.getByRole('button', { name: /^Next step/ }).first();
  const previous = page.getByRole('button', { name: 'Previous step', exact: true });
  const mark = page.getByRole('button', { name: /^(Mark reviewed|Reviewed)/ });
  const buildsOn = page.getByText('builds on', { exact: true });

  await expect(kicker(1)).toBeVisible();
  await expect(title).toHaveText('Queue contract');
  await expect(previous).toBeDisabled();
  await expect(buildsOn).toHaveCount(0);
  await expect(next).toContainText(']');

  await next.click();
  await expect(kicker(2)).toBeVisible();
  await page.keyboard.press(']');
  await expect(kicker(3)).toBeVisible();
  await page.keyboard.press(']');
  await expect(kicker(4)).toBeVisible();
  await expect(title).toHaveText('ViewModel: queue instead of upload');
  await expect(buildsOn).toBeVisible();
  await expect(page.getByRole('button', { name: '1 · Queue contract', exact: true })).toBeVisible();

  await page.getByRole('button', { name: '3 · UploadWorker', exact: true }).click();
  await expect(kicker(3)).toBeVisible();
  await expect(title).toHaveText('UploadWorker with retries');
  await expect(mode(page).getByRole('radio', { name: 'Detailed' })).toBeChecked();
  const rail = page.getByRole('navigation', { name: 'Review plan' });
  await expect(rail.getByRole('button', { name: /UploadWorker with retries/ })).toHaveAttribute(
    'aria-current',
    'step',
  );

  await previous.click();
  await expect(kicker(2)).toBeVisible();
  await expect(title).toHaveText('SqliteUploadQueue');

  // Mark reviewed: the button turns green and reads Reviewed; Space on the page takes it back.
  await expect(mark).toHaveText(/^Mark reviewed/);
  await expect(mark).toContainText('Space');
  await mark.click();
  await expect(mark).toHaveAttribute('aria-pressed', 'true');
  await expect(mark).toHaveText(/^Reviewed/);
  await expect.poll(() => backgroundOf(mark)).toEqual([GREEN]);
  await expect(rail.getByRole('button', { name: /SqliteUploadQueue/ }).locator('svg')).toHaveCount(
    1,
  );
  await mark.blur();
  await page.keyboard.press('Space');
  await expect(mark).toHaveAttribute('aria-pressed', 'false');
  await expect(mark).toHaveText(/^Mark reviewed/);
});

// F-08.5: the file bar sits at the top of the main column while the step's diff scrolls under it;
// Unified turns the diff unified; Open in Rider calls the mock without an error.
test('F-08.5 the file bar stays on top while scrolling; Unified; Open in Rider', async ({
  page,
}) => {
  await openStep1(page);
  await openStep(page, /ViewModel/, 4);
  await page.keyboard.press('Control+d');
  await expectDetailed(page);
  const column = page.locator('main main');
  const whitespace = column.getByRole('button', { name: 'Ignore whitespace' });
  const yOf = async (locator: Locator) => (await locator.boundingBox())?.y ?? Number.NaN;

  await expect(column.getByText('DeliveryPhotoViewModel.cs', { exact: true })).toBeVisible();
  await expect(column.getByText('+34', { exact: true })).toBeVisible();
  await expect(column.getByText('\u221222', { exact: true })).toBeVisible();
  const top = await yOf(column);
  // Before scrolling the bar is below the step header.
  expect(await yOf(whitespace)).toBeGreaterThan(top + 100);

  await column.hover();
  await page.mouse.wheel(0, 600);
  await expect.poll(() => yOf(page.getByRole('heading', { level: 1 }))).toBeLessThan(top);
  await expect(whitespace).toBeInViewport();
  await expect.poll(() => yOf(whitespace)).toBeGreaterThanOrEqual(top);
  expect(await yOf(whitespace)).toBeLessThan(top + 48);
  await expect(column.getByRole('button', { name: 'Open in Rider' })).toBeInViewport();

  const layout = column.getByRole('radiogroup', { name: 'Diff layout' });
  await expect(layout.getByRole('radio', { name: 'Split' })).toHaveAttribute(
    'aria-checked',
    'true',
  );
  await layout.getByRole('radio', { name: 'Unified' }).click();
  await expect(layout.getByRole('radio', { name: 'Unified' })).toHaveAttribute(
    'aria-checked',
    'true',
  );
  await expect(column.locator('[class*="unified"][data-kind]').first()).toBeVisible();
  await expect(column.locator('[class*="split"] [data-kind]')).toHaveCount(0);

  await column.getByRole('button', { name: 'Open in Rider' }).click();
  await expect(column.getByRole('alert')).toHaveCount(0);
});

test('F-08.6 the full callout under the focused note: Add to drafts and Undo, Edit and add, Dismiss on another note', async ({
  page,
}) => {
  await openStep1(page);
  await openStep(page, /ViewModel/, 4);
  await page.keyboard.press('Control+d');
  await expectDetailed(page);
  const callout = page.getByRole('region', { name: 'Claude note at this line' });
  const added = 'Added to drafts. It reaches GitLab only when you publish.';
  const add = callout.getByRole('button', { name: /^Add to drafts/ });
  const yOf = async (locator: Locator) => (await locator.boundingBox())?.y ?? Number.NaN;

  // Step 4 opens on note 2; its callout sits under line 49, above line 50.
  await expect(callout).toHaveCount(1);
  await expect(callout.getByText(SECOND, { exact: true })).toBeVisible();
  await expect(callout.getByText('Should fix', { exact: true })).toBeVisible();
  await expect(callout.getByText('Claude', { exact: true })).toBeVisible();
  await expect(callout.getByText('Checked in', { exact: true })).toBeVisible();
  await expect(callout.getByText('Uploads/UploadWorker.cs:58', { exact: true })).toBeVisible();
  await expect(callout.getByText('Suggested comment', { exact: true })).toBeVisible();
  const mark = page.getByRole('button', { name: `Note 2: ${SECOND}` });
  await expect(mark).toHaveAttribute('aria-pressed', 'true');
  expect(await yOf(callout)).toBeGreaterThan(await yOf(mark));
  expect(await yOf(callout)).toBeLessThan(await yOf(addLine(page, 50)));

  // Add to drafts and Undo.
  await add.click();
  await expect(callout.getByText(added)).toBeVisible();
  await expect(callout.getByRole('button', { name: 'Undo' })).toBeFocused();
  await callout.getByRole('button', { name: 'Undo' }).click();
  await expect(add).toBeVisible();

  // Edit and add sends the edited text.
  await callout.getByRole('button', { name: 'Edit and add' }).click();
  const text = callout.getByRole('textbox', { name: 'Suggested comment' });
  await expect(text).toBeFocused();
  await text.fill('Refresh PendingCount after each upload?');
  await add.click();
  await expect(callout.getByText(added)).toBeVisible();

  // Note 1's mark moves the callout; Dismiss and its confirmation.
  await page.getByRole('button', { name: `Note 1: ${FIRST}` }).click();
  await expect(callout.getByText(FIRST, { exact: true })).toBeVisible();
  await expect(callout).toHaveCount(1);
  await callout.getByRole('button', { name: /^Dismiss/ }).click();
  await expect(
    callout.getByText("Dismissed. Claude won't raise it again for this commit."),
  ).toBeVisible();
});
