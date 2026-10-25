import { expect, test, type Page } from '@playwright/test';

// F-27.3 against the mock backend: S-11 suggests Marta K., Ola M. and Piotr S. with the reasons of
// CreateMR.dc.html, Add / Added toggles, and the field "Add another reviewer" finds others
// (debounced) and adds them as "Added by you". Locators the screen keeps: region "Reviewers",
// list "Reviewer list" (listitems with the name, the reason and a button "Add <name>" /
// "Remove <name>" whose text is Add / Added), textbox "Add another reviewer", list "Search
// results". Nobody is added at the start.

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

test('F-27.3 S-11 suggests Marta K., Ola M. and Piotr S. with their reasons, nobody added yet', async ({
  page,
}) => {
  await openNewMr(page);
  const reviewers = page.getByRole('region', { name: 'Reviewers' });
  await expect(reviewers.getByRole('heading', { level: 2, name: 'Reviewers' })).toBeVisible();
  await expect(reviewers.getByText('from CODEOWNERS and blame')).toBeVisible();
  const rows = reviewers.getByRole('list', { name: 'Reviewer list' }).getByRole('listitem');
  await expect(rows).toHaveCount(3);
  await expect(rows.nth(0)).toContainText('Marta K.');
  await expect(rows.nth(0)).toContainText('Code owner of src/App/Views/');
  await expect(rows.nth(1)).toContainText('Ola M.');
  await expect(rows.nth(1)).toContainText('Wrote 58% of the changed lines');
  await expect(rows.nth(2)).toContainText('Piotr S.');
  await expect(rows.nth(2)).toContainText('Reviewed 4 MRs in Views this month');
  await expect(reviewers.getByRole('button', { name: /^Add / })).toHaveCount(3);
  await expect(reviewers.getByText('Added', { exact: true })).toHaveCount(0);
  await expect(reviewers.getByRole('textbox', { name: 'Add another reviewer' })).toHaveAttribute(
    'placeholder',
    'Add someone else…',
  );
});

test('F-27.3 Add turns into Added and back', async ({ page }) => {
  await openNewMr(page);
  const reviewers = page.getByRole('region', { name: 'Reviewers' });
  await reviewers.getByRole('button', { name: 'Add Marta K.' }).click();
  const marta = reviewers.getByRole('button', { name: 'Remove Marta K.' });
  await expect(marta).toHaveText('Added');
  await expect(marta).toHaveAttribute('aria-pressed', 'true');
  await expect(reviewers.getByRole('button', { name: 'Add Ola M.' })).toHaveText('Add');
  await marta.click();
  await expect(reviewers.getByRole('button', { name: 'Add Marta K.' })).toHaveText('Add');
  await expect(reviewers.getByText('Added', { exact: true })).toHaveCount(0);
});

test('F-27.3 the search adds somebody else as Added by you and Remove takes them out', async ({
  page,
}) => {
  await openNewMr(page);
  const reviewers = page.getByRole('region', { name: 'Reviewers' });
  const box = reviewers.getByRole('textbox', { name: 'Add another reviewer' });
  await box.fill('ann');
  const results = reviewers.getByRole('list', { name: 'Search results' });
  await expect(results.getByRole('listitem')).toHaveCount(1);
  await results.getByRole('button', { name: 'Add Anna K.' }).click();
  await expect(results).toHaveCount(0);
  await expect(box).toHaveValue('');
  const list = reviewers.getByRole('list', { name: 'Reviewer list' });
  await expect(list.getByRole('listitem')).toHaveCount(4);
  await expect(list.getByText('Added by you')).toBeVisible();
  await list.getByRole('button', { name: 'Remove Anna K.' }).click();
  await expect(list.getByRole('listitem')).toHaveCount(3);
  await box.fill('zzz');
  await expect(reviewers.getByText('No one found.')).toBeVisible();
});
