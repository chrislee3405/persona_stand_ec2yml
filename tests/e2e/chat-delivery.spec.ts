import { test, expect, consent } from './fixtures';

test('leaving during the send hold preserves an unsent message that can be edited and resent', async ({ page }) => {
  // Keep CI speed out of the two-second batching precondition. Install before
  // navigation, let consent finish normally, then pause before submitting.
  await page.clock.install({ time: new Date('2026-01-01T00:00:00Z') });
  await consent(page);
  await page.clock.pauseAt(new Date('2026-01-01T01:00:00Z'));
  const sent: string[] = [];
  page.on('request', request => {
    if (request.url().endsWith('/api/guestchat') && request.method() === 'POST') sent.push(request.postData()!);
  });
  const text = 'Tell me about the project tests.';
  await page.getByRole('textbox', { name: 'Message', exact: true }).fill(text);
  await page.getByRole('button', { name: 'Send message', exact: true }).click();
  await expect(page.getByText('Waiting to send', { exact: true })).toBeVisible();
  await page.getByRole('link', { name: 'Test Candidate — home', exact: true }).click();
  // A history update alone does not prove React committed the route change.
  // Wait for the chat to unmount before navigating back.
  await expect(page).toHaveURL(/\/$/);
  await expect(page.getByRole('log')).toHaveCount(0);
  await expect(page.getByText('A fictional portfolio for automated tests.', { exact: true })).toBeVisible();
  await page.goBack();
  await expect(page).toHaveURL(/\/chatroom$/);
  await expect(page.getByRole('log').getByText('✕ Not sent', { exact: true })).toBeVisible();
  expect(sent).toHaveLength(0);
  await page.getByRole('button', { name: 'Edit and resend', exact: true }).click();
  const composer = page.getByRole('textbox', { name: 'Message', exact: true });
  await expect(composer).toHaveValue(text);
  await expect(composer).toBeFocused();
  const response = page.waitForResponse(r => r.url().endsWith('/api/guestchat') && r.request().method() === 'POST');
  await page.getByRole('button', { name: 'Send message', exact: true }).click();
  await page.clock.resume();
  expect((await response).status()).toBe(200);
  expect(sent).toHaveLength(1);
});

test('two valid fragments exceeding the combined limit are delivered as two valid requests', async ({ page }) => {
  await consent(page);
  const responses: { status: number; text: string }[] = [];
  page.on('response', response => {
    if (response.url().endsWith('/api/guestchat') && response.request().method() === 'POST') {
      responses.push({ status: response.status(), text: response.request().postDataJSON().text });
    }
  });
  const fragments = ['Describe the project tests. '.repeat(15).slice(0, 400),
    'Describe the project design. '.repeat(15).slice(0, 400)];
  for (const fragment of fragments) {
    await page.getByRole('textbox', { name: 'Message', exact: true }).fill(fragment);
    await page.getByRole('button', { name: 'Send message', exact: true }).click();
  }
  await expect.poll(() => responses.length).toBe(2);
  expect(responses.map(response => response.status)).toEqual([200, 200]);
  expect(responses.map(response => response.text)).toEqual(fragments.map(text => text.trim()));
  await expect(page.getByRole('log').getByText('✕ Not sent', { exact: true })).toHaveCount(0);
});
