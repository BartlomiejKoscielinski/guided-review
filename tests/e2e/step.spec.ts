import { expect, test, type Page } from '@playwright/test';

// S-03 layout A against the mock backend, part 1 (M3 plan › 3e): step 1 from the plan, the steps
// list, the step's diff with its fold, notes, thread, and a decision with Undo (F-09.2).

async function openStep1(page: Page) {
  await page.goto('/');
  await expect(page.getByTestId('title-bar')).toBeVisible();
  const source = page.getByLabel(/Paste a merge request link/);
  await source.fill('!482');
  await expect(page.getByText('Merge request !482', { exact: true })).toBeVisible();
  await source.press('Enter');
  await expect(page.getByRole('heading', { name: 'Plan · 8 steps' })).toBeVisible();
  await page.getByRole('button', { name: /Start step 1/ }).click();
  await expect(page.getByText('Step 1 of 8')).toBeVisible();
}

test('F-07.1 F-07.2 the steps list opens a step; next goes on in the reader order', async ({
  page,
}) => {
  await openStep1(page);
  const steps = page.getByRole('navigation', { name: 'Steps' });
  await expect(steps.getByRole('button', { name: /Queue contract/ })).toHaveAttribute(
    'aria-current',
    'step',
  );
  await page.getByRole('button', { name: 'Next step' }).click();
  await expect(page.getByText('Step 2 of 8')).toBeVisible();
  await steps.getByRole('button', { name: /ViewModel/ }).click();
  await expect(page.getByText('Step 4 of 8')).toBeVisible();
  await expect(
    page.getByRole('heading', { level: 1, name: 'ViewModel: queue instead of upload' }),
  ).toBeVisible();
});

test('F-07.4 F-07.5 F-09.2 step 4: fold, thread, notes; Add to drafts and Undo', async ({
  page,
}) => {
  await openStep1(page);
  await page
    .getByRole('navigation', { name: 'Steps' })
    .getByRole('button', { name: /ViewModel/ })
    .click();
  await expect(page.getByText('Fields and constructor: 3 new dependencies')).toBeVisible();
  await expect(page.getByRole('region', { name: 'Thread at line 48' })).toContainText(
    'Kick() is called on the UI thread.',
  );
  await page
    .getByRole('button', { name: 'Note 2: PendingCount won’t refresh after upload' })
    .click();
  const card = page.getByRole('article', {
    name: 'Claude note: PendingCount won’t refresh after upload',
  });
  await card.getByRole('button', { name: 'Add to drafts' }).click();
  await expect(card.getByText(/Added to drafts\./)).toBeVisible();
  await expect(page.getByText('3 notes')).toBeVisible();
  await card.getByRole('button', { name: 'Undo' }).click();
  await expect(card.getByRole('button', { name: 'Add to drafts' })).toBeVisible();
  await expect(page.getByText('4 notes')).toBeVisible();

  await page.getByRole('button', { name: 'Show' }).click();
  await expect(page.getByText('Fields and constructor: 3 new dependencies')).toHaveCount(0);
  await expect(page.getByText('private readonly IUploadQueue _queue;')).toBeVisible();
});

test('F-07.1 F-07.8 F-07.7 F-10.2 layouts B and C share the step, the note and the answer; Ctrl+1/2/3', async ({
  page,
}) => {
  await openStep1(page);
  await page
    .getByRole('navigation', { name: 'Steps' })
    .getByRole('button', { name: /ViewModel/ })
    .click();
  await page
    .getByRole('button', { name: 'Note 1: The whole photo goes into SQLite as byte[]' })
    .click();
  const main = page.locator('main[class*="main"]').first();
  await main.evaluate((el) => {
    el.scrollTop = 120;
  });

  await page.keyboard.press('Control+2');
  await expect(page.getByRole('navigation', { name: 'Steps' })).toHaveCount(0);
  await expect(page.getByRole('toolbar', { name: 'Step navigation' })).toContainText('Step 4 of 8');
  await expect(
    page.getByRole('article', { name: 'Claude note: The whole photo goes into SQLite as byte[]' }),
  ).toBeVisible();
  expect(await main.evaluate((el) => el.scrollTop)).toBe(120);

  await page.keyboard.press('Control+3');
  const guide = page.getByRole('complementary', { name: 'Guide' });
  await expect(guide.getByText('Worth a look')).toBeVisible();
  await expect(
    guide.getByRole('article', { name: 'Claude note: The whole photo goes into SQLite as byte[]' }),
  ).toBeVisible();

  await guide.getByRole('textbox', { name: 'Ask Claude about this step' }).fill('Why a queue?');
  await page.keyboard.press('Enter');
  const answer = guide.getByRole('article', { name: 'Claude answer' });
  await expect(answer.getByRole('button', { name: 'Add to drafts' })).toBeVisible();
  await answer.getByRole('button', { name: 'Add to drafts' }).click();
  await expect(answer.getByText(/Added to drafts/)).toBeVisible();

  await page.keyboard.press('Control+1');
  await expect(page.getByText('Step 4 of 8')).toBeVisible();
  await expect(page.getByRole('navigation', { name: 'Steps' })).toBeVisible();
});
