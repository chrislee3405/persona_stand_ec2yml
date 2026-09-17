import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

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

let failure;
try {
  run('docker', [...compose, 'up', '-d', '--wait', '--wait-timeout', '180']);
  run(process.execPath, [resolve('node_modules/@playwright/test/cli.js'), 'test']);
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
