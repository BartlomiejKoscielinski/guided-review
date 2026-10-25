import { expect, test, type Page } from '@playwright/test';

// F-20.7: Explain failure on S-08 against the mock backend (Pipeline.dc.html, M6 decision 14).
// The mock answers like the design mock's EX table: ui-tests:android of #18342 (allowed failure)
// is "Caused by this MR" with the chips DeliveryPhotoPage.xaml:14 and DeliveryPhotoPageTests.cs:41
// and a suggested comment; unit-tests of #18321 is "Already fixed in version 3" with the chips
// SqliteUploadQueue.cs:88 and `pipeline #18342` and no suggested comment.
//
// Locators the screen keeps (also locked in src/screens/pipeline/ExplainFailure.test.tsx): the
// region "Job details"; the text "Why it failed"; the button "Explain failure"; data-testid=
// "explain-verdict"; the evidence `pipeline #N` as a button named exactly that; the buttons "Add
// to drafts" and the confirmation text "In drafts. Publish it with the rest from Summary.".
// The file:line chip opening the review session's step is not tried here (no session).

const source = (page: Page) => page.getByLabel(/Paste a merge request link/);
const tab = (page: Page, number: string) =>
  page
    .getByRole('tablist', { name: 'Pipelines for this MR' })
    .getByRole('tab', { name: new RegExp(number) });
const details = (page: Page) => page.getByRole('region', { name: 'Job details' });

async function openPipeline(page: Page) {
  await page.goto('/');
  await expect(page.getByTestId('title-bar')).toBeVisible();
  await source(page).fill('!482');
  await expect(page.getByText('Merge request !482', { exact: true })).toBeVisible();
  await source(page).press('Enter');
  await page.getByRole('link', { name: /pipeline passed/i }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Pipeline' })).toBeAttached();
  await expect(page.getByTestId('pipeline-status')).toHaveText('Passed');
}

test('F-20.7 explain failure and add to drafts', async ({ page }) => {
  await openPipeline(page);
  await page
    .getByRole('button', { name: 'ui-tests:android, Failed · allowed', exact: true })
    .click();

  await expect(details(page).getByText('Why it failed')).toBeVisible();
  await expect(
    details(page).getByText('Claude reads this log and the MR diff. Nothing is posted.'),
  ).toBeVisible();
  await details(page).getByRole('button', { name: 'Explain failure', exact: true }).click();

  await expect(details(page).getByTestId('explain-verdict')).toHaveText('Caused by this MR', {
    timeout: 10_000,
  });
  await expect(details(page).getByText('DeliveryPhotoPage.xaml:14')).toBeVisible();
  await expect(details(page).getByText('DeliveryPhotoPageTests.cs:41')).toBeVisible();
  await expect(details(page).getByText('Suggested comment')).toBeVisible();
  await expect(
    details(page).getByText(/ui-tests:android fails because the banner’s AutomationId changed/),
  ).toBeVisible();

  await details(page).getByRole('button', { name: 'Add to drafts', exact: true }).click();
  await expect(
    details(page).getByText('In drafts. Publish it with the rest from Summary.'),
  ).toBeVisible();
  await expect(details(page).getByRole('button', { name: 'Add to drafts' })).toHaveCount(0);
});

test('F-20.7 an older failed run: already fixed in version 3, no comment, the pipeline chip selects its tab', async ({
  page,
}) => {
  await openPipeline(page);
  await tab(page, '#18321').click();
  await expect(page.getByTestId('pipeline-status')).toHaveText('Failed');
  await expect(details(page).getByRole('button', { name: 'Explain failure' })).toBeVisible();

  await details(page).getByRole('button', { name: 'Explain failure', exact: true }).click();

  await expect(details(page).getByTestId('explain-verdict')).toHaveText(
    'Already fixed in version 3',
    { timeout: 10_000 },
  );
  await expect(details(page).getByText('SqliteUploadQueue.cs:88')).toBeVisible();
  await expect(details(page).getByText('Suggested comment')).toHaveCount(0);
  await expect(details(page).getByRole('button', { name: 'Add to drafts' })).toHaveCount(0);

  await details(page).getByRole('button', { name: 'pipeline #18342', exact: true }).click();
  await expect(tab(page, '#18342')).toHaveAttribute('aria-selected', 'true');
});

test('F-20.7 a passed job has no Explain failure', async ({ page }) => {
  await openPipeline(page);
  await page.getByRole('button', { name: 'restore, Passed', exact: true }).click();
  await expect(details(page).getByTestId('job-status')).toHaveText('Passed');
  await expect(details(page).getByRole('button', { name: 'Explain failure' })).toHaveCount(0);
  await expect(details(page).getByText('Why it failed')).toHaveCount(0);
});
