import { expect, test, type Page } from '@playwright/test';

// F-20.4: S-08's pipeline actions against the mock backend (Pipeline.dc.html, M6 decisions 6 and
// 13). !482 has #18342 (Passed, 1 allowed failure), #18321 (Failed: unit-tests) and #18320
// (Canceled). Retry failed jobs and Cancel pipeline act at once; the mock changes the pipeline,
// its tab status and its jobs; Open in GitLab is a button (the core opens the browser), not a link.
//
// Locators the screen keeps (also locked in src/screens/pipeline/PipelineActions.test.tsx): the
// buttons "Retry failed jobs", "Cancel pipeline", "Open in GitLab" and "Run new pipeline" (exact
// names, in that order in the head); data-testid="pipeline-status"; the job select buttons
// "<job>, <Label>" of F-20.2; the strip role="alertdialog" named "Run new pipeline" with "Run
// pipeline". The 403 state and the live Open in GitLab need the real core: not tried in the real
// app (no /app in autopilot).

const source = (page: Page) => page.getByLabel(/Paste a merge request link/);
const button = (page: Page, name: string) => page.getByRole('button', { name, exact: true });
const tab = (page: Page, number: string) =>
  page
    .getByRole('tablist', { name: 'Pipelines for this MR' })
    .getByRole('tab', { name: new RegExp(number) });

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

test('F-20.4 the head of a passed pipeline offers Retry failed jobs, Open in GitLab and Run new pipeline in that order, and no Cancel pipeline', async ({
  page,
}) => {
  await openPipeline(page);

  const buttons = page
    .locator('section')
    .filter({ has: page.getByRole('heading', { level: 1, name: 'Pipeline' }) })
    .getByRole('button');
  await expect(buttons).toHaveText([
    /^Retry failed jobs$/,
    /^Open in GitLab$/,
    /^Run new pipeline$/,
  ]);
  await expect(button(page, 'Cancel pipeline')).toHaveCount(0);
  await expect(button(page, 'Open in GitLab')).toBeEnabled();
  await expect(page.getByRole('link', { name: 'Open in GitLab' })).toHaveCount(0);
});

test('F-20.4 Open in GitLab stays on the screen and shows no failure', async ({ page }) => {
  await openPipeline(page);
  const url = page.url();

  await button(page, 'Open in GitLab').click();

  await expect(page.getByRole('alert')).toHaveCount(0);
  await expect(page.getByTestId('pipeline-status')).toHaveText('Passed');
  expect(page.url()).toBe(url);
});

test('F-20.4 Retry failed jobs on the failed #18321 restarts its failed job at once: the pipeline reads Running and offers Cancel pipeline instead', async ({
  page,
}) => {
  await openPipeline(page);
  await tab(page, '#18321').click();
  await expect(page.getByTestId('pipeline-status')).toHaveText('Failed');
  await expect(button(page, 'unit-tests, Failed')).toBeVisible();

  await button(page, 'Retry failed jobs').click();

  await expect(page.getByRole('alertdialog')).toHaveCount(0);
  await expect(page.getByTestId('pipeline-status')).toHaveText('Running');
  await expect(button(page, 'unit-tests, Running')).toBeVisible();
  await expect(button(page, 'Cancel pipeline')).toBeEnabled();
  await expect(button(page, 'Retry failed jobs')).toHaveCount(0);
  await expect(button(page, 'sonar, Skipped')).toBeVisible();
  await expect(page.getByRole('alert')).toHaveCount(0);
});

test('F-20.4 cancel a running pipeline: Run new pipeline, then Cancel pipeline cancels its running and waiting jobs, keeps the manual ones and offers Retry failed jobs', async ({
  page,
}) => {
  await openPipeline(page);
  await button(page, 'Run new pipeline').click();
  await page
    .getByRole('alertdialog', { name: 'Run new pipeline' })
    .getByRole('button', { name: 'Run pipeline', exact: true })
    .click();
  await expect(page.getByTestId('pipeline-status')).toHaveText('Running');
  await expect(button(page, 'build:android, Running')).toBeVisible();
  await expect(button(page, 'Retry failed jobs')).toHaveCount(0);

  await button(page, 'Cancel pipeline').click();

  await expect(page.getByRole('alertdialog')).toHaveCount(0);
  await expect(page.getByTestId('pipeline-status')).toHaveText('Canceled');
  await expect(button(page, 'build:android, Canceled')).toBeVisible();
  await expect(button(page, 'sonar, Canceled')).toBeVisible();
  await expect(button(page, 'distribute:qa, Manual')).toBeVisible();
  await expect(button(page, 'ui-tests:ios-device, Manual')).toBeVisible();
  await expect(button(page, 'Cancel pipeline')).toHaveCount(0);
  await expect(button(page, 'Retry failed jobs')).toBeEnabled();
  await expect(button(page, 'Open in GitLab')).toBeEnabled();
  await expect(page.getByRole('alert')).toHaveCount(0);
});
