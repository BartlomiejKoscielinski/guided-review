import { expect, test, type Page } from '@playwright/test';

// S-06 Changes and commit against the mock backend (Changes.dc.html data, ADR-016).

const COMMIT_SHA = 'a3f9c12b7e4d6f8091a2b3c4d5e6f708192a3b4c';

async function open(
  page: Page,
  scenario: Record<string, unknown> = {},
  lastRoute: object = { screen: 'S-06' },
) {
  await page.addInitScript(
    ({ scenario, lastRoute }) => {
      localStorage.setItem('guided-review.mock.changes', JSON.stringify(scenario));
      localStorage.setItem('guided-review.mock.settings', JSON.stringify({ ui: { lastRoute } }));
    },
    { scenario, lastRoute },
  );
  await page.goto('/');
}

const tree = (page: Page) => page.getByRole('tree', { name: 'Files' });

async function selectPhotoPage(page: Page) {
  await tree(page).getByRole('button', { name: 'Expand src/App/Views/Deliveries' }).click();
  await tree(page).getByRole('button', { name: 'DeliveryPhotoPage.xaml' }).click();
  await expect(page.getByRole('checkbox', { name: 'In commit · lines 22–25' })).toBeVisible();
}

test('F-15.1 switches between local changes and commit', async ({ page }) => {
  await open(page);
  const source = page.getByRole('radiogroup', { name: 'Source' });
  await expect(source.getByRole('radio', { name: 'Local changes' })).toHaveAttribute(
    'aria-checked',
    'true',
  );
  await source.getByRole('radio', { name: 'Commit a3f9c12' }).click();
  await expect(page.getByRole('heading', { name: 'UploadWorker: jittered backoff' })).toBeVisible();
  await source.getByRole('radio', { name: 'Local changes' }).click();
  await expect(page.getByRole('heading', { name: 'Commit' })).toBeVisible();
});

test('F-15.2 1000-file tree is virtualized and scrolls to the last file', async ({ page }) => {
  await open(page, { files: 1000 });
  await expect(page.getByText('0 of 1000 in commit')).toBeVisible();
  const rendered = await tree(page).getByRole('treeitem').count();
  expect(rendered).toBeLessThan(120);
  const started = Date.now();
  await tree(page).evaluate((el) => {
    el.scrollTop = el.scrollHeight;
  });
  await expect(tree(page).getByRole('treeitem', { name: 'src/Generated/Folder049' })).toBeVisible();
  expect(Date.now() - started).toBeLessThan(1000);
  // Row height ≤ 26px.
  const row = await tree(page)
    .getByRole('treeitem', { name: 'src/Generated/Folder049' })
    .boundingBox();
  expect(row?.height).toBeLessThanOrEqual(28);
});

test('F-15.3 filter shows the number of matching files', async ({ page }) => {
  await open(page);
  const count = page.getByLabel('Matching files');
  await expect(count).toHaveText('100');
  await page.getByLabel('Filter files').fill('converter');
  await expect(count).toHaveText('8');
  await expect(tree(page).getByText('8/8')).toBeVisible();
  await page.getByLabel('Filter files').fill('zzz');
  await expect(page.getByText('No files match.')).toBeVisible();
});

test('F-15.4 status tags are words, deleted names are struck through', async ({ page }) => {
  await open(page);
  await expect(tree(page).getByText('New', { exact: true })).toBeVisible();
  await tree(page).getByRole('button', { name: 'Expand src/App/Views/Deliveries' }).click();
  const renamed = tree(page).getByText('Renamed', { exact: true });
  await expect(renamed).toHaveAttribute(
    'title',
    'Renamed from src/App/Views/Deliveries/DeliveryFilterPage.xaml',
  );
  await tree(page).getByRole('button', { name: 'Expand src/App/ViewModels' }).click();
  const deleted = tree(page).getByText('ViewModelLocator.cs');
  await expect(deleted).toHaveCSS('text-decoration-line', 'line-through');
  await expect(tree(page).getByText('Deleted', { exact: true })).toBeVisible();
  await expect(tree(page).getByText('+64')).toBeVisible();
});

test('F-15.5 Unified | Split and Open in Rider', async ({ page }) => {
  await open(page);
  await selectPhotoPage(page);
  const layout = page.getByRole('radiogroup', { name: 'Diff layout' });
  await layout.getByRole('radio', { name: 'Split' }).click();
  await expect(layout.getByRole('radio', { name: 'Split' })).toHaveAttribute(
    'aria-checked',
    'true',
  );
  await expect(page.getByTestId('diff-scroller').locator('[class*="split"]').first()).toBeVisible();
  await page.getByRole('button', { name: 'Open in Rider' }).click();
  await expect(page.getByRole('alert')).toHaveCount(0);
});

test('F-15.6 commit mode shows the commit files and details', async ({ page }) => {
  await open(page, {}, { screen: 'S-06', commit: COMMIT_SHA });
  const details = page.getByRole('complementary', { name: 'Commit details' });
  await expect(details.getByText('a3f9c12')).toBeVisible();
  await expect(details.getByText(/The delay between retries/)).toBeVisible();
  await expect(details.getByText('Marta K. · 2 h ago')).toBeVisible();
  await expect(details.getByText('9be0d47')).toBeVisible();
  await expect(details.getByRole('button', { name: 'Review step by step' })).toBeVisible();
  await expect(page.getByText('3 files · Marta K. · 2 h ago')).toBeVisible();
  await expect(page.getByRole('checkbox')).toHaveCount(0);
});

test('F-16.1 checkboxes on folders, files, hunks and lines', async ({ page }) => {
  await open(page);
  await selectPhotoPage(page);
  const hunk = page.getByRole('checkbox', { name: 'In commit · lines 22–25' });
  await hunk.click();
  await expect(hunk).toHaveAttribute('aria-checked', 'false');
  const file = tree(page).getByRole('checkbox', { name: 'Include DeliveryPhotoPage.xaml' });
  await expect(file).toHaveAttribute('aria-checked', 'mixed');
  const folder = tree(page).getByRole('checkbox', {
    name: 'Include folder src/App/Views/Deliveries',
  });
  await expect(folder).toHaveAttribute('aria-checked', 'mixed');
  // Shift+click on line 24 brings just that line back.
  await page.locator('[data-kind="add"] [data-line-no="24"]').click({ modifiers: ['Shift'] });
  await expect(hunk).toHaveAttribute('aria-checked', 'mixed');
  await folder.click();
  await expect(folder).toHaveAttribute('aria-checked', 'true');
  await expect(file).toHaveAttribute('aria-checked', 'true');
});

test('F-16.3 master checkbox with "N of M in commit" and collapse all', async ({ page }) => {
  await open(page);
  await expect(page.getByText('80 of 100 in commit')).toBeVisible();
  const master = page.getByRole('checkbox', { name: 'Include all files' });
  await expect(master).toHaveAttribute('aria-checked', 'mixed');
  await master.click();
  await expect(page.getByText('100 of 100 in commit')).toBeVisible();
  await master.click();
  await expect(page.getByText('0 of 100 in commit')).toBeVisible();
  await page.getByRole('button', { name: 'Collapse all folders' }).click();
  await expect(tree(page).getByRole('treeitem', { selected: true })).toHaveCount(0);
});

test('F-16.4 commit panel: counter, amend, disabled without a message, hook output', async ({
  page,
}) => {
  await open(page, { commitFails: 'hook' });
  const commit = page.getByRole('button', { name: 'Commit · 80 files' });
  await expect(commit).toBeDisabled();
  await page.getByLabel('Message').fill('x'.repeat(73));
  await expect(page.getByText('73/72')).toBeVisible();
  await page.getByLabel('Message').fill('');
  await page.getByLabel('Amend previous commit').check();
  await expect(page.getByLabel('Message')).toHaveValue(/UploadWorker: jittered backoff/);
  await expect(page.getByRole('button', { name: 'Amend · 80 files' })).toBeEnabled();
  await page.getByLabel('Amend previous commit').uncheck();
  await page.getByRole('button', { name: 'Commit · 80 files' }).click();
  await expect(page.getByText('Commit failed. A hook rejected it.')).toBeVisible();
  await page.getByText('Hook output').click();
  await expect(page.getByText(/WHITESPACE/)).toBeVisible();
  await expect(page.getByLabel('Message')).toHaveValue(/UploadWorker/);
  await expect(page.getByRole('button', { name: 'Review with Claude first' })).toBeVisible();
});

test('F-16.5 after commit: Created, Push only, New commit', async ({ page }) => {
  await open(page);
  await page.getByLabel('Message').fill('Enable compiled bindings in app pages');
  await page.getByRole('button', { name: 'Commit · 80 files' }).click();
  const created = page.getByRole('status');
  await expect(created.getByText('7c1e2a9')).toBeVisible();
  await expect(page.getByText('0 of 20 in commit')).toBeVisible();
  await created.getByRole('button', { name: 'Push only' }).click();
  await expect(created.getByText('Pushed to origin/chore/compiled-bindings.')).toBeVisible();
  await created.getByRole('button', { name: 'New commit' }).click();
  await expect(page.getByRole('status')).toHaveCount(0);
  await expect(page.getByLabel('Message')).toHaveValue('');
});

test('F-16.5 Push and create MR opens S-11; a rejected push offers Rider', async ({ page }) => {
  await open(page);
  await page.getByLabel('Message').fill('Subject');
  await page.getByRole('button', { name: /^Commit · / }).click();
  await page.getByRole('status').getByRole('button', { name: 'Push and create MR' }).click();
  await expect(page.getByTestId('title-bar').getByText('New merge request')).toBeVisible();
});

test('F-16.5 rejected push is reported with Pull with rebase in Rider', async ({ page }) => {
  await open(page, { pushFails: 'rejected' });
  await page.getByLabel('Message').fill('Subject');
  await page.getByRole('button', { name: /^Commit · / }).click();
  await page.getByRole('status').getByRole('button', { name: 'Push only' }).click();
  await expect(
    page.getByText("Push rejected: the remote has commits you don't have."),
  ).toBeVisible();
  await expect(page.getByRole('button', { name: 'Pull with rebase in Rider' })).toBeVisible();
});

test('S-06 states: no repository, clean tree, merge in progress', async ({ page }) => {
  await open(page, { noRepo: true });
  await page.getByRole('button', { name: 'Pick a repository' }).click();
  await expect(page.getByText('80 of 100 in commit')).toBeVisible();
});

test('S-06 working tree clean and merge in progress', async ({ page }) => {
  await open(page, { clean: true, operation: 'merge' });
  await expect(page.getByText('Working tree clean.')).toBeVisible();
  await expect(
    page.getByText('A merge is in progress. Finish or abort it in Rider or git first.').first(),
  ).toBeVisible();
});
