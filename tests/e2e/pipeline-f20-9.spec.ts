import { expect, test, type Page } from '@playwright/test';

// F-20.9: "Retried: failed again on the same test." on S-08 against the mock backend
// (Pipeline.dc.html, M6 decision 15). In #18342 the failed allowed job ui-tests:android failed
// again on the same test after its retry, so its panel shows the line in "Why it failed"; a
// passed job has no such section at all.
//
// Locators the screen keeps (also locked in src/screens/pipeline/JobRetried.test.tsx): the region
// "Job details" and the status text "Retried: failed again on the same test.".

const COPY = 'Retried: failed again on the same test.';
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

test('F-20.9 a job that failed again on the same test says so in Why it failed', async ({
  page,
}) => {
  await openPipeline(page);

  await page
    .getByRole('button', { name: 'ui-tests:android, Failed · allowed', exact: true })
    .click();
  await expect(details(page).getByText('Why it failed')).toBeVisible();
  await expect(details(page).getByText(COPY)).toBeVisible();
  await expect(details(page).getByText(COPY)).toHaveAttribute('role', 'status');

  await page.getByRole('button', { name: 'unit-tests, Passed', exact: true }).click();
  await expect(details(page).getByText(COPY)).toHaveCount(0);
});
