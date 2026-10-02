# Automated tests and releases

## Architecture and workflow

1. Every frontend/backend branch push runs its independent tests. PR events also test but do not publish.
2. Passing branch builds publish once to `ghcr.io/OWNER/persona_stand_front` or `persona_stand_back`, tagged `sha-FULL_COMMIT` and `release-MARKER`, and labelled with source repository, full SHA and `RELEASE_VERSION`. Reruns reuse an existing commit image. Keep tags/images; new contents require a new commit.
3. All three repositories commit the same `RELEASE_VERSION` (initially `1.0.3-rc.1`). An ec2yml push waits up to 30 minutes for both matching published images, then automatically resolves their **digests** and source SHAs. Even a component without functional changes gets a marker-only commit and new tested image.
4. One combined workflow runs the same Playwright suite for every selected pair, whether the update is minor or major. It starts both exact images on a GitHub-hosted runner with disposable PostgreSQL, fictional data and fake Gemini. No EC2 or ECR is needed.
5. Minor updates stop with GHCR images and test evidence. An approved major release copies the exact successfully tested images into ECR with digest preservation, without rebuilding.
6. EC2 deploys only the promoted ECR digests and writes a deployment record including the full promotion/test chain.

## File responsibilities

| File | Purpose |
| --- | --- |
| Application `.github/workflows/deploy.yml` | Independent checks, then GHCR publication for branch pushes. |
| Application `scripts/publish_image.py` | Build only absent commit images, reuse existing ones, emit `image.json`. |
| `RELEASE_VERSION` | Shared candidate marker in all three repositories. |
| `scripts/resolve_release.py` | Wait for matching GHCR tags, validate version/source/revision and resolve digests. |
| `release-versions.example.json` / `release-versions.json` | Legacy local manual selection only; ignored by CI. |
| `.github/workflows/integration.yml` | The single minor/major combined test workflow. |
| `scripts/release.mjs`, `verify-images.mjs` | Validate immutable selection; pull images and verify version/source/revision labels. |
| `docker-compose.test.yml`, `tests/compose.env` | Isolated test services; ignore production .env. No image build steps. |
| `scripts/run-e2e.mjs`, `playwright.config.ts`, `tests/e2e/` | Start services, run browser journeys, check the logs for conversation content, record result and clean up. |
| `scripts/log-policy.mjs` | The logging a deployed backend may use, and the canary check of the collected container logs. |
| `.github/workflows/promote.yml`, `scripts/promotion.mjs` | Explicit major approval, verify trusted successful run evidence, copy GHCR to ECR without changing digests. |
| `iam/promotion-*.json` | Restricted ECR copy permissions and production-environment OIDC trust templates. |
| `scripts/deploy_release.py`, `docker-compose.ec2.yml` | Validate promoted receipt, start only ECR images, record actual running digests. |

## Which file runs next?

| Your action | Execution sequence | Result |
| --- | --- | --- |
| Push frontend | `.github/workflows/deploy.yml` → lint / Vitest / build checks → `scripts/publish_image.py` → Dockerfile if that commit image is absent. | Commit-specific GHCR image and `image.json`. |
| Push backend | `.github/workflows/deploy.yml` → pytest with temporary PostgreSQL → `scripts/publish_image.py` → Dockerfile if that commit image is absent. | Commit-specific GHCR image and `image.json`. |
| Push the shared marker to ec2yml main, or run its combined workflow manually | `integration.yml` → `resolve_release.py` → `release.mjs` → `verify-images.mjs` → checkout matching backend test support → `run-e2e.mjs` → `docker-compose.test.yml` → Playwright configuration and browser tests. | Pass/fail receipt plus reports; test containers are removed. |
| Approve a major release | `promote.yml` → retrieve successful run evidence → `promotion.mjs --check` → registry login → `promotion.mjs`. | Unchanged images copied to ECR; promotion receipt and deployment settings. |
| Deploy on EC2 | `deploy_release.py promotion.json` → validate receipt → `docker-compose.ec2.yml` pull / up → inspect running images. | Running ECR pair and a deployment record. |

Application pushes publish only after their tests pass. Your ec2yml push starts the combined workflow; it may arrive before the app builds finish. The resolver polls the exact shared marker and fails on timeout or invalid labels rather than choosing an earlier image. No cross-repository dispatch token or automated git push is needed.

### Updating a candidate

1. Set the same fresh marker, such as `1.0.3-rc.1`, in all three repositories.
2. Commit and push both applications, including a marker-only change when a component has no functional changes.
3. Commit the marker and version log to ec2yml main and push. CI waits for both images and tests the resolved pair.
4. For an application fix after publication, bump all three markers to `1.0.3-rc.2` and publish both again. Reusing a marker for a different source commit is rejected. Same-commit reruns reuse the original image.
5. Retain passing evidence for a test-only update, or explicitly approve production promotion. `1.0.3-rc.N` can be promoted as `v1.0.3`; a different base version is rejected.

For setup, use [Part A.6](Part_A.md#a6-automated-testing-and-github-actions--first-time-setup); for each release, use [Part C.0](Part_C.md#c0-automated-tests-for-every-update). Applications may use development branches; keep ec2yml on main. Existing package Actions access and the optional private backend checkout token still apply.

### Validation and reruns

No image/revision copying or local release validation is needed before the ec2yml push. CI uses `npm ci` for locked dependencies and validates its generated selection. These local commands remain useful when editing the release tooling. Generated selection files are ignored by Git; `release-versions.json` is a legacy local input only.

**Actions → Combined browser tests → Run workflow → main** uses that revision's marker with no manual image fields. If a build takes longer than 30 minutes, rerun after it publishes. To test an older marker, rerun its original main workflow run. Retain both its tags and images. Publication jobs are serialized within each app repository; rerun an intended publication if a newer queued run cancelled it.

Image labels must match the marker, source repository and full revision. The resolver verifies digest-addressed metadata too; Docker verifies labels again after pulling. Backend test support is checked out at that revision and mounted read-only. No application image is rebuilt by ec2yml. Tests use fake Gemini, so passing them does not establish live model answer quality.

Same-repository PRs and branch pushes run the suite; fork PRs run configuration checks only. Promotion requires a successful **main push/manual** run. Marker reuse protection is enforced by these scripts, not registry-level GHCR tag immutability; restrict package writers and preserve published tags.

## Evidence and approval

`combined-test-results-RUN_ID-ATTEMPT` contains `selected-release.json`, browser reports/logs and `test-results/release-result.json`: status, shared release marker, both digests/SHAs, coordinator commit, repository, run ID and attempt. A failed or skipped run is never eligible.

To release, manually run **Approve major release and promote to ECR** on main, enter the successful run ID/attempt and release version (`v1.0.3` for a `1.0.3-rc.N` candidate), and check the approval checkbox. The production environment supplies an additional review gate where configured. The workflow fetches that exact run attempt through GitHub's API and its named artifact, rejects mismatched/failed/untrusted evidence, and uses `skopeo copy --all --preserve-digests` for both images. It verifies destination digests before issuing `promotion.json` and `release-images.env`. No Docker build occurs. ECR release tags must be immutable.

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

`npm test` checks release selection, promotion evidence and the log policy; `python -m unittest discover -s scripts -p "test_*.py"` checks marker resolution and deployment validation, including rendering the real `docker-compose.ec2.yml` and refusing a `LOG_LEVEL=DEBUG` instance `.env` (skipped when Docker is unavailable). `npm run test:e2e:list` lists browser scenarios without starting services. `npm run test:e2e:report` opens the last browser report. Browser failures retain screenshots, videos and traces. `test-results/release-result.json` states pass/fail and the selected images; local working-tree runs are not CI release receipts.

## What the browser suite checks

- Homepage content from the real API; opening and closing a project; legacy navigation.
- Consent dismissal prevents sending; acceptance permits guest chat; reply and conversation reference survive refresh; withdrawal is enforced by the API.
- Privacy rejection remains marked after refresh.
- A simulated AI failure is marked not sent, and a later message can succeed.
- Invalid invite rejection, valid invite verification, restored verification after refresh, and the invite chat endpoint.
- **No conversation content in the logs** (`tests/e2e/log-hygiene.spec.ts` plus `run-e2e.mjs`):
  - Before starting anything, the runner reads the backend's `LOG_LEVEL` and `CHAT_TRACE` from `docker-compose.ec2.yml` itself. It fails immediately if they would log conversations (anything below `INFO`, or `CHAT_TRACE` on).
  - The test backend then runs with exactly those settings, so what is tested is the deployment's logging, not a development default.
  - The spec sends a chat message containing a random canary word through the real UI, nginx and the full reply pipeline.
  - Afterwards the runner confirms the canary reached the database, so the check cannot pass vacuously. It then fails the run if the canary, or any record from the backend's `app.chat_trace` logger, appears in any container's logs.
  - The same rule is enforced again on EC2, where `deploy_release.py` refuses to deploy if the rendered configuration, `.env` included, would log at `DEBUG` or with `CHAT_TRACE` on.

Every test uses fresh browser cookies/storage. Tests run sequentially with real pacing/rate controls enabled. API responses are not mocked. Only external model calls are replaced. CDN media requests are blocked to keep the suite independent of external availability. Uncaught browser exceptions fail the test.

This first suite uses Chromium. It does not certify CDN availability, production TLS/cookie settings, real Gemini quality, production database migrations, or all browser engines. Backend and frontend independent suites cover additional edge cases. Known held-message loss on navigating away before dispatch remains a documented product issue; these tests do not redefine dropped text as correct behavior.

## Deploy or roll back

Follow [Part C](Part_C.md). Download the successful promotion artifact, transfer `promotion.json` to EC2, log in to ECR using its existing read-only instance role, then run:

```sh
python3 scripts/deploy_release.py promotion.json
```

The script validates the GHCR/test/ECR chain, supplies ECR account, region and per-service digest to Compose, pulls and starts the pair, checks actual container image references and local repo digests, then saves `deployment-records/TIMESTAMP.json`. Keep that file off-instance with your release evidence. No production secret is written into the receipt. Running containers are not proof of live application health; perform Part C's browser/log checks.

Rollback uses a previous successful **promotion.json**, subject to database compatibility. Production Compose constructs ECR-only references; it has no GHCR or moving-tag fallback. No workflow automatically deploys EC2.

For breaking APIs, coordinate the pair and database migration. Already-open old browser clients can outlive a release; prefer backward-compatible transitions.
