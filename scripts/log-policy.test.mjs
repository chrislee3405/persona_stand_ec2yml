import assert from 'node:assert/strict';
import test from 'node:test';
import { checkBackendLogging, findLogLeaks, makeCanary, TRACE_LOGGER } from './log-policy.mjs';

test('accepts production log levels in any case and forces tracing off', () => {
  assert.deepEqual(checkBackendLogging({ LOG_LEVEL: 'info' }), { LOG_LEVEL: 'INFO', CHAT_TRACE: 'false' });
  assert.deepEqual(checkBackendLogging({ LOG_LEVEL: 'WARNING', CHAT_TRACE: 'false' }), { LOG_LEVEL: 'WARNING', CHAT_TRACE: 'false' });
});

test('refuses DEBUG, an unset level, or a typo', () => {
  for (const LOG_LEVEL of ['DEBUG', 'debug', '', undefined, 'INFOO']) {
    assert.throws(() => checkBackendLogging({ LOG_LEVEL }), /LOG_LEVEL/);
  }
});

test('refuses CHAT_TRACE switched on in any spelling', () => {
  for (const CHAT_TRACE of ['true', 'TRUE', '1', 'yes', 'on']) {
    assert.throws(() => checkBackendLogging({ LOG_LEVEL: 'INFO', CHAT_TRACE }), /CHAT_TRACE/);
  }
});

test('the canary is unique lowercase letters', () => {
  const canary = makeCanary();
  assert.match(canary, /^logcanary[a-z]{20}$/);
  assert.notEqual(canary, makeCanary());
});

test('finds the canary or any trace-logger record, and nothing in clean logs', () => {
  const canary = 'logcanaryabcdefghijklmnopqrst';
  const clean = 'backend-1 | INFO app.main: Readiness gate: respond for conversation_id=x\nfrontend-1 | "POST /api/guestchat HTTP/1.1" 200';
  assert.deepEqual(findLogLeaks(clean, canary), []);
  assert.equal(findLogLeaks(`${clean}\nbackend-1 | DEBUG x: prompt ${canary}`, canary).length, 1);
  assert.equal(findLogLeaks(`${clean}\nbackend-1 | [DEBUG] ${TRACE_LOGGER}: reply`, canary).length, 1);
});
