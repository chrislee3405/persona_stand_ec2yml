import { test, expect, consent, send } from './fixtures';

const reply = 'I built a fictional portfolio with automated tests.';

test('consent gates sending, a guest reply survives refresh, and withdrawal blocks sending', async ({ page }) => {
  await page.goto('/chatroom');
  await page.getByRole('button', { name: "I Don't Agree", exact: true }).click();
  const chatRequests: string[] = [];
  page.on('request', request => {
    if (request.url().endsWith('/api/guestchat')) chatRequests.push(request.url());
  });
  await page.getByRole('textbox', { name: 'Message', exact: true }).fill('Tell me about your portfolio.');
  await page.getByRole('button', { name: 'Send message', exact: true }).click();
  await expect(page.getByRole('dialog', { name: 'Test consent' })).toBeVisible();
  expect(chatRequests).toHaveLength(0);
  await page.getByRole('button', { name: 'I Agree', exact: true }).click();
  const response = await send(page, 'Tell me about your portfolio.');
  expect(response.status()).toBe(200);
  const result = await response.json();
  expect(result.conversationId).toBeTruthy();
  await expect(page.getByRole('log').getByText(reply, { exact: true })).toBeVisible();
  await page.reload();
  await expect(page.getByRole('log').getByText(reply, { exact: true })).toBeVisible();
  await expect(page.getByText(result.conversationId, { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Disagree with consent', exact: true }).click();
  await expect(page.getByRole('dialog', { name: 'Test consent' })).toBeVisible();
  // Use this browser's cookies to also verify the real API enforces withdrawal.
  const rejected = await page.request.post('/api/guestchat', { data: { text: 'A further question.' } });
  expect(rejected.status()).toBe(403);
});

test('privacy rejection remains marked after refresh', async ({ page }) => {
  await consent(page);
  const response = await send(page, 'My email is alice@example.com.');
  expect(response.status()).toBe(400);
  await expect(page.getByRole('log').getByText('✕ Not sent', { exact: true })).toBeVisible();
  await page.reload();
  await expect(page.getByRole('log').getByText('✕ Not sent', { exact: true })).toBeVisible();
});

test('model failure is shown as not answered and a later send recovers', async ({ page }) => {
  await consent(page);
  const failed = await send(page, 'Please simulate a model failure.');
  expect(failed.status()).toBe(200);
  expect((await failed.json()).userMessageKept).toBe(false);
  await expect(page.getByRole('log').getByText('✕ Not answered', { exact: true })).toBeVisible();
  const recovered = await send(page, 'Tell me about your portfolio.');
  expect(recovered.status()).toBe(200);
  await expect(page.getByRole('log').getByText(reply, { exact: true })).toBeVisible();
});
