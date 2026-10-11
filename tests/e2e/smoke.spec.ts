import { expect, test } from '@playwright/test';

// The UI starts in the browser with the mock backend (ADR-016).
test('app starts with the mock backend', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Guided Review' })).toBeVisible();
  await expect(page.getByTestId('app-health')).toHaveText('Version 0.1.0');
});
