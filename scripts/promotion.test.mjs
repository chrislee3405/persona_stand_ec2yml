import test from 'node:test';
import assert from 'node:assert/strict';
import { promote, validateEvidence } from './promotion.mjs';

const repository = 'example/persona_stand_ec2yml';
const selection = Object.fromEntries(['frontend', 'backend'].map((part, i) => [part, {
  image: `ghcr.io/example/persona_stand_${i ? 'back' : 'front'}@sha256:${String(i).repeat(64)}`,
  revision: String(i).repeat(40),
}]));
function evidence() {
  return [{ repository: { full_name: repository }, id: 123, run_attempt: 2,
    path: '.github/workflows/integration.yml', head_branch: 'main', event: 'push',
    status: 'completed', conclusion: 'success', head_sha: 'a'.repeat(40) },
  { status: 'passed', repository, runId: '123', runAttempt: '2', coordinatorRevision: 'a'.repeat(40),
    selectedRelease: structuredClone(selection), frontendImage: selection.frontend.image, backendImage: selection.backend.image }];
}
const validate = (run, receipt) => validateEvidence(run, receipt, selection, repository, '123', '2');
test('accepts the exact successful trusted attempt', () => assert.equal(validate(...evidence()), selection));
test('rejects failed, foreign, PR, other workflow and non-main runs', () => {
  for (const change of [{ conclusion: 'failure' }, { id: 456 }, { run_attempt: 1 },
    { head_branch: 'trial' }, { event: 'pull_request' }, { path: '.github/workflows/other.yml' },
    { repository: { full_name: 'attacker/repo' } }]) {
    const [run, receipt] = evidence();
    assert.throws(() => validate({ ...run, ...change }, receipt), /trusted main/);
  }
});
test('rejects stale, failed or substituted receipts', () => {
  for (const change of [{ status: 'failed' }, { runAttempt: '1' }, { coordinatorRevision: 'b'.repeat(40) },
    { frontendImage: selection.backend.image }, { selectedRelease: {} }]) {
    const [run, receipt] = evidence();
    assert.throws(() => validate(run, { ...receipt, ...change }));
  }
});
test('copies both exact digests without any build command', () => {
  const calls = [];
  const seen = new Set();
  const images = promote(selection, '123456789012.dkr.ecr.ap-southeast-2.amazonaws.com', 'v0.8.0', (cmd, args) => {
    calls.push([cmd, args]);
    if (args[0] === 'inspect' && !seen.has(args.at(-1))) {
      seen.add(args.at(-1));
      throw new Error('manifest unknown');
    }
    return JSON.stringify({ Digest: 'sha256:' + (args.at(-1).includes('/frontend') ? '0' : '1').repeat(64) });
  });
  assert.equal(calls.length, 6);
  assert.ok(calls.every(([cmd]) => cmd === 'skopeo'));
  assert.deepEqual(calls[1][1].slice(0, 4), ['copy', '--all', '--preserve-digests', 'docker://' + selection.frontend.image]);
  assert.equal(images.backend.ecrImage.split('@')[1], selection.backend.image.split('@')[1]);
});
test('fails if registry copy changes the digest or a copy fails', () => {
  let inspected = false;
  assert.throws(() => promote(selection, '123456789012.dkr.ecr.ap-southeast-2.amazonaws.com', 'v0.8.0', (_cmd, args) => {
    if (args[0] === 'inspect' && !inspected) { inspected = true; throw new Error('manifest unknown'); }
    return JSON.stringify({ Digest: 'wrong' });
  }), /differs/);
  assert.throws(() => promote(selection, '123456789012.dkr.ecr.ap-southeast-2.amazonaws.com', 'v0.8.0', () => { throw new Error('copy failed'); }), /copy failed/);
});
test('retries reuse identical ECR manifests and reject conflicting release tags', () => {
  let copies = 0;
  promote(selection, '123456789012.dkr.ecr.ap-southeast-2.amazonaws.com', 'v0.8.0', (_cmd, args) => {
    if (args[0] === 'copy') copies++;
    return JSON.stringify({ Digest: 'sha256:' + (args.at(-1).includes('/frontend') ? '0' : '1').repeat(64) });
  });
  assert.equal(copies, 0);
  assert.throws(() => promote(selection, '123456789012.dkr.ecr.ap-southeast-2.amazonaws.com', 'v0.8.0', () => JSON.stringify({ Digest: 'wrong' })), /already belongs/);
});
test('rejects injected release labels and non-ECR destinations', () => {
  for (const [registry, version] of [['ghcr.io/example', 'v0.8.0'], ['123456789012.dkr.ecr.ap-southeast-2.amazonaws.com', 'v0.8.0\nBAD']]) {
    assert.throws(() => promote(selection, registry, version, () => assert.fail('Must not execute')));
  }
});
