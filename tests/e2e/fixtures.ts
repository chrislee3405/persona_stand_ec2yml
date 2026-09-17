import { test as base, expect } from '@playwright/test';

export const test = base.extend<{ checkPageErrors: void }>({
  checkPageErrors: [async ({ page, baseURL }, use) => {
    const errors: string[] = [];
    page.on('pageerror', error => errors.push(error.message));
    // Portfolio media lives on a CDN. These tests exercise the app/API;
    // external media availability is outside this reproducible suite.
    await page.route('**/*', route => {
      const url = new URL(route.request().url());
      if (url.origin === new URL(baseURL!).origin || !url.protocol.startsWith('http')) {
        return route.continue();
      }
      return route.abort();
    });
    await use();
    expect(errors, 'Uncaught browser errors').toEqual([]);
  }, { auto: true }],
});
export { expect };

export async function consent(page: import('@playwright/test').Page) {
  await page.goto('/chatroom');
  await expect(page.getByRole('dialog', { name: 'Test consent' })).toBeVisible();
  await page.getByRole('button', { name: 'I Agree', exact: true }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
}

export async function send(page: import('@playwright/test').Page, message: string, endpoint = 'guestchat') {
  await page.getByRole('textbox', { name: 'Message', exact: true }).fill(message);
  const response = page.waitForResponse(r => r.url().endsWith(`/api/${endpoint}`) && r.request().method() === 'POST');
  await page.getByRole('button', { name: 'Send message', exact: true }).click();
  return response;
}
