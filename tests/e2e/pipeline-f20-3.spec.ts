import { expect, test, type Page } from '@playwright/test';

// F-20.3: S-08 "Run new pipeline" against the mock backend (Pipeline.dc.html, M6 decisions 7, 8
// and 9). !482 has #18342 (version 3, a3f9c12), #18321 and #18320; running a new pipeline adds
// #18351 (version 3, started by you, just now) as the latest tab.
//
// Locators the screen keeps (also locked in src/screens/pipeline/RunPipelineConfirm.test.tsx):
// the header button "Run new pipeline"; the strip as role="alertdialog" named "Run new pipeline"
// with the buttons "Run pipeline" and "Cancel"; the tabs of F-20.1 (role=tab "#18351");
// data-testid="pipeline-status" / "pipeline-meta"; the job select buttons "<job>, <Label>" of
// F-20.2. Not tried in the real app (no /app in autopilot).

const source = (page: Page) => page.getByLabel(/Paste a merge request link/);
const tab = (page: Page, number: string) =>
  page
    .getByRole('tablist', { name: 'Pipelines for this MR' })
    .getByRole('tab', { name: new RegExp(number) });
const runNew = (page: Page) => page.getByRole('button', { name: 'Run new pipeline', exact: true });
const strip = (page: Page) => page.getByRole('alertdialog', { name: 'Run new pipeline' });

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

test('F-20.3 Run new pipeline asks first: the strip names the commit and the two promises, and Cancel starts nothing', async ({
  page,
}) => {
  await openPipeline(page);
  await expect(strip(page)).toHaveCount(0);

  await runNew(page).click();

  await expect(strip(page)).toBeVisible();
  await expect(strip(page)).toContainText('Run a new merge request pipeline on a3f9c12?');
  await expect(strip(page)).toContainText(/Uses the MR['’]s latest commit\./);
  await expect(strip(page)).toContainText('Manual jobs stay manual.');
  await expect(
    strip(page).getByRole('button', { name: 'Run pipeline', exact: true }),
  ).toBeEnabled();
  await expect(strip(page).getByRole('button', { name: 'Cancel', exact: true })).toBeFocused();

  await strip(page).getByRole('button', { name: 'Cancel', exact: true }).click();

  await expect(strip(page)).toHaveCount(0);
  await expect(page.getByRole('tab')).toHaveCount(3);
  await expect(tab(page, '#18351')).toHaveCount(0);
  await expect(page.getByTestId('pipeline-status')).toHaveText('Passed');
  await expect(runNew(page)).toBeFocused();
});

test('F-20.3 Escape closes the strip and starts nothing', async ({ page }) => {
  await openPipeline(page);
  await runNew(page).click();
  await expect(strip(page)).toBeVisible();
  await expect(strip(page).getByRole('button', { name: 'Cancel', exact: true })).toBeFocused();

  await page.keyboard.press('Escape');

  await expect(strip(page)).toHaveCount(0);
  await expect(page.getByRole('tab')).toHaveCount(3);
});

test('F-20.3 run a new pipeline: confirm, and the new pipeline is the selected, latest tab, running, started by you just now', async ({
  page,
}) => {
  await openPipeline(page);
  await expect(page.getByTestId('pipeline-meta')).toContainText('Marta K.');

  await runNew(page).click();
  await strip(page).getByRole('button', { name: 'Run pipeline', exact: true }).click();

  await expect(strip(page)).toHaveCount(0);
  await expect(page.getByRole('tab')).toHaveCount(4);
  await expect(tab(page, '#18351')).toHaveAttribute('aria-selected', 'true');
  await expect(tab(page, '#18351')).toContainText('version 3 · latest');
  await expect(tab(page, '#18342')).toHaveAttribute('aria-selected', 'false');
  await expect(tab(page, '#18342')).not.toContainText('latest');
  await expect(page.getByTestId('pipeline-status')).toHaveText('Running');
  const meta = page.getByTestId('pipeline-meta');
  await expect(meta).toContainText('#18351');
  await expect(meta).toContainText('a3f9c12');
  await expect(meta).toContainText('version 3 · started by you · just now');
  // The jobs of the new pipeline: the build stage runs, the manual jobs stay manual.
  await expect(
    page.getByRole('button', { name: 'build:android, Running', exact: true }),
  ).toBeVisible();
  await expect(page.getByRole('button', { name: 'sonar, Waiting', exact: true })).toBeVisible();
  await expect(
    page.getByRole('button', { name: 'distribute:qa, Manual', exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole('button', { name: 'ui-tests:ios-device, Manual', exact: true }),
  ).toBeVisible();
  await expect(runNew(page)).toBeEnabled();
  await expect(page.getByRole('alert')).toHaveCount(0);

  // The older pipelines are still there, one click away.
  await tab(page, '#18321').click();
  await expect(page.getByTestId('pipeline-status')).toHaveText('Failed');
});
