import { expect, test, type Locator, type Page } from '@playwright/test';

// F-20.2: S-08 stage columns against the mock backend (Pipeline.dc.html, M6 decisions 5 and 6).
// !482's #18342 has four stages (build, test, quality, distribute) with nine jobs; #18321 failed
// at unit-tests; #18320 was canceled.
//
// Locators the screen keeps (also locked in src/screens/pipeline/StageColumns.test.tsx): one
// section region per stage named after the stage (any case) with data-testid="stage-count"; one
// data-testid="job-row" per job holding the select button "<job>, <Label>" (aria-pressed) with
// data-testid="job-square" (data-state) and data-testid="job-meta", and a separate action button
// "Retry <job>" / "Run <job>" / "Cancel <job>". Not tried in the real app (no /app in autopilot).

const source = (page: Page) => page.getByLabel(/Paste a merge request link/);
const tab = (page: Page, number: string) =>
  page
    .getByRole('tablist', { name: 'Pipelines for this MR' })
    .getByRole('tab', { name: new RegExp(number) });
const select = (page: Page, name: string, label?: string) =>
  label === undefined
    ? page.getByRole('button', {
        name: new RegExp(`^${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}, `),
      })
    : page.getByRole('button', { name: `${name}, ${label}`, exact: true });
const action = (page: Page, text: string) => page.getByRole('button', { name: text, exact: true });
const rowOf = (page: Page, name: string): Locator =>
  page.getByTestId('job-row').filter({ has: select(page, name) });

/** S-01 › !482 › S-02, then the pipeline link of its meta line › S-08. */
async function openPipeline(page: Page) {
  await page.goto('/');
  await expect(page.getByTestId('title-bar')).toBeVisible();
  await source(page).fill('!482');
  await expect(page.getByText('Merge request !482', { exact: true })).toBeVisible();
  await source(page).press('Enter');
  await page.getByRole('link', { name: /pipeline passed/i }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Pipeline' })).toBeAttached();
}

test('F-20.2 the newest pipeline shows its stages as columns with a status square, a name and a duration or state per job', async ({
  page,
}) => {
  await openPipeline(page);

  const stages = page.getByRole('region', { name: /^(build|test|quality|distribute)$/i });
  await expect(stages).toHaveCount(4);
  await expect(stages.nth(0).getByRole('heading', { level: 2 })).toHaveText(/^build$/i);
  await expect(stages.nth(0).getByTestId('stage-count')).toHaveText('3 jobs');
  await expect(stages.nth(1).getByTestId('stage-count')).toHaveText('3 jobs');
  await expect(stages.nth(2).getByTestId('stage-count')).toHaveText('2 jobs');
  await expect(stages.nth(3).getByTestId('stage-count')).toHaveText('1 job');
  await expect(stages.nth(3).getByRole('heading', { level: 2 })).toHaveText(/^distribute$/i);

  await expect(select(page, 'restore', 'Passed')).toBeVisible();
  await expect(rowOf(page, 'restore').getByTestId('job-meta')).toHaveText('0:48');
  await expect(rowOf(page, 'build:android').getByTestId('job-meta')).toHaveText('6:12');
  await expect(rowOf(page, 'build:ios').getByTestId('job-meta')).toHaveText('7:40');
  await expect(rowOf(page, 'ui-tests:android').getByTestId('job-meta')).toHaveText('3:05');
  await expect(rowOf(page, 'ui-tests:android').getByTestId('job-square')).toHaveAttribute(
    'data-state',
    'failedAllowed',
  );
  await expect(select(page, 'ui-tests:android', 'Failed · allowed')).toBeVisible();
  await expect(rowOf(page, 'ui-tests:ios-device').getByTestId('job-meta')).toHaveText('manual');
  await expect(rowOf(page, 'ui-tests:ios-device').getByTestId('job-square')).toHaveAttribute(
    'data-state',
    'manual',
  );
  await expect(rowOf(page, 'sonar').getByTestId('job-meta')).toHaveText('2:10');
  await expect(rowOf(page, 'distribute:qa').getByTestId('job-meta')).toHaveText('manual');
});

test('F-20.2 each row has at most one action button, separate from the select button: Retry, Run, none', async ({
  page,
}) => {
  await openPipeline(page);
  await expect(select(page, 'restore', 'Passed')).toBeVisible();

  await expect(rowOf(page, 'ui-tests:android').getByRole('button')).toHaveCount(2);
  await expect(action(page, 'Retry ui-tests:android')).toBeVisible();
  await expect(action(page, 'Run ui-tests:ios-device')).toBeVisible();
  await expect(action(page, 'Run distribute:qa')).toBeVisible();
  await expect(rowOf(page, 'restore').getByRole('button')).toHaveCount(1);
  await expect(rowOf(page, 'sonar').getByRole('button')).toHaveCount(1);
  await expect(page.getByRole('button', { name: /^Cancel / })).toHaveCount(0);
  // The action button is not inside the select button.
  await expect(select(page, 'ui-tests:android').getByRole('button')).toHaveCount(0);
});

test('F-20.2 the first job that did not pass is selected, and a click on a row selects it alone', async ({
  page,
}) => {
  await openPipeline(page);

  await expect(select(page, 'ui-tests:android')).toHaveAttribute('aria-pressed', 'true');
  await select(page, 'sonar').click();
  await expect(select(page, 'sonar')).toHaveAttribute('aria-pressed', 'true');
  await expect(select(page, 'ui-tests:android')).toHaveAttribute('aria-pressed', 'false');
});

test('F-20.2 retry a failed job: Retry acts at once, the row runs and offers Cancel; Cancel acts at once too', async ({
  page,
}) => {
  await openPipeline(page);
  await tab(page, '#18321').click();
  await expect(select(page, 'unit-tests', 'Failed')).toBeVisible();
  await expect(rowOf(page, 'sonar').getByTestId('job-meta')).toHaveText('skipped');

  await action(page, 'Retry unit-tests').click();

  // No confirmation: the job simply runs.
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(select(page, 'unit-tests', 'Running')).toBeVisible();
  await expect(rowOf(page, 'unit-tests').getByTestId('job-square')).toHaveAttribute(
    'data-state',
    'running',
  );
  await expect(rowOf(page, 'unit-tests').getByTestId('job-meta')).toHaveText('running');
  await expect(select(page, 'unit-tests')).toHaveAttribute('aria-pressed', 'true');
  await expect(action(page, 'Retry unit-tests')).toHaveCount(0);

  await action(page, 'Cancel unit-tests').click();

  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(select(page, 'unit-tests', 'Canceled')).toBeVisible();
  await expect(action(page, 'Retry unit-tests')).toBeVisible();
  await expect(action(page, 'Cancel unit-tests')).toHaveCount(0);
});

test('F-20.2 Run on a manual job only selects it: it stays manual and nothing is sent or confirmed', async ({
  page,
}) => {
  await openPipeline(page);
  await expect(select(page, 'distribute:qa', 'Manual')).toBeVisible();

  await action(page, 'Run distribute:qa').click();

  await expect(select(page, 'distribute:qa', 'Manual')).toHaveAttribute('aria-pressed', 'true');
  await expect(select(page, 'ui-tests:android')).toHaveAttribute('aria-pressed', 'false');
  await expect(action(page, 'Run distribute:qa')).toBeVisible();
  await expect(rowOf(page, 'distribute:qa').getByTestId('job-square')).toHaveAttribute(
    'data-state',
    'manual',
  );
  await expect(page.getByRole('dialog')).toHaveCount(0);
});

test('F-20.2 the canceled pipeline shows restore passed and every other job canceled with a Retry button', async ({
  page,
}) => {
  await openPipeline(page);

  await tab(page, '#18320').click();

  await expect(select(page, 'build:android', 'Canceled')).toBeVisible();
  await expect(select(page, 'restore', 'Passed')).toBeVisible();
  // The eight row Retries; the head's "Retry failed jobs" (F-20.4) is not a row button.
  await expect(page.getByRole('button', { name: /^Retry (?!failed jobs$)/ })).toHaveCount(8);
});
