import { expect, test, type Page } from '@playwright/test';

// F-18.8: the title bar spinner while Claude tasks run or wait (mock backend).

async function open(page: Page, claude: Record<string, unknown>) {
  await page.addInitScript((claude) => {
    localStorage.setItem('guided-review.mock.claude', JSON.stringify(claude));
  }, claude);
  await page.goto('/');
}

const bar = (page: Page) => page.getByTestId('title-bar');

test('F-18.8 a running mock task shows the purple spinner right of the Claude chip', async ({
  page,
}) => {
  await open(page, { activity: { running: 1, waiting: 2 } });
  const spinner = bar(page).getByRole('status', {
    name: 'Claude is working: 1 running, 2 waiting.',
  });
  await expect(spinner).toBeVisible();
  await expect(spinner).toHaveAttribute('title', 'Claude is working: 1 running, 2 waiting.');
  const chip = await bar(page).getByRole('button', { name: 'Claude Code signed in' }).boundingBox();
  const box = await spinner.boundingBox();
  expect(chip && box && box.x >= chip.x + chip.width - 1).toBeTruthy();
  const animation = await spinner.evaluate((el) => {
    const target = el.querySelector('svg') ?? el;
    return getComputedStyle(target).animationName;
  });
  expect(animation).not.toBe('none');
});

test('F-18.8 no spinner while the queue is empty', async ({ page }) => {
  await open(page, {});
  await expect(bar(page).getByRole('button', { name: 'Claude Code signed in' })).toBeVisible();
  await expect(bar(page).getByRole('status', { name: /Claude is working/ })).toHaveCount(0);
});

test('F-18.8 with reduced motion the arc stays still', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await open(page, { activity: { running: 1, waiting: 0 } });
  const spinner = bar(page).getByRole('status', { name: 'Claude is working: 1 running.' });
  await expect(spinner).toBeVisible();
  const names = await spinner.evaluate((el) =>
    [el, ...Array.from(el.querySelectorAll('*'))].map((n) => getComputedStyle(n).animationName),
  );
  expect(names.every((n) => n === 'none')).toBe(true);
});
