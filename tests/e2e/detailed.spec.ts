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
  await expect(answer).toHaveText(answered);
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
