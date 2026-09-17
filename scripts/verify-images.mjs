import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { validateRelease } from './release.mjs';

const release = validateRelease(JSON.parse(readFileSync('selected-release.json', 'utf8')));
for (const part of ['frontend', 'backend']) {
  const selected = release[part];
  execFileSync('docker', ['pull', selected.image], { stdio: 'inherit' });
  const [image] = JSON.parse(execFileSync('docker', ['image', 'inspect', selected.image], { encoding: 'utf8' }));
  const source = image.Config?.Labels?.['org.opencontainers.image.source'];
  const expectedSource = 'https://github.com/' + selected.image.split('@')[0].replace('ghcr.io/', '');
  if (source?.toLowerCase() !== expectedSource) throw new Error(`${part} source repository does not match its GHCR path`);
  const revision = image.Config?.Labels?.['org.opencontainers.image.revision'];
  if (revision !== selected.revision) {
    throw new Error(`${part} image revision ${revision ?? '(missing label)'} does not match selected commit ${selected.revision}`);
  }
  console.log(`${part}: verified image revision ${revision}`);
}
