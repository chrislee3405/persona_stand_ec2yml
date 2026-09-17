import { readFileSync, writeFileSync, appendFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

// Keep user-supplied selections out of shell code and Docker flags. CI accepts
// only this project's GHCR repositories, pinned to immutable image contents.
export function validateRelease(release) {
  for (const part of ['frontend', 'backend']) {
    const value = release?.[part];
    const repository = part === 'frontend' ? 'persona_stand_front' : 'persona_stand_back';
    const imagePattern = new RegExp(`^ghcr\\.io/[a-z0-9][a-z0-9-]*/${repository}@sha256:[a-f0-9]{64}$`);
    if (!imagePattern.test(value?.image ?? '')) {
      throw new Error(`${part}.image must be a full GHCR ${repository} image pinned with @sha256:<64 hex characters>`);
    }
    if (!/^[a-f0-9]{40}$/.test(value?.revision ?? '')) {
      throw new Error(`${part}.revision must be the full 40-character Git commit SHA`);
    }
  }
  const registry = image => image.split('/')[1];
  if (registry(release.frontend.image) !== registry(release.backend.image)) {
    throw new Error('Select both images from the same GHCR owner');
  }
  return release;
}

export function readRelease() {
  const names = ['INPUT_FRONTEND_IMAGE', 'INPUT_FRONTEND_REVISION', 'INPUT_BACKEND_IMAGE', 'INPUT_BACKEND_REVISION'];
  if (names.some(name => process.env[name])) {
    return validateRelease({
      frontend: { image: process.env.INPUT_FRONTEND_IMAGE, revision: process.env.INPUT_FRONTEND_REVISION },
      backend: { image: process.env.INPUT_BACKEND_IMAGE, revision: process.env.INPUT_BACKEND_REVISION },
    });
  }
  try {
    return validateRelease(JSON.parse(readFileSync('release-versions.json', 'utf8')));
  } catch (error) {
    if (error.code === 'ENOENT') throw new Error('No release selected. Copy release-versions.example.json to release-versions.json and fill in published image digests and commits, or provide all four workflow inputs.');
    throw error;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const release = readRelease();
    writeFileSync('selected-release.json', JSON.stringify(release, null, 2) + '\n');
    if (process.env.GITHUB_OUTPUT) {
      appendFileSync(process.env.GITHUB_OUTPUT, `backend_revision=${release.backend.revision}\n`);
    }
    if (process.env.GITHUB_ENV) {
      appendFileSync(process.env.GITHUB_ENV, `TEST_FRONTEND_IMAGE=${release.frontend.image}\nTEST_BACKEND_IMAGE=${release.backend.image}\n`);
    }
    console.log('Selected immutable frontend/backend pair; wrote selected-release.json.');
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
