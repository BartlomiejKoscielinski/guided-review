import { expect, test, type Page } from '@playwright/test';

// F-27.4 against the mock backend: S-11 shows the options as checkboxes in the region "Options"
// (Mark as draft off, Delete branch after merge on, Squash commits off), and Mark as draft turns
// the button in the aside "Reviewers and checks" from "Create merge request" into "Create draft
// MR". Locators the screen keeps: region "Options", checkboxes named by their text.

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

test('F-27.4 S-11 offers the three options with Delete branch after merge on', async ({ page }) => {
  await openNewMr(page);
  const options = page.getByRole('region', { name: 'Options' });
  const boxes = options.getByRole('checkbox');
  await expect(boxes).toHaveCount(3);
  await expect(boxes.nth(0)).toHaveAccessibleName('Mark as draft');
  await expect(boxes.nth(1)).toHaveAccessibleName('Delete branch after merge');
  await expect(boxes.nth(2)).toHaveAccessibleName('Squash commits');
  await expect(boxes.nth(0)).not.toBeChecked();
  await expect(boxes.nth(1)).toBeChecked();
  await expect(boxes.nth(2)).not.toBeChecked();
});

test('F-27.4 Mark as draft switches the button to Create draft MR and back', async ({ page }) => {
  await openNewMr(page);
  const aside = page.getByRole('complementary', { name: 'Reviewers and checks' });
  const draft = page.getByRole('region', { name: 'Options' }).getByRole('checkbox', {
    name: 'Mark as draft',
  });
  await expect(aside.getByRole('button', { name: 'Create merge request' })).toBeVisible();
  await draft.click();
  await expect(draft).toBeChecked();
  await expect(aside.getByRole('button', { name: 'Create draft MR' })).toBeVisible();
  await expect(aside.getByRole('button', { name: 'Create merge request' })).toHaveCount(0);
  await draft.click();
  await expect(aside.getByRole('button', { name: 'Create merge request' })).toBeVisible();
});

test('F-27.4 Delete branch after merge and Squash commits toggle without touching the button', async ({
  page,
}) => {
  await openNewMr(page);
  const options = page.getByRole('region', { name: 'Options' });
  const aside = page.getByRole('complementary', { name: 'Reviewers and checks' });
  await options.getByRole('checkbox', { name: 'Squash commits' }).click();
  await options.getByRole('checkbox', { name: 'Delete branch after merge' }).click();
  await expect(options.getByRole('checkbox', { name: 'Squash commits' })).toBeChecked();
  await expect(
    options.getByRole('checkbox', { name: 'Delete branch after merge' }),
  ).not.toBeChecked();
  await expect(options.getByRole('checkbox', { name: 'Mark as draft' })).not.toBeChecked();
  await expect(aside.getByRole('button', { name: 'Create merge request' })).toBeVisible();
});
