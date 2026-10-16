import { expect, test, type Locator, type Page } from '@playwright/test';
import { openStep1 } from './stepHelpers';

// F-08.9: the end-of-step card at the end of S-04's main column against the mock backend
// (Main.dc.html): "End of step N", "Next: <title> · N files · +add −del" with the rail's numbers and
// a yellow Next step with its key `]`; on the last step "End of step 8", "That was the last step."
// and a yellow Finish review in place of Next step, which opens S-05 (M4 decision 11). The copy
// of every step is in src/screens/detailed/EndOfStepCard.test.tsx.

/** --yellow of src/styles/tokens.css (the mock's accent) as the browser reports it. */
const YELLOW = 'rgb(247, 207, 61)';

/** S-04's own main column (the shell's <main> holds the whole screen). */
const mainColumn = (page: Page) => page.locator('main main');

const backgroundOf = (locator: Locator) =>
  locator.evaluate((el) => getComputedStyle(el).backgroundColor);

/** S-01 › !482 › S-02 › Start step 1, then Ctrl+D: S-04 on step 1 of the MR session. */
async function openDetailed(page: Page) {
  await openStep1(page);
  await page.keyboard.press('Control+d');
  await expect(page.getByRole('complementary', { name: 'Guide' })).toBeVisible();
  await expect(page.getByText('Step 1 / 8', { exact: true })).toBeVisible();
}

test('F-08.9 the end-of-step card: End of step 1, the next step with its numbers, Next step opens step 2', async ({
  page,
}) => {
  await openDetailed(page);
  const main = mainColumn(page);
  await expect(main.getByText('End of step 1', { exact: true })).toBeVisible();
  await expect(
    main.getByText('Next: SqliteUploadQueue · 1 file · +142', { exact: true }),
  ).toBeVisible();
  // The header's Next step comes first, the card's below the diff.
  const nexts = main.getByRole('button', { name: /^Next step/ });
  await expect(nexts).toHaveCount(2);
  const cardNext = nexts.last();
  await expect(cardNext.getByText(']', { exact: true })).toBeVisible();
  await expect.poll(() => backgroundOf(cardNext)).toBe(YELLOW);

  await cardNext.click();
  await expect(page.getByText('Step 2 / 8', { exact: true })).toBeVisible();
  await expect(main.getByText('End of step 2', { exact: true })).toBeVisible();
  await expect(
    main.getByText('Next: UploadWorker with retries · 1 file · +96', { exact: true }),
  ).toBeVisible();
});

test('F-08.9 the last step: End of step 8, That was the last step., a yellow Finish review opens S-05', async ({
  page,
}) => {
  await openDetailed(page);
  const rail = page.getByRole('navigation', { name: 'Review plan' });
  await rail.getByRole('button', { name: /Queue tests/ }).click();
  await expect(page.getByText('Step 8 / 8', { exact: true })).toBeVisible();

  const main = mainColumn(page);
  await expect(main.getByText('End of step 8', { exact: true })).toBeVisible();
  await expect(main.getByText('That was the last step.', { exact: true })).toBeVisible();
  await expect(main.getByText(/^Next: /)).toHaveCount(0);
  await expect(main.getByRole('button', { name: /^Next step/ })).toHaveCount(1);
  const finish = main.getByRole('button', { name: 'Finish review', exact: true });
  await expect(finish).toBeVisible();
  await expect.poll(() => backgroundOf(finish)).toBe(YELLOW);

  await finish.click();
  // The router is a memory router (docs/04), so S-05 shows by its screen, not the URL: an MR
  // session's Summary is the stub screen until its milestone.
  await expect(
    page.getByRole('heading', { name: 'Summary', level: 1, exact: true }),
  ).toBeAttached();
  await expect(page.getByText('Step 8 / 8', { exact: true })).toBeHidden();
});
