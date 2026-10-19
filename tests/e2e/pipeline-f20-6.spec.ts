import { expect, test, type Page } from '@playwright/test';

// F-20.6: S-08's manual-job form against the mock backend (Pipeline.dc.html, M6 decision 11).
// !482's #18342 has two manual jobs, ui-tests:ios-device and distribute:qa. Selecting one shows
// "Variables for this run" (empty at first), "+ Add variable", the button "Run <job>" and "Runs on
// a3f9c12 as you."; only that button plays the job; the values that ran are the form's values the
// next time a job of that name is opened (here in the new pipeline #18351 from Run new pipeline).
//
// Locators the screen keeps (also locked in src/screens/pipeline/ManualJobForm.test.tsx): the
// region "Job details"; inputs labelled "Variable name" / "Variable value"; the buttons "+ Add
// variable" and "Run <job>" inside that region (the row's own button "Run <job>" only selects);
// the select buttons "<job>, <Label>" of F-20.2. The live play and the 403 state need the real
// core: not tried in the real app (no /app in autopilot).

const source = (page: Page) => page.getByLabel(/Paste a merge request link/);
const button = (page: Page, name: string) => page.getByRole('button', { name, exact: true });
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

test('F-20.6 play a manual job with a variable: the row Run only selects, Run <job> plays, and the next pipeline remembers the values', async ({
  page,
}) => {
  await openPipeline(page);

  // The row's own button selects and plays nothing.
  await button(page, 'Run distribute:qa').click();
  await expect(details(page).getByText('Variables for this run')).toBeVisible();
  await expect(button(page, 'distribute:qa, Manual')).toBeVisible();
  await expect(details(page).getByLabel('Variable name')).toHaveCount(0);
  await expect(details(page)).toContainText('Runs on a3f9c12 as you.');

  // An invalid name blocks Run.
  await details(page).getByRole('button', { name: '+ Add variable' }).click();
  await details(page).getByLabel('Variable name').fill('bad name');
  await details(page).getByLabel('Variable value').fill('x');
  await expect(details(page).getByText('Letters, digits and _ only.')).toBeVisible();
  await expect(details(page).getByRole('button', { name: 'Run distribute:qa' })).toBeDisabled();
  await details(page).getByLabel('Variable name').fill('RELEASE_NOTES');
  await details(page).getByLabel('Variable value').fill('MR !482 · offline queue');

  await details(page).getByRole('button', { name: 'Run distribute:qa' }).click();

  await expect(button(page, 'distribute:qa, Waiting')).toBeVisible();
  await expect(button(page, 'ui-tests:ios-device, Manual')).toBeVisible();
  await expect(page.getByRole('alert')).toHaveCount(0);

  // The new pipeline has distribute:qa as a manual job again: the form holds the last values.
  await button(page, 'Run new pipeline').click();
  await page
    .getByRole('alertdialog', { name: 'Run new pipeline' })
    .getByRole('button', { name: 'Run pipeline', exact: true })
    .click();
  await expect(page.getByTestId('pipeline-status')).toHaveText('Running');
  await button(page, 'distribute:qa, Manual').click();
  await expect(details(page).getByLabel('Variable name')).toHaveValue('RELEASE_NOTES');
  await expect(details(page).getByLabel('Variable value')).toHaveValue('MR !482 · offline queue');

  // Another job name starts empty.
  await button(page, 'ui-tests:ios-device, Manual').click();
  await expect(details(page).getByText('Variables for this run')).toBeVisible();
  await expect(details(page).getByLabel('Variable name')).toHaveCount(0);
});
