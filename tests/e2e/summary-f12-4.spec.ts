import { expect, test, type Locator, type Page } from '@playwright/test';
import { openStep, openStep1, restartApp } from './stepHelpers';

// F-12.4 against the mock backend (SummaryDesk.dc.html): "Add a summary comment" under the drafts
// of S-05 of an MR session (!482). The blue checkbox reveals a text area; ticking runs the summary
// task once ("Claude is writing a summary…", the area stays editable), the answer prefills the area
// under the label "Suggested by Claude, edit as you like" (violet 8px square). The tick and the
// text are kept per session. M5 decision 11: a failed run says "Couldn't suggest a summary." with
// Retry; Claude that is not signed in leaves the empty area without a label. Not tried in the real
// app (real `claude` run, stand-in GitLab, SQLite).

/** `summary` of SummaryDesk.dc.html, the mock backend's suggestion. */
const MOCK_SUMMARY =
  'Thanks, the offline queue approach looks good. Before merging: handle camera cancellation, refresh the counter after uploads, and cap retries in UploadWorker.';
const RUNNING = 'Claude is writing a summary…';
const SUGGESTED = 'Suggested by Claude, edit as you like';
const FAILED = "Couldn't suggest a summary.";
const CLAUDE_KEY = 'guided-review.mock.claude';

const BLUE = 'rgb(63, 124, 242)';
const VIOLET = 'rgb(185, 60, 246)';

const NOTE = {
  title: 'PendingCount won’t refresh after upload',
  n: 2,
};

const finishReview = (page: Page) =>
  page.getByTestId('title-bar').getByRole('button', { name: 'Finish review' });
const panel = (page: Page) => page.getByRole('tabpanel');
const tick = (page: Page) =>
  panel(page).getByRole('checkbox', { name: 'Add a summary comment', exact: true });
const area = (page: Page) => panel(page).getByRole('textbox');

/** One draft from the notes of step 4, then Finish review: S-05 on its Drafts tab. */
async function openDrafts(page: Page) {
  await openStep1(page);
  await openStep(page, /ViewModel/, 4);
  await page.getByRole('button', { name: `Note ${String(NOTE.n)}: ${NOTE.title}` }).click();
  const card = page.getByRole('article', { name: `Claude note: ${NOTE.title}` });
  await card.getByRole('button', { name: 'Add to drafts' }).click();
  await expect(card.getByText(/Added to drafts\./)).toBeVisible();
  await finishReview(page).click();
  await expect(page.getByRole('heading', { name: /^summary$/i })).toBeVisible();
  await expect(panel(page).getByRole('listitem')).toHaveCount(1);
}

/** Whether the element or a descendant is a filled `size` px square painted `color`. */
function hasSquare(target: Locator, size: number, color: string): Promise<boolean> {
  return target.evaluate(
    (element, wanted) => {
      return Array.from(element.querySelectorAll('*')).some((el) => {
        const rect = el.getBoundingClientRect();
        return (
          Math.round(rect.width) === wanted.size &&
          Math.round(rect.height) === wanted.size &&
          getComputedStyle(el).backgroundColor === wanted.color
        );
      });
    },
    { size, color },
  );
}

test('F-12.4 the blue checkbox reveals a text area that Claude prefills with a short summary', async ({
  page,
}) => {
  await openDrafts(page);
  await expect(tick(page)).not.toBeChecked();
  await expect(area(page)).toHaveCount(0);
  const accent = await tick(page).evaluate((el) => getComputedStyle(el).accentColor);
  expect(accent).toBe(BLUE);

  await tick(page).click();
  await expect(tick(page)).toBeChecked();
  // The area is there at once and stays editable while Claude writes.
  await expect(panel(page).getByRole('textbox', { name: RUNNING })).toBeEditable();
  await expect(panel(page).getByText(SUGGESTED, { exact: true })).toHaveCount(0);

  const suggested = panel(page).getByRole('textbox', { name: SUGGESTED });
  await expect(suggested).toHaveValue(MOCK_SUMMARY);
  await expect(suggested).toBeEditable();
  await expect(panel(page).getByText(RUNNING, { exact: true })).toHaveCount(0);
  const label = panel(page).locator('label', { hasText: SUGGESTED });
  expect(await hasSquare(label, 8, VIOLET)).toBe(true);
});

test('F-12.4 what the reviewer types while Claude writes stays, and the suggestion is dropped', async ({
  page,
}) => {
  await openDrafts(page);
  await tick(page).click();
  const running = panel(page).getByRole('textbox', { name: RUNNING });
  await running.fill('My own summary.');
  await expect(panel(page).getByText(RUNNING, { exact: true })).toHaveCount(0);
  await expect(area(page)).toHaveValue('My own summary.');
  await expect(panel(page).getByText(SUGGESTED, { exact: true })).toHaveCount(0);
});

test('F-12.4 the tick and the edited text are still there after a restart, and unticking keeps the text without a second run', async ({
  page,
}) => {
  await openDrafts(page);
  await tick(page).click();
  const suggested = panel(page).getByRole('textbox', { name: SUGGESTED });
  await expect(suggested).toHaveValue(MOCK_SUMMARY);
  await suggested.press('End');
  await suggested.pressSequentially(' And the banner.');
  await expect(suggested).toHaveValue(`${MOCK_SUMMARY} And the banner.`);

  await restartApp(page);
  await expect(panel(page).getByRole('listitem')).toHaveCount(1);
  await expect(tick(page)).toBeChecked();
  await expect(area(page)).toHaveValue(`${MOCK_SUMMARY} And the banner.`);
  // Opening the summary again starts no Claude run.
  await expect(panel(page).getByText(RUNNING, { exact: true })).toHaveCount(0);

  await tick(page).click();
  await expect(tick(page)).not.toBeChecked();
  await expect(area(page)).toHaveCount(0);
  await tick(page).click();
  await expect(area(page)).toHaveValue(`${MOCK_SUMMARY} And the banner.`);
  await expect(panel(page).getByText(RUNNING, { exact: true })).toHaveCount(0);
});

test('F-12.4 a failed run says "Couldn\'t suggest a summary." with Retry and an empty area', async ({
  page,
}) => {
  await page.addInitScript(
    ([key, scenario]: [string, string]) => {
      window.localStorage.setItem(key, scenario);
    },
    [CLAUDE_KEY, JSON.stringify({ suggestFails: 'limited' })] as [string, string],
  );
  await openDrafts(page);
  await tick(page).click();
  await expect(panel(page).getByText(FAILED, { exact: true })).toBeVisible();
  await expect(area(page)).toHaveValue('');
  await expect(area(page)).toBeEditable();
  await expect(panel(page).getByText(SUGGESTED, { exact: true })).toHaveCount(0);

  await panel(page).getByRole('button', { name: 'Retry', exact: true }).click();
  await expect(panel(page).getByText(FAILED, { exact: true })).toBeVisible();
  await expect(area(page)).toHaveValue('');
});

test('F-12.4 with Claude not signed in the area stays empty without a label, and the reviewer can still write', async ({
  page,
}) => {
  await page.addInitScript(
    ([key, scenario]: [string, string]) => {
      window.localStorage.setItem(key, scenario);
    },
    [CLAUDE_KEY, JSON.stringify({ suggestFails: 'notSignedIn' })] as [string, string],
  );
  await openDrafts(page);
  await tick(page).click();
  await expect(tick(page)).toBeChecked();
  await expect(area(page)).toBeEditable();
  await expect(area(page)).toHaveValue('');
  // The run is over (nothing is pending) and it leaves no label, failure line or Retry.
  await expect(panel(page).getByText(RUNNING, { exact: true })).toHaveCount(0);
  await expect(panel(page).getByText(SUGGESTED, { exact: true })).toHaveCount(0);
  await expect(panel(page).getByText(FAILED, { exact: true })).toHaveCount(0);
  await expect(panel(page).getByRole('button', { name: 'Retry', exact: true })).toHaveCount(0);

  await area(page).fill('Written by hand.');
  await expect(area(page)).toHaveValue('Written by hand.');
});
