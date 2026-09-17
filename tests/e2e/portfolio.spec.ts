import { test, expect } from './fixtures';

test('portfolio loads real API content and opens a project', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByText('A fictional portfolio for automated tests.', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: /Test Project/ }).click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await expect(page.getByText('A fictional project used to test navigation.', { exact: true })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await page.goto('/aboutme');
  await expect(page).toHaveURL(/\/#about$/);
});
