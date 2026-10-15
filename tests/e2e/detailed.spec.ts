import { expect, test, type Page } from '@playwright/test';
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
  await expect(page.getByRole('radiogroup', { name: 'Layout' })).toHaveCount(0);
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
