# Automated tests and releases

## Architecture and workflow

1. Every frontend/backend branch push runs its independent tests. PR events also test but do not publish.
2. Passing branch builds publish once to `ghcr.io/OWNER/persona_stand_front` or `persona_stand_back`, tagged `sha-FULL_COMMIT` and labelled with source repository and full SHA. Reruns reuse an existing commit image. Keep tags/images; new contents require a new commit.
3. ec2yml selects the two GHCR **digests** and source SHAs in `release-versions.json`. Push order is irrelevant; unchanged components retain their earlier digest.
4. One combined workflow runs the same Playwright suite for every selected pair, whether the update is minor or major. It starts both exact images on a GitHub-hosted runner with disposable PostgreSQL, fictional data and fake Gemini. No EC2 or ECR is needed.
5. Minor updates stop with GHCR images and test evidence. An approved major release copies the exact successfully tested images into ECR with digest preservation, without rebuilding.
6. EC2 deploys only the promoted ECR digests and writes a deployment record including the full promotion/test chain.

## File responsibilities

| File | Purpose |
| --- | --- |
| Application `.github/workflows/deploy.yml` | Independent checks, then GHCR publication for branch pushes. |
| Application `scripts/publish_image.py` | Build only absent commit images, reuse existing ones, emit `image.json`. |
| `release-versions.example.json` / `release-versions.json` | Example / your committed choice of two GHCR digests and source SHAs. |
| `.github/workflows/integration.yml` | The single minor/major combined test workflow. |
| `scripts/release.mjs`, `verify-images.mjs` | Validate immutable selection; pull images and verify source/revision labels. |
| `docker-compose.test.yml`, `tests/compose.env` | Isolated test services; ignore production .env. No image build steps. |
| `scripts/run-e2e.mjs`, `playwright.config.ts`, `tests/e2e/` | Start services, run browser journeys, record result and clean up. |
| `.github/workflows/promote.yml`, `scripts/promotion.mjs` | Explicit major approval, verify trusted successful run evidence, copy GHCR to ECR without changing digests. |
| `iam/promotion-*.json` | Restricted ECR copy permissions and production-environment OIDC trust templates. |
| `scripts/deploy_release.py`, `docker-compose.ec2.yml` | Validate promoted receipt, start only ECR images, record actual running digests. |

## Which file runs next?

| Your action | Execution sequence | Result |
| --- | --- | --- |
| Push frontend | `.github/workflows/deploy.yml` → lint / Vitest / build checks → `scripts/publish_image.py` → Dockerfile if that commit image is absent. | Commit-specific GHCR image and `image.json`. |
| Push backend | `.github/workflows/deploy.yml` → pytest with temporary PostgreSQL → `scripts/publish_image.py` → Dockerfile if that commit image is absent. | Commit-specific GHCR image and `image.json`. |
| Push the selected pair to ec2yml, or run its combined workflow manually | `integration.yml` → `release.mjs` → `verify-images.mjs` → checkout matching backend test support → `run-e2e.mjs` → `docker-compose.test.yml` → Playwright configuration and browser tests. | Pass/fail receipt plus reports; test containers are removed. |
| Approve a major release | `promote.yml` → retrieve successful run evidence → `promotion.mjs --check` → registry login → `promotion.mjs`. | Unchanged images copied to ECR; promotion receipt and deployment settings. |
| Deploy on EC2 | `deploy_release.py promotion.json` → validate receipt → `docker-compose.ec2.yml` pull / up → inspect running images. | Running ECR pair and a deployment record. |

Pushing either application repository does **not** automatically choose or test a pair in ec2yml. After both intended GHCR images exist, you update the coordinator selection or provide its four manual inputs. This deliberate coordination avoids testing half of a planned API change against an unintended older counterpart.

### Example: backend and frontend need an API change together

1. Push the backend change. Its independent tests pass and its GHCR image is published.
2. Push the matching frontend change. Its independent tests pass and its GHCR image is published.
3. Select both new digests and source SHAs in ec2yml. Run the combined suite once for that intended pair.
4. If it fails, fix the responsible repository, push a new commit and select its new digest. Do not overwrite the earlier image.
5. If it passes, keep the pair in GHCR for a minor update, or explicitly approve promotion for a major production release.

For a frontend-only change, step 3 uses the new frontend image and the existing intended backend image. That pair still receives the same browser suite.

For the button-by-button setup, use [Part A.6](Part_A.md#a6-automated-testing-and-github-actions--first-time-setup). For **Run workflow**, approval and artifact-download clicks, follow A.6.6 and A.6.10; for downloading and copying the approved files to EC2, use [Part C](Part_C.md#before-deployment-download-the-approved-release).

## Setup and select a pair

Follow [Part A.6](Part_A.md#a6-automated-testing-and-github-actions--first-time-setup), including package Actions access, optional private backend token and production promotion role. No AWS credentials are given to application publication or combined tests.

Download each application's `image.json` from its successful publishing run. Copy `release-versions.example.json` to `release-versions.json` and insert each `image` and `revision`. Commit and push the completed selection in ec2yml. Alternatively, supply all four inputs to **Actions → Combined browser tests → Run workflow**, or leave all blank to use the manifest. Missing or partial selections fail; no latest-tag fallback is used.

The image labels must match the selected commit/repository. Backend test support is checked out at that exact commit and mounted read-only; production images exclude tests and retain the normal production entrypoint. No application source is rebuilt by ec2yml.

Same-repository PRs and branch pushes run the suite; fork PRs run configuration checks only. A promotable receipt must come from a successful ec2yml **main push/manual** run, whose coordinator changes have been reviewed. This is the same suite, not a second major-only test workflow.

## Evidence and approval

`combined-test-results-RUN_ID-ATTEMPT` contains `selected-release.json`, browser reports/logs and `test-results/release-result.json`: status, both digests/SHAs, coordinator commit, repository, run ID and attempt. A failed or skipped run is never eligible.

To release, manually run **Approve major release and promote to ECR** on main, enter the successful run ID/attempt and release version (`v0.8.0` for example), and check the approval checkbox. The production environment supplies an additional review gate where configured. The workflow fetches that exact run attempt through GitHub's API and its named artifact, rejects mismatched/failed/untrusted evidence, and uses `skopeo copy --all --preserve-digests` for both images. It verifies destination digests before issuing `promotion.json` and `release-images.env`. No Docker build occurs. ECR release tags must be immutable.

Retain GHCR originals and immutable ECR release tags, plus downloaded evidence. Workflow artifacts have 90-day retention subject to repository settings. If evidence expires, rerun combined tests on the same images; never rebuild. A partially failed promotion can leave one copied image, but emits no successful receipt. Retry the same pair/label; never overwrite a label with other contents.

The trust boundary is your protected main branch, approved workflow and GitHub artifact provenance. Download promotion receipts from trusted successful runs, not arbitrary uploaded JSON. Manual administrators can bypass scripts or change files; this workflow does not cryptographically prevent an administrator from doing so.

## Run locally (PowerShell)

Prerequisites: Node 22.12+, Docker Desktop running, and all three repositories checked out as siblings. These commands are a local development rehearsal using disposable images from your working tree. They do not create promotable release evidence. The GitHub release workflow always pulls the selected GHCR digests and never runs these local build commands:

```powershell
# Run from persona_stand_ec2yml. The frontend needs its normal local
# VITE_CDN_BASE setting in ../persona_stand_front/.env before building.
docker build -t persona-test-frontend:local ../persona_stand_front
docker build -t persona-test-backend:local ../persona_stand_back
npm ci
npx playwright install chromium
$env:TEST_FRONTEND_IMAGE = 'persona-test-frontend:local'
$env:TEST_BACKEND_IMAGE = 'persona-test-backend:local'
npm run test:e2e
```

`BACKEND_TESTS_PATH` defaults to `../persona_stand_back/tests`. Override it if your checkout is elsewhere. `E2E_PORT` defaults to 18080; change it if busy. Each invocation has a unique Compose project. Do not run simultaneous invocations on the same frontend port.

The runner explicitly ignores your production `.env`, starts its own unexposed test database in temporary memory, waits for real database-backed API readiness, runs the browser tests, captures logs, and removes only its own containers/volumes. It never starts `docker-compose.ec2.yml`. The backend test support additionally rejects database URLs outside its test-name/host allowlist.

`npm test` checks release selection and promotion evidence; `python -m unittest discover -s scripts -p "test_*.py"` checks deployment validation. `npm run test:e2e:list` lists browser scenarios without starting services. `npm run test:e2e:report` opens the last browser report. Browser failures retain screenshots, videos and traces. `test-results/release-result.json` states pass/fail and the selected images; local working-tree runs are not CI release receipts.

## What the browser suite checks

- Homepage content from the real API; opening and closing a project; legacy navigation.
- Consent dismissal prevents sending; acceptance permits guest chat; reply and conversation reference survive refresh; withdrawal is enforced by the API.
- Privacy rejection remains marked after refresh.
- A simulated AI failure is marked not answered, and a later message can succeed.
- Invalid invite rejection, valid invite verification, restored verification after refresh, and the invite chat endpoint.

Every test uses fresh browser cookies/storage. Tests run sequentially with real pacing/rate controls enabled. API responses are not mocked. Only external model calls are replaced. CDN media requests are blocked to keep the suite independent of external availability. Uncaught browser exceptions fail the test.

This first suite uses Chromium. It does not certify CDN availability, production TLS/cookie settings, real Gemini quality, production database migrations, or all browser engines. Backend and frontend independent suites cover additional edge cases. Known held-message loss on navigating away before dispatch remains a documented product issue; these tests do not redefine dropped text as correct behavior.

## Deploy or roll back

Follow [Part C](Part_C.md). Download the successful promotion artifact, transfer `promotion.json` to EC2, log in to ECR using its existing read-only instance role, then run:

```sh
python3 scripts/deploy_release.py promotion.json
```

The script validates the GHCR/test/ECR chain, supplies ECR account, region and per-service digest to Compose, pulls and starts the pair, checks actual container image references and local repo digests, then saves `deployment-records/TIMESTAMP.json`. Keep that file off-instance with your release evidence. No production secret is written into the receipt. Running containers are not proof of live application health; perform Part C's browser/log checks.

Rollback uses a previous successful **promotion.json**, subject to database compatibility. Production Compose constructs ECR-only references; it has no GHCR or moving-tag fallback. Existing installations replace IMAGE_TAG / FRONTEND_IMAGE / BACKEND_IMAGE selection with the promotion receipt. No workflow automatically deploys EC2.

For breaking APIs, coordinate the pair and database migration. Already-open old browser clients can outlive a release; prefer backward-compatible transitions.
