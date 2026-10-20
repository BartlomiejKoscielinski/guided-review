import { expect, test, type Page } from '@playwright/test';

// F-20.8: artifacts on S-08 against the mock backend (Pipeline.dc.html, M6 decision 13). In
// #18342, build:android lists "app-release.apk" 48 MB and unit-tests "report.xml" 212 KB, each
// with a "Download" button; sonar passed without files and says "No artifacts."; the failed
// allowed job ui-tests:android shows no Artifacts section.
//
// Locators the screen keeps (also locked in src/screens/pipeline/JobArtifacts.test.tsx): the
// region "Job details"; the text "Artifacts"; one listitem per artifact with its name, size and a
// button named exactly "Download"; the text "No artifacts.".

const source = (page: Page) => page.getByLabel(/Paste a merge request link/);
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

test('F-20.8 successful jobs list artifacts with Download', async ({ page }) => {
  await openPipeline(page);

  await page.getByRole('button', { name: 'build:android, Passed', exact: true }).click();
  await expect(details(page).getByText('Artifacts', { exact: true })).toBeVisible();
  const apk = details(page).getByRole('listitem').filter({ hasText: 'app-release.apk' });
  await expect(apk).toContainText('48 MB');
  await expect(apk.getByRole('button', { name: 'Download', exact: true })).toBeVisible();

  await page.getByRole('button', { name: 'unit-tests, Passed', exact: true }).click();
  const report = details(page).getByRole('listitem').filter({ hasText: 'report.xml' });
  await expect(report).toContainText('212 KB');
  await expect(report.getByRole('button', { name: 'Download', exact: true })).toBeVisible();

  await page.getByRole('button', { name: 'sonar, Passed', exact: true }).click();
  await expect(details(page).getByText('No artifacts.')).toBeVisible();

  await page
    .getByRole('button', { name: 'ui-tests:android, Failed · allowed', exact: true })
    .click();
  await expect(details(page).getByText('Artifacts', { exact: true })).toHaveCount(0);
});
