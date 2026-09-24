// What a deployed backend may write to its logs, and how the combined browser
// tests check it actually does.
//
// DEBUG logging, or the backend's CHAT_TRACE switch, puts every visitor's
// messages into the container logs. The same rule is enforced on EC2 by
// scripts/deploy_release.py (validate_logging) before any release starts --
// keep the two in step.
import { randomInt } from 'node:crypto';

export const SAFE_LOG_LEVELS = ['INFO', 'WARNING', 'ERROR'];
const TRUE_VALUES = new Set(['1', 'true', 'yes', 'on']);

// The backend's one logger allowed to carry conversation content
// (persona_stand_back/app/chat_trace.py). Its name appears in every record it
// writes, so any line containing it is conversation content in the logs.
export const TRACE_LOGGER = 'app.chat_trace';

/**
 * Checks the backend's logging environment as the deployment renders it.
 * Returns the two values the combined tests run the backend with; throws if
 * the configuration would log conversations.
 */
export function checkBackendLogging(environment = {}) {
  const level = String(environment.LOG_LEVEL ?? '').trim().toUpperCase();
  if (!SAFE_LOG_LEVELS.includes(level)) {
    throw new Error(
      `Production backend LOG_LEVEL must be one of ${SAFE_LOG_LEVELS.join(', ')} (got ${level || 'unset'}): ` +
      'anything lower logs visitor conversations. Fix docker-compose.ec2.yml.',
    );
  }
  if (TRUE_VALUES.has(String(environment.CHAT_TRACE ?? '').trim().toLowerCase())) {
    throw new Error('Production backend has CHAT_TRACE on, which logs every conversation. Remove it from docker-compose.ec2.yml.');
  }
  return { LOG_LEVEL: level, CHAT_TRACE: 'false' };
}

/**
 * A message body that is unique to one run and can only reach the logs by
 * leaking: lowercase letters only, so the privacy gate has nothing to flag
 * and a log search cannot match anything else by accident.
 */
export function makeCanary(random = randomInt) {
  let letters = '';
  for (let i = 0; i < 20; i += 1) letters += String.fromCharCode(97 + random(26));
  return `logcanary${letters}`;
}

/** Everything in the collected container logs that is conversation content. */
export function findLogLeaks(logs, canary) {
  const leaks = [];
  if (canary && logs.includes(canary)) leaks.push('the text of a visitor message');
  if (logs.includes(TRACE_LOGGER)) leaks.push(`records from the ${TRACE_LOGGER} logger`);
  return leaks;
}
