import { expect, test, type Page } from '@playwright/test';

// F-27.2 against the mock backend: S-11 opens with the title from the commits (the branch name
// in words, 3 commits) and the empty What / Why / How to test skeleton; "Write with Claude" fills
// them with the texts of CreateMR.dc.html, then the slot reads Shorter version / Longer version
// (M7 decisions 15 and 16). Locators the screen keeps: textboxes "Title" and "Description", the
// button in the description's regenerate slot, role=alertdialog "Replace your edits?" with
// "Replace" and "Cancel".

const TITLE = 'Enable compiled bindings in app pages';
const SKELETON = '## What\n\n## Why\n\n## How to test\n1. ';
const D1 =
  '## What\nAdds x:DataType to 12 pages and their DataTemplates, so XAML bindings are compiled.\n\n## Why\nCompiled bindings fail at build time instead of silently at runtime, and they are faster. Two broken bindings showed up and are fixed here: DeliveryListPage (Adress → Address) and ScannerPage.\n\n## How to test\n1. Build Release for Android and iOS.\n2. Open Deliveries, Scanner and Account. Lists and labels show data.\n3. Rotate the device on Deliveries. Nothing goes blank.';
const D2 =
  '## What\nTurns on compiled bindings (x:DataType) in all 12 app pages.\n\n## Why\nTypos in bindings now break the build. This MR already fixes the two it found.\n\n## How to test\n1. Release build on a device.\n2. Click through Deliveries, Scanner, Account.\n3. Rotate on Deliveries.';

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

/** S-01 › My changes › Review before push (staged) › S-02 › Start step 1 › Finish review. */
async function openSelfReviewSummary(page: Page) {
  await page.goto('/');
  await expect(page.getByTestId('title-bar')).toBeVisible();
  const mine = page.getByRole('region', { name: 'My changes' });
  await mine.getByRole('radio', { name: /Staged only/ }).check();
  await mine.getByRole('button', { name: 'Review before push' }).click();
  const plan = page.getByRole('main', { name: 'Review plan' });
  await expect(plan.getByRole('heading', { name: 'Plan · 8 steps' })).toBeVisible({
    timeout: 10000,
  });
  await plan.getByRole('button', { name: /Start step 1/ }).click();
  await expect(page.getByText('Step 1 of 8')).toBeVisible();
  await page.getByTestId('title-bar').getByRole('button', { name: 'Finish review' }).click();
  await expect(page.getByRole('heading', { name: /^summary$/i })).toBeVisible();
}

test('F-27.2 S-11 opens with the title from the commits and an empty What / Why / How to test skeleton', async ({
  page,
}) => {
  await openNewMr(page);
  await expect(page.getByRole('textbox', { name: 'Title' })).toHaveValue('Chore compiled bindings');
  await expect(page.getByRole('textbox', { name: 'Description' })).toHaveValue(SKELETON);
  await expect(page.getByRole('button', { name: 'Write with Claude' })).toBeEnabled();
  await expect(page.getByText(/Drafted by Claude/)).toHaveCount(0);
});

test('F-27.2 Write with Claude fills the title and the description, then Shorter and Longer version regenerate', async ({
  page,
}) => {
  await openNewMr(page);
  const title = page.getByRole('textbox', { name: 'Title' });
  const description = page.getByRole('textbox', { name: 'Description' });
  await expect(title).toHaveValue('Chore compiled bindings');

  await page.getByRole('button', { name: 'Write with Claude' }).click();
  await expect(page.getByRole('button', { name: 'Writing…' })).toBeDisabled();
  await expect(page.getByRole('button', { name: 'Shorter version' })).toBeEnabled({
    timeout: 10000,
  });
  await expect(title).toHaveValue(TITLE);
  await expect(description).toHaveValue(D1);
  await expect(page.getByText('Drafted by Claude from 3 commits and the diff')).toBeVisible();

  await page.getByRole('button', { name: 'Shorter version' }).click();
  await expect(page.getByRole('button', { name: 'Longer version' })).toBeEnabled({
    timeout: 10000,
  });
  await expect(description).toHaveValue(D2);

  await page.getByRole('button', { name: 'Longer version' }).click();
  await expect(page.getByRole('button', { name: 'Shorter version' })).toBeEnabled({
    timeout: 10000,
  });
  await expect(description).toHaveValue(D1);
});

test('F-27.2 regenerating over your own edits asks "Replace your edits?" first', async ({
  page,
}) => {
  await openNewMr(page);
  const title = page.getByRole('textbox', { name: 'Title' });
  const description = page.getByRole('textbox', { name: 'Description' });
  await expect(title).toHaveValue('Chore compiled bindings');
  await page.getByRole('button', { name: 'Write with Claude' }).click();
  await expect(page.getByRole('button', { name: 'Shorter version' })).toBeEnabled({
    timeout: 10000,
  });

  await title.fill('My own title');
  await page.getByRole('button', { name: 'Shorter version' }).click();
  const dialog = page.getByRole('alertdialog', { name: 'Replace your edits?' });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole('button', { name: 'Cancel' })).toBeFocused();
  await dialog.getByRole('button', { name: 'Cancel' }).click();
  await expect(dialog).toHaveCount(0);
  await expect(title).toHaveValue('My own title');
  await expect(description).toHaveValue(D1);

  await page.getByRole('button', { name: 'Shorter version' }).click();
  await dialog.getByRole('button', { name: 'Replace' }).click();
  await expect(page.getByRole('button', { name: 'Longer version' })).toBeEnabled({
    timeout: 10000,
  });
  await expect(title).toHaveValue(TITLE);
  await expect(description).toHaveValue(D2);
});

test('F-27.2 Draft MR description at the end of a self-review opens S-11 with the description being written', async ({
  page,
}) => {
  await openSelfReviewSummary(page);
  await page.getByRole('button', { name: 'Draft MR description' }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'New merge request' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Shorter version' })).toBeEnabled({
    timeout: 10000,
  });
  await expect(page.getByRole('textbox', { name: 'Title' })).toHaveValue(TITLE);
  await expect(page.getByRole('textbox', { name: 'Description' })).toHaveValue(D1);
  await expect(page.getByText('Drafted by Claude from 3 commits and the diff')).toBeVisible();
});
