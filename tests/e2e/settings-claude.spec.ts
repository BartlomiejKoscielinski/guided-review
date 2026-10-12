import { expect, test, type Page } from '@playwright/test';

// Settings › Claude and the Claude parts of S-06 against the mock backend (Settings.dc.html).

async function open(page: Page, lastRoute: object, claude: Record<string, unknown> = {}) {
  await page.addInitScript(
    ({ lastRoute, claude }) => {
      localStorage.setItem('guided-review.mock.claude', JSON.stringify(claude));
      // Only on the first load: a reload must show what the mock saved.
      if (localStorage.getItem('guided-review.mock.settings') === null) {
        localStorage.setItem('guided-review.mock.settings', JSON.stringify({ ui: { lastRoute } }));
      }
    },
    { lastRoute, claude },
  );
  await page.goto('/');
}

const CLAUDE = { screen: 'S-07', section: 'claude' };

test('F-18.1 status line says Claude Code is signed in', async ({ page }) => {
  await open(page, CLAUDE);
  await expect(page.getByRole('heading', { name: 'Claude', level: 1 })).toBeVisible();
  await expect(page.getByText('Claude Code: signed in')).toBeVisible();
});

test('F-18.2 defaults are saved immediately and survive a reload', async ({ page }) => {
  await open(page, CLAUDE);
  await page.getByLabel('Model', { exact: true }).selectOption({ label: 'Sonnet 5.5' });
  await page
    .getByRole('radiogroup', { name: 'Effort' })
    .getByRole('radio', { name: 'high', exact: true })
    .click();
  await page.getByLabel('Writes in').selectOption({ label: 'Polish' });
  await page.reload();
  await expect(page.getByLabel('Model', { exact: true })).toHaveValue('claude-sonnet-5-5');
  await expect(
    page
      .getByRole('radiogroup', { name: 'Effort' })
      .getByRole('radio', { name: 'high', exact: true }),
  ).toHaveAttribute('aria-checked', 'true');
  await expect(page.getByLabel('Writes in')).toHaveValue('pl');
});

test('F-18.3 per task overrides with the F-18.3 defaults', async ({ page }) => {
  await open(page, CLAUDE);
  const expected: [string, string, string][] = [
    ['Review plan', 'claude-opus-5-5', 'high'],
    ['Step analysis', 'claude-sonnet-5-5', 'medium'],
    ['Questions', 'default', 'low'],
    ['Fixes on your code', 'claude-sonnet-5-5', 'medium'],
    ['MR description and pipeline', 'claude-sonnet-5-5', 'low'],
    ['Commit message', 'claude-haiku-5-5', 'low'],
  ];
  for (const [task, model, effort] of expected) {
    await expect(page.getByLabel(`Model for ${task}`)).toHaveValue(model);
    await expect(page.getByLabel(`Effort for ${task}`)).toHaveValue(effort);
  }
});

test('F-18.5 the model chip shows the screen task and opens Settings › Claude', async ({
  page,
}) => {
  await open(page, { screen: 'S-06' });
  const chip = page.getByTestId('title-bar').getByRole('button', { name: 'Haiku 5.5 · low' });
  await chip.click();
  await expect(page.getByRole('heading', { name: 'Claude', level: 1 })).toBeVisible();
  await page.getByLabel('Effort for Commit message').selectOption('medium');
  await page.getByRole('button', { name: /^Changes/ }).click();
  await expect(
    page.getByTestId('title-bar').getByRole('button', { name: 'Haiku 5.5 · medium' }),
  ).toBeVisible();
});

test('F-18.6 executable and task limit', async ({ page }) => {
  await open(page, CLAUDE);
  await expect(page.getByText('C:\\Users\\dev\\.local\\bin\\claude.exe · 2.1.296')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Change', exact: true })).toBeVisible();
  const limit = page.getByRole('radiogroup', { name: 'Run at most N Claude tasks at once' });
  await limit.getByRole('radio', { name: '4' }).click();
  await expect(limit.getByRole('radio', { name: '4' })).toHaveAttribute('aria-checked', 'true');
});

test('F-16.4 Suggest writes the commit message', async ({ page }) => {
  await open(page, { screen: 'S-06' });
  await page.getByRole('button', { name: 'Suggest' }).click();
  await expect(page.getByRole('button', { name: 'Claude is writing…' })).toBeDisabled();
  await expect(page.getByLabel('Message')).toHaveValue(/^Enable compiled bindings in app pages\n/);
  await expect(page.getByText('37/72')).toBeVisible();
});

test('F-18.7 usage limit keeps the message and allows retry', async ({ page }) => {
  await open(page, { screen: 'S-06' }, { suggestFails: 'limited' });
  await page.getByLabel('Message').fill('My own words');
  await page.getByRole('button', { name: 'Suggest' }).click();
  await expect(page.getByText(/^Claude usage limit reached · resets \d\d:\d\d$/)).toBeVisible();
  await expect(page.getByLabel('Message')).toHaveValue('My own words');
  await expect(page.getByRole('button', { name: 'Suggest' })).toBeEnabled();
});

test('F-18.1 S-01 chip turns orange with the fixing action when signed out', async ({ page }) => {
  await open(page, { screen: 'S-01' }, { state: 'notSignedIn' });
  await expect(
    page.getByTestId('title-bar').getByRole('button', { name: 'Sign in to Claude Code' }),
  ).toBeVisible();
});
