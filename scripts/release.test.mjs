import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { validateRelease, readRelease } from './release.mjs';

function pair() {
  return Object.fromEntries(['frontend', 'backend'].map(part => [part, {
    image: `ghcr.io/example/persona_stand_${part === 'frontend' ? 'front' : 'back'}@sha256:${'a'.repeat(64)}`,
    revision: 'b'.repeat(40),
  }]));
}

test('accepts independent commits pinned to immutable images', () => {
  const release = pair();
  release.backend.revision = 'c'.repeat(40);
  assert.equal(validateRelease(release), release);
});
test('rejects moving tags and shortened commits', () => {
  const tagged = pair();
  tagged.frontend.image = tagged.frontend.image.replace(/@sha256:.*/, ':main');
  assert.throws(() => validateRelease(tagged), /pinned/);
  const short = pair();
  short.backend.revision = 'abcdef';
  assert.throws(() => validateRelease(short), /40-character/);
});
test('rejects mismatched repositories, registries, and injected newlines', () => {
  const wrong = pair();
  wrong.frontend.image = wrong.backend.image;
  assert.throws(() => validateRelease(wrong), /frontend.image/);
  const other = pair();
  other.backend.image = other.backend.image.replace('example', 'another');
  assert.throws(() => validateRelease(other), /same GHCR/);
  const injection = pair();
  injection.backend.revision += '\nEVIL=value';
  assert.throws(() => validateRelease(injection), /40-character/);
});

test('validates the optional shared release marker', () => {
  assert.equal(validateRelease({ ...pair(), releaseVersion: '1.0.3-rc.1' }).releaseVersion, '1.0.3-rc.1');
  for (const releaseVersion of ['latest', 'v1.0.3', '1.0.3-rc.0', '1.0.3\nBAD']) {
    assert.throws(() => validateRelease({ ...pair(), releaseVersion }), /releaseVersion/);
  }
});

function withResolved(value, check) {
  const directory = mkdtempSync(join(tmpdir(), 'release-resolver-'));
  const originalCwd = process.cwd();
  const originalInput = process.env.RELEASE_SELECTION_FILE;
  try {
    process.chdir(directory);
    writeFileSync('RELEASE_VERSION', '1.0.3-rc.1\n');
    writeFileSync('resolved-release.json', JSON.stringify(value));
    writeFileSync('release-versions.json', 'invalid legacy selection must be ignored');
    process.env.RELEASE_SELECTION_FILE = 'resolved-release.json';
    check();
  } finally {
    process.chdir(originalCwd);
    if (originalInput === undefined) delete process.env.RELEASE_SELECTION_FILE;
    else process.env.RELEASE_SELECTION_FILE = originalInput;
    rmSync(directory, { recursive: true, force: true });
  }
}

test('CI consumes the resolved pair instead of the old local selection', () => {
  const marked = { ...pair(), releaseVersion: '1.0.3-rc.1' };
  withResolved(marked, () => assert.deepEqual(readRelease(), marked));
});

test('CI rejects missing or stale coordinator markers', () => {
  for (const value of [pair(), { ...pair(), releaseVersion: '1.0.2' }]) {
    withResolved(value, () => assert.throws(() => readRelease(), /coordinator RELEASE_VERSION/));
  }
});
