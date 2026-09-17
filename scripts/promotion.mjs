import { readFileSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { validateRelease } from './release.mjs';

export function validateEvidence(run, receipt, selection, repository, runId, attempt) {
  if (run.repository?.full_name !== repository || String(run.id) !== runId ||
      String(run.run_attempt) !== attempt || run.path !== '.github/workflows/integration.yml' ||
      run.head_branch !== 'main' || !['push', 'workflow_dispatch'].includes(run.event) ||
      run.status !== 'completed' || run.conclusion !== 'success') {
    throw new Error('Promotion requires a successful Combined browser tests run from trusted main');
  }
  validateRelease(selection);
  if (receipt.status !== 'passed' || receipt.repository !== repository ||
      receipt.runId !== runId || receipt.runAttempt !== attempt ||
      receipt.coordinatorRevision !== run.head_sha) throw new Error('Test receipt does not match the GitHub run');
  for (const part of ['frontend', 'backend']) {
    const expected = selection[part];
    if (receipt.selectedRelease?.[part]?.image !== expected.image ||
        receipt.selectedRelease?.[part]?.revision !== expected.revision ||
        receipt[`${part}Image`] !== expected.image ||
        expected.image.split('/')[1] !== repository.split('/')[0].toLowerCase()) {
      throw new Error('Test receipt and selected image pair differ');
    }
  }
  return selection;
}

export function promote(selection, registry, version, execute) {
  if (!/^\d{12}\.dkr\.ecr\.[a-z0-9-]+\.amazonaws\.com$/.test(registry)) throw new Error('Invalid ECR registry');
  if (!/^v\d+\.\d+\.\d+$/.test(version)) throw new Error('Release label must be vX.Y.Z');
  validateRelease(selection);
  const result = {};
  for (const part of ['frontend', 'backend']) {
    const source = selection[part];
    const digest = source.image.split('@')[1];
    const destination = `${registry}/persona_stand/${part}`;
    const tagged = `docker://${destination}:${version}`;
    let existing;
    try {
      existing = JSON.parse(execute('skopeo', ['inspect', tagged]));
    } catch (error) {
      const detail = String(error.stderr || error.message).toLowerCase();
      if (!detail.includes('manifest unknown') && !detail.includes('name unknown')) throw error;
    }
    if (existing && existing.Digest !== digest) throw new Error(`${part}: release tag already belongs to a different digest`);
    // ECR immutable tags reject attempts to reuse a release label for other contents.
    // --preserve-digests fails instead of silently converting the manifest.
    if (!existing) execute('skopeo', ['copy', '--all', '--preserve-digests', `docker://${source.image}`, tagged]);
    const info = JSON.parse(execute('skopeo', ['inspect', tagged]));
    if (info.Digest !== digest) throw new Error(`${part}: ECR digest differs from tested GHCR digest`);
    result[part] = { ...source, ecrImage: `${destination}@${digest}` };
  }
  return result;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const read = path => JSON.parse(readFileSync(path, 'utf8'));
  const { GITHUB_REPOSITORY: repository, TEST_RUN_ID: runId, TEST_RUN_ATTEMPT: attempt } = process.env;
  const run = read('test-run.json');
  const receipt = read('evidence/test-results/release-result.json');
  const selection = validateEvidence(run, receipt, read('evidence/selected-release.json'), repository, runId, attempt);
  // Check mode runs before obtaining AWS credentials.
  if (process.argv.includes('--check')) {
    console.log('Verified successful test evidence for', runId, attempt);
  } else {
    const images = promote(selection, process.env.ECR_REGISTRY, process.env.RELEASE_VERSION,
      (command, args) => execFileSync(command, args, { encoding: 'utf8' }));
    const promotion = { schemaVersion: 1, status: 'promoted', version: process.env.RELEASE_VERSION,
      promotedAt: new Date().toISOString(), images, combinedTest: receipt,
      testRunUrl: `https://github.com/${repository}/actions/runs/${runId}/attempts/${attempt}`,
      promotionRunUrl: `https://github.com/${repository}/actions/runs/${process.env.GITHUB_RUN_ID}/attempts/${process.env.GITHUB_RUN_ATTEMPT}`,
      requestedBy: process.env.GITHUB_ACTOR, coordinatorRevision: process.env.GITHUB_SHA };
    writeFileSync('promotion.json', JSON.stringify(promotion, null, 2) + '\n');
    writeFileSync('release-images.env', `ECR_ACCOUNT_ID=${process.env.ECR_REGISTRY.split(".")[0]}\nAWS_REGION=${process.env.ECR_REGISTRY.split(".")[3]}\nFRONTEND_DIGEST=${images.frontend.ecrImage.split("@")[1]}\nBACKEND_DIGEST=${images.backend.ecrImage.split("@")[1]}\n`);
  }
}
