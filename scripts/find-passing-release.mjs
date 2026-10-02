import { appendFileSync, readFileSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

export function releaseLabel(marker) {
  if (!/^[0-9]+\.[0-9]+\.[0-9]+(?:-rc\.[1-9][0-9]*)?$/.test(marker) || /\s/.test(marker)) {
    throw new Error('Invalid RELEASE_VERSION marker');
  }
  return 'v' + marker.split('-rc.')[0];
}

export function chooseRun(runs, repository, revision) {
  const eligible = runs.filter(run => run.repository?.full_name === repository &&
    run.path === '.github/workflows/integration.yml' && run.head_branch === 'main' &&
    run.head_sha === revision && ['push', 'workflow_dispatch'].includes(run.event) &&
    run.status === 'completed' && run.conclusion === 'success');
  eligible.sort((a, b) => b.id - a.id);
  const run = eligible[0];
  if (!run) throw new Error('No passing Combined browser tests for this main commit. Run the combined tests and retry; no older candidate will be selected.');
  if (!Number.isSafeInteger(run.id) || run.id < 1 || !Number.isSafeInteger(run.run_attempt) || run.run_attempt < 1) {
    throw new Error('Invalid run identity from GitHub');
  }
  return run;
}

export function discover(repository, revision, api) {
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repository) || !/^[a-f0-9]{40}$/.test(revision)) {
    throw new Error('Invalid coordinator repository or revision');
  }
  const pages = api(`repos/${repository}/actions/workflows/integration.yml/runs?branch=main&status=success&head_sha=${revision}&per_page=100`, true);
  const candidate = chooseRun(pages.flatMap(page => page.workflow_runs), repository, revision);
  // Fetch the exact attempt again, rather than trusting a stale list response.
  const run = api(`repos/${repository}/actions/runs/${candidate.id}/attempts/${candidate.run_attempt}`);
  chooseRun([run], repository, revision);
  if (run.id !== candidate.id || run.run_attempt !== candidate.run_attempt) throw new Error('Test run identity changed during selection');
  const artifacts = api(`repos/${repository}/actions/runs/${run.id}/artifacts?per_page=100`, true).flatMap(page => page.artifacts);
  const name = `combined-test-results-${run.id}-${run.run_attempt}`;
  const matches = artifacts.filter(artifact => artifact.name === name && !artifact.expired);
  if (matches.length !== 1) throw new Error('Matching test evidence is missing or expired. Rerun combined tests; no fallback evidence will be selected.');
  return run;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const marker = readFileSync('RELEASE_VERSION', 'utf8').trim();
  const version = releaseLabel(marker);
  const repository = process.env.GITHUB_REPOSITORY;
  const run = discover(repository, process.env.GITHUB_SHA, (endpoint, paginate = false) =>
    JSON.parse(execFileSync('gh', ['api', endpoint, ...(paginate ? ['--paginate', '--slurp'] : [])], { encoding: 'utf8' })));
  writeFileSync('test-run.json', JSON.stringify(run, null, 2) + '\n');
  appendFileSync(process.env.GITHUB_ENV, `TEST_RUN_ID=${run.id}\nTEST_RUN_ATTEMPT=${run.run_attempt}\nRELEASE_VERSION=${version}\n`);
  appendFileSync(process.env.GITHUB_STEP_SUMMARY,
    `### Selected release candidate\nMarker: **${marker}** → ECR **${version}**\n\n` +
    `[Combined tests, attempt ${run.run_attempt}](https://github.com/${repository}/actions/runs/${run.id}/attempts/${run.run_attempt})\n\n` +
    'The downloaded evidence must still pass exact marker, commit and image-pair validation before AWS access.\n');
}
