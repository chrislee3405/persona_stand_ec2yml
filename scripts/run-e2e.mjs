import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { checkBackendLogging, findLogLeaks, makeCanary } from './log-policy.mjs';

// Every invocation owns a unique Compose project. Cleanup never uses the
// production compose file, fixed application container names, or DB volumes.
const project = `persona-e2e-${Date.now()}-${process.pid}`;
mkdirSync('test-results', { recursive: true });
// Clear a previous success before validating inputs or starting containers.
writeFileSync('test-results/release-result.json', JSON.stringify({ status: 'running', project }, null, 2));
const port = process.env.E2E_PORT || '18080';
if (!/^\d+$/.test(port) || Number(port) < 1024 || Number(port) > 65535) throw new Error('E2E_PORT must be 1024..65535');
for (const name of ['TEST_FRONTEND_IMAGE', 'TEST_BACKEND_IMAGE']) {
  if (!process.env[name]) throw new Error(`${name} is required (use a local image or a selected release)`);
}
const env = { ...process.env, E2E_BASE_URL: `http://127.0.0.1:${port}` };
const compose = ['compose', '--env-file', 'tests/compose.env', '-p', project, '-f', 'docker-compose.test.yml'];

function run(command, args, options = {}) {
  const result = spawnSync(command, args, { env, stdio: 'inherit', ...options });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`${command} ${args.join(' ')} failed (${result.status})`);
  return result;
}

function output(command, args, options = {}) {
  const result = spawnSync(command, args, { env, encoding: 'utf8', maxBuffer: 20 * 1024 * 1024, ...options });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`${command} ${args.join(' ')} failed (${result.status}): ${result.stderr}`);
  return result.stdout;
}

// --- Production logging, tested for real -------------------------------------
// The backend in these tests runs with the logging the DEPLOYMENT uses, read
// from docker-compose.ec2.yml itself rather than restated here -- so a change
// to that file is what gets tested. Rendered with placeholder image digests
// (only the backend's environment is read) and without the caller's own
// LOG_LEVEL / CHAT_TRACE, so it reflects the committed defaults. The same rule
// guards the real deploy: scripts/deploy_release.py.
function productionBackendLogging() {
  const emptyEnvFile = 'test-results/production-render.env';
  writeFileSync(emptyEnvFile, '');
  const renderEnv = {
    ...env,
    ECR_ACCOUNT_ID: '000000000000',
    AWS_REGION: 'ap-southeast-2',
    FRONTEND_DIGEST: `sha256:${'0'.repeat(64)}`,
    BACKEND_DIGEST: `sha256:${'0'.repeat(64)}`,
  };
  for (const name of ['LOG_LEVEL', 'CHAT_TRACE', 'SESSION_COOKIE_SECURE', 'ENV']) delete renderEnv[name];
  const rendered = JSON.parse(output('docker', [
    'compose', '--env-file', emptyEnvFile, '-f', 'docker-compose.ec2.yml', 'config', '--format', 'json',
  ], { env: renderEnv }));
  return checkBackendLogging(rendered.services?.backend?.environment);
}

// After the browser run: the log-hygiene spec sent `canary` as a chat message.
// It must be in the database -- otherwise the spec never really ran and the
// log check below would prove nothing -- and in no container's logs.
function assertConversationStayedOutOfLogs(canary) {
  const stored = output('docker', [
    ...compose, 'exec', '-T', 'db', 'psql', '-U', 'persona_test', '-d', 'persona_test', '-tAc',
    `SELECT count(*) FROM message WHERE text LIKE '%${canary}%'`,
  ]).trim();
  if (!(Number(stored) >= 1)) {
    throw new Error('Log hygiene: the canary chat message never reached the backend, so the log check proves nothing. See tests/e2e/log-hygiene.spec.ts.');
  }
  const logs = output('docker', [...compose, 'logs', '--no-color']);
  const leaks = findLogLeaks(logs, canary);
  if (leaks.length) {
    throw new Error(`Log hygiene: conversation content reached the container logs (${leaks.join('; ')}). See test-results/containers.log.`);
  }
  console.log('Log hygiene: the chat message was processed and stored, and appears in no container log.');
}

let failure;
try {
  const logging = productionBackendLogging();
  env.E2E_BACKEND_LOG_LEVEL = logging.LOG_LEVEL;
  env.E2E_BACKEND_CHAT_TRACE = logging.CHAT_TRACE;
  env.E2E_LOG_CANARY = makeCanary();
  console.log(`Backend runs with the deployment's logging: LOG_LEVEL=${logging.LOG_LEVEL}, CHAT_TRACE=${logging.CHAT_TRACE}`);
  run('docker', [...compose, 'up', '-d', '--wait', '--wait-timeout', '180']);
  run(process.execPath, [resolve('node_modules/@playwright/test/cli.js'), 'test']);
  assertConversationStayedOutOfLogs(env.E2E_LOG_CANARY);
} catch (error) {
  failure = error;
} finally {
  const logs = spawnSync('docker', [...compose, 'logs', '--no-color'], { env, encoding: 'utf8', maxBuffer: 20 * 1024 * 1024 });
  writeFileSync('test-results/containers.log', (logs.stdout || '') + (logs.stderr || ''));
  try { run('docker', [...compose, 'down', '--volumes', '--remove-orphans']); }
  catch (error) { failure ||= error; }
}
const selection = existsSync('selected-release.json') ? JSON.parse(readFileSync('selected-release.json', 'utf8')) : null;
const matches = selection?.frontend.image === env.TEST_FRONTEND_IMAGE && selection?.backend.image === env.TEST_BACKEND_IMAGE;
writeFileSync('test-results/release-result.json', JSON.stringify({
  status: failure ? 'failed' : 'passed',
  finishedAt: new Date().toISOString(),
  repository: process.env.GITHUB_REPOSITORY || null,
  runId: process.env.GITHUB_RUN_ID || null,
  runAttempt: process.env.GITHUB_RUN_ATTEMPT || null,
  coordinatorRevision: process.env.GITHUB_SHA || 'local-working-tree',
  frontendImage: env.TEST_FRONTEND_IMAGE,
  backendImage: env.TEST_BACKEND_IMAGE,
  selectedRelease: matches ? selection : null,
  scope: 'Chromium, fictional PostgreSQL data, real API and nginx, fake Gemini, external media excluded',
}, null, 2) + '\n');
if (failure) {
  console.error(failure.message);
  process.exitCode = 1;
}
