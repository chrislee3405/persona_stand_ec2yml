import { test, expect, consent, send } from './fixtures';

test('invalid invite is rejected, valid invite selects invite chat and survives refresh', async ({ page }) => {
  await consent(page);
  await page.getByRole('button', { name: 'Have an invite code?' }).click();
  await page.getByRole('textbox', { name: 'Invite code', exact: true }).fill('INVALID-TEST-CODE');
  await page.getByRole('button', { name: 'Verify', exact: true }).click();
  await expect(page.getByRole('alert')).toBeVisible();
  await page.getByRole('textbox', { name: 'Invite code', exact: true }).fill('TEST-INVITE');
  await page.getByRole('button', { name: 'Verify', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Verified', exact: true })).toBeDisabled();
  await page.reload();
  await expect(page.getByRole('button', { name: 'Verified', exact: true })).toBeDisabled();
  const response = await send(page, 'Tell me about your portfolio.', 'invitechat');
  expect(response.status()).toBe(200);
  await expect(page.getByRole('log').getByText('I built a fictional portfolio with automated tests.', { exact: true })).toBeVisible();
});
