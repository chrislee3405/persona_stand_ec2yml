import test from 'node:test';
import assert from 'node:assert/strict';
import { validateRelease } from './release.mjs';

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
