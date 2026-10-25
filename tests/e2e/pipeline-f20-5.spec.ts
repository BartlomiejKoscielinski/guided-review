import { expect, test, type Page } from '@playwright/test';

// F-20.5: S-08's job details and log against the mock backend (Pipeline.dc.html, M6 decision 10).
// #18321 (Failed) opens on its failed job unit-tests; a new pipeline (#18351, Run new pipeline)
// has running build jobs whose log is still growing.
//
// Locators the screen keeps (also locked in src/screens/pipeline/JobDetails.test.tsx): the region
// "Job details" with data-testid="job-status", the buttons "Retry job" / "Cancel job" / "Full
// log" (exact names); role=log named "Job log" whose lines carry data-kind="command|pass|error|
// plain"; role=status "Running. The log streams on the left."; the job select buttons
// "<job>, <Label>" of F-20.2. Live polling, the browser opening and the colors on the real WebView
// are not tried in the real app (no /app in autopilot).

const source = (page: Page) => page.getByLabel(/Paste a merge request link/);
const tab = (page: Page, number: string) =>
  page
    .getByRole('tablist', { name: 'Pipelines for this MR' })
    .getByRole('tab', { name: new RegExp(number) });
const details = (page: Page) => page.getByRole('region', { name: 'Job details' });
const log = (page: Page) => page.getByRole('log', { name: 'Job log' });

/** S-01 › !482 › S-02, then the pipeline link of its meta line › S-08. */
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

test('F-20.5 a failed job shows its details and a log with colored command and error lines', async ({
  page,
}) => {
  await openPipeline(page);
  await tab(page, '#18321').click();
  await expect(page.getByTestId('pipeline-status')).toHaveText('Failed');

  await expect(details(page).getByTestId('job-status')).toHaveText('Failed');
  await expect(details(page)).toContainText('unit-tests');
  await expect(details(page)).toContainText(/test stage · 1:52/i);
  await expect(details(page).getByRole('button', { name: 'Retry job', exact: true })).toBeEnabled();
  await expect(details(page).getByRole('button', { name: 'Cancel job', exact: true })).toHaveCount(
    0,
  );
  await expect(details(page).getByRole('button', { name: 'Full log', exact: true })).toBeEnabled();

  const lines = log(page).locator('[data-kind]');
  await expect(lines).toHaveCount(7);
  await expect(lines.first()).toHaveText('$ dotnet test tests/App.Tests -c Release --logger junit');
  await expect(lines.first()).toHaveAttribute('data-kind', 'command');
  await expect(lines.last()).toHaveText('ERROR: Job failed: exit code 1');
  await expect(lines.last()).toHaveAttribute('data-kind', 'error');
  await expect(log(page).locator('[data-kind="error"]')).toHaveCount(5);
  await expect(log(page).locator('[data-kind="plain"]')).toHaveCount(1);
});

test('F-20.5 picking another job swaps the details and the log', async ({ page }) => {
  await openPipeline(page);
  await tab(page, '#18321').click();
  await expect(details(page).getByTestId('job-status')).toHaveText('Failed');

  await page.getByRole('button', { name: 'restore, Passed', exact: true }).click();

  await expect(details(page).getByTestId('job-status')).toHaveText('Passed');
  await expect(details(page)).toContainText('restore');
  await expect(details(page)).toContainText(/build stage · 0:48/i);
  await expect(details(page).getByRole('button', { name: 'Retry job', exact: true })).toHaveCount(
    0,
  );
  await expect(log(page).locator('[data-kind="pass"]').last()).toHaveText('Job succeeded');
  await expect(log(page).locator('[data-kind="error"]')).toHaveCount(0);
});

test('F-20.5 the log streams while running', async ({ page }) => {
  await openPipeline(page);
  await page.getByRole('button', { name: 'Run new pipeline', exact: true }).click();
  await page
    .getByRole('alertdialog', { name: 'Run new pipeline' })
    .getByRole('button', { name: 'Run pipeline', exact: true })
    .click();
  await expect(tab(page, '#18351')).toHaveAttribute('aria-selected', 'true');

  await page.getByRole('button', { name: 'build:android, Running', exact: true }).click();

  await expect(details(page).getByTestId('job-status')).toHaveText('Running');
  await expect(
    details(page).getByRole('button', { name: 'Cancel job', exact: true }),
  ).toBeEnabled();
  await expect(details(page).getByRole('status')).toHaveText(
    'Running. The log streams on the left.',
  );
  const lines = log(page).locator('[data-kind]');
  await expect(lines).toHaveCount(2);
  await expect(lines.first()).toHaveText('$ dotnet build src/App -c Release -f net9.0-android');
  await expect(lines.first()).toHaveAttribute('data-kind', 'command');
  // A third line arrives on its own; the first two stay.
  await expect(lines).toHaveCount(3, { timeout: 10_000 });
  await expect(lines.last()).toHaveText('Build succeeded. 0 Warning(s) 0 Error(s)');
  await expect(lines.last()).toHaveAttribute('data-kind', 'pass');
  await expect(lines.first()).toHaveText('$ dotnet build src/App -c Release -f net9.0-android');
});
