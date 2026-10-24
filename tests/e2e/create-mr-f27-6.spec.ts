import { expect, test, type Page } from '@playwright/test';

// F-27.6 against the mock backend: Create merge request on S-11 makes !483 (the mock's
// CreateMR.dc.html), the aside notes who gets notified, and the success view shows the green block
// "Merge request created" / "!483", the pipeline link "#18361 running" (to S-08), "Reviewers
// notified", and the actions Go to your MR (S-10 of !483, which the mock knows once it is created),
// Copy link and Open in GitLab. Locators the screen keeps: region "Merge request created"; the
// link named /#18361 running/ with href /mr/483/pipeline; the link "Go to your MR"; the buttons
// "Copy link" and "Open in GitLab"; the aside "Reviewers and checks" with the button "Create
// merge request" / "Create draft MR" and the note as one text element.

async function openNewMr(page: Page) {
  await page.addInitScript(() => {
    localStorage.setItem('guided-review.mock.changes', JSON.stringify({}));
    localStorage.setItem(
      'guided-review.mock.settings',
      JSON.stringify({ ui: { lastRoute: { screen: 'S-06' } } }),
    );
  });
  await page.goto('/');
  await page.getByLabel('Message').fill('Subject');
  await page.getByRole('button', { name: /^Commit · / }).click();
  await page.getByRole('status').getByRole('button', { name: 'Push and create MR' }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'New merge request' })).toBeVisible();
}

const aside = (page: Page) => page.getByRole('complementary', { name: 'Reviewers and checks' });
const created = (page: Page) => page.getByRole('region', { name: 'Merge request created' });

test('F-27.6 create and go to your MR', async ({ page }) => {
  await openNewMr(page);
  await expect(
    aside(page).getByText('No reviewers yet. A pipeline starts right away.'),
  ).toBeVisible();
  await page.getByRole('button', { name: 'Add Marta K.' }).click();
  await page.getByRole('button', { name: 'Add Ola M.' }).click();
  await expect(
    aside(page).getByText('Marta K. and Ola M. get notified. A pipeline starts right away.'),
  ).toBeVisible();

  await aside(page).getByRole('button', { name: 'Create merge request' }).click();

  const block = created(page);
  await expect(block).toBeVisible();
  await expect(block.getByText('!483')).toBeVisible();
  await expect(page.getByRole('heading', { level: 1, name: 'New merge request' })).toHaveCount(0);
  await expect(page.getByRole('textbox', { name: 'Title' })).toHaveCount(0);
  const pipeline = page.getByRole('link', { name: /#18361 running/ });
  await expect(pipeline).toHaveAttribute('href', '/mr/483/pipeline');
  const tile = page.getByText('Reviewers notified').locator('..');
  await expect(tile.getByText('Marta K., Ola M.')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Copy link' })).toBeVisible();

  await page.getByRole('button', { name: 'Open in GitLab' }).click();
  await expect(page.getByRole('alert')).toHaveCount(0);

  await page.getByRole('link', { name: 'Go to your MR' }).click();
  const bar = page.getByTestId('title-bar');
  await expect(bar.getByText('You’re the author')).toBeVisible();
  await expect(bar.getByText('!483')).toBeVisible();
});

test('F-27.6 a draft MR is created with Draft: in front of its title', async ({ page }) => {
  await openNewMr(page);
  await page
    .getByRole('region', { name: 'Options' })
    .getByRole('checkbox', {
      name: 'Mark as draft',
    })
    .click();
  await aside(page).getByRole('button', { name: 'Create draft MR' }).click();
  const block = created(page);
  await expect(block).toBeVisible();
  await expect(block.getByText('!483')).toBeVisible();
  await expect(block.getByText(/^Draft: /)).toBeVisible();
  await expect(page.getByText('nobody yet')).toBeVisible();
});
