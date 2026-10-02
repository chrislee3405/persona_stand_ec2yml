import test from 'node:test';
import assert from 'node:assert/strict';
import { chooseRun, discover, releaseLabel } from './find-passing-release.mjs';
import { validateTarget } from './promotion.mjs';
const repository = 'example/persona_stand_ec2yml';
const revision = 'a'.repeat(40);
const good = { id: 20, run_attempt: 2, repository: { full_name: repository }, head_sha: revision,
  path: '.github/workflows/integration.yml', head_branch: 'main', event: 'push', status: 'completed', conclusion: 'success' };

test('release label is derived from the exact candidate marker', () => {
  assert.equal(releaseLabel('1.0.3-rc.2'), 'v1.0.3');
  assert.equal(releaseLabel('1.0.3'), 'v1.0.3');
  for (const value of ['latest', 'v1.0.3', '1.0.3-rc.0', '1.0.3\n']) assert.throws(() => releaseLabel(value));
});
test('chooses newest passing run for the current trusted coordinator commit', () => {
  assert.equal(chooseRun([{ ...good, id: 12 }, good, { ...good, id: 40, head_sha: 'b'.repeat(40) }], repository, revision).id, 20);
});
test('never substitutes a failed, running, foreign, PR or earlier-commit run', () => {
  for (const change of [{ conclusion: 'failure' }, { status: 'in_progress' }, { event: 'pull_request' },
    { head_sha: 'b'.repeat(40) }, { head_branch: 'dev' }, { path: '.github/workflows/other.yml' },
    { repository: { full_name: 'other/repo' } }]) {
    assert.throws(() => chooseRun([{ ...good, ...change }], repository, revision), /No passing/);
  }
});
function apiFor({ run = good, artifacts = [{ name: 'combined-test-results-20-2', expired: false }] } = {}) {
  return (endpoint, paginated) => {
    if (endpoint.includes('/workflows/')) {
      assert.ok(paginated);
      assert.ok(endpoint.includes('head_sha=' + revision));
      return [{ workflow_runs: [] }, { workflow_runs: [good] }];
    }
    if (endpoint.includes('/attempts/')) { assert.ok(endpoint.endsWith('/20/attempts/2')); return run; }
    assert.ok(paginated);
    return [{ artifacts }];
  };
}
test('uses paginated search and locks the exact attempt and artifact', () => {
  assert.deepEqual(discover(repository, revision, apiFor()), good);
});
test('missing, expired or wrong-attempt artifacts cannot fall back', () => {
  for (const artifacts of [[], [{ name: 'combined-test-results-20-2', expired: true }], [{ name: 'combined-test-results-20-1', expired: false }]]) {
    assert.throws(() => discover(repository, revision, apiFor({ artifacts })), /missing or expired/);
  }
});
test('changed attempt or status during lookup is rejected', () => {
  for (const run of [{ ...good, run_attempt: 3 }, { ...good, status: 'in_progress' }]) {
    assert.throws(() => discover(repository, revision, apiFor({ run })));
  }
});
test('API errors stop discovery without selecting other evidence', () => {
  assert.throws(() => discover(repository, revision, () => { throw new Error('access denied'); }), /access denied/);
});
test('downloaded evidence must match the full marker including rc suffix', () => {
  validateTarget(good, { releaseVersion: '1.0.3-rc.2' }, '1.0.3-rc.2', revision);
  for (const releaseVersion of ['1.0.3-rc.1', '1.0.2', undefined]) {
    assert.throws(() => validateTarget(good, { releaseVersion }, '1.0.3-rc.2', revision), /refusing fallback/);
  }
  assert.throws(() => validateTarget(good, { releaseVersion: '1.0.3-rc.2' }, '1.0.3-rc.2', 'b'.repeat(40)), /coordinator commit/);
});
