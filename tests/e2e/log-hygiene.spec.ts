import { test, expect, consent, send } from './fixtures';

// scripts/run-e2e.mjs generates this canary, runs the backend with the
// deployment's own logging settings, and after the browser run checks that the
// message reached the database but none of the container logs.
const canary = process.env.E2E_LOG_CANARY;
const reply = 'I built a fictional portfolio with automated tests.';

test('a chat message is answered without its text reaching the logs', async ({ page }) => {
  test.skip(!canary, 'Run through `npm run test:e2e`, which checks the container logs afterwards.');
  await consent(page);
  // Through the real UI, nginx and the full reply pipeline -- every stage that
  // could log a prompt, a model response or a model's note about the message.
  const response = await send(page, `Tell me about the project ${canary}`);
  expect(response.status()).toBe(200);
  expect((await response.json()).userMessageKept).toBe(true);
  await expect(page.getByRole('log').getByText(reply, { exact: true }).first()).toBeVisible();
});
