# Part C — Deployment & Ongoing Operations 🔁

## C.0 Automated tests for every update

Complete the one-time GitHub/package/IAM setup in [Part A.6](Part_A.md#a6-automated-testing-and-github-actions--first-time-setup) first.

| Update | Repeat these steps | End result |
| --- | --- | --- |
| Test a candidate | C.0.1 set the shared marker and publish both applications → C.0.2 automatically resolve and test the matching pair. | Tested images stay in GHCR; production is unchanged. |
| Release to production | The same tests → C.0.3 approved promotion → C.0.4 transfer → C.1 or C.2 deployment. | The exact tested images are copied to ECR and deployed on EC2. |

The existing workflow is called **Approve major release and promote to ECR**; it can promote an approved patch release such as `v1.1.0` too. The approval and deployment steps are explicit for every production release.

### C.0.1 Push application changes with a shared release marker

1. **Local machine:** put the same value in the root `RELEASE_VERSION` file in **all three repositories**. This update starts with `1.1.0-rc.1`. Keep one line with no `v` prefix. The candidate suffix distinguishes builds while the public app version remains `v1.1.0`.
2. Commit and push both application repositories, including their markers. Even if only the backend has functional changes, the frontend needs its marker-only commit, tests and new image. The application repositories can use your existing development branches.
3. Both application workflows run independent tests before publishing GHCR images. Each image has a `sha-FULL_COMMIT` tag and a `release-1.1.0-rc.1` tag, plus source repository, source revision and version labels. Push order does not matter.
4. In GitHub **Actions**, check **Test and publish frontend** and **Test and publish backend**. Their summaries and `image.json` artifacts remain available for inspection; you no longer copy their digests or revisions into ec2yml.

**Every new candidate needs a fresh marker.** After any further application commit, use `1.1.0-rc.2` in all three repositories, then `.3`, and so on. This includes marker-only or documentation-only commits in an application repository once its earlier marker was published. Do not reuse a published marker for another commit. Rerunning the same commit reuses its image; partial publication can finish on a rerun. Publication is serialized within each application repository to prevent concurrent marker writes. If a queued publication is cancelled by a newer run, rerun the intended application workflow.

Keep published commit and release tags. The scripts reject conflicting marker reuse; GHCR tags are not themselves immutable against manual administrator changes. Restrict package write access and do not overwrite or delete release images.

### C.0.2 Select the pair and run combined tests — minor and major

1. **Local machine, ec2yml:** review the matching `RELEASE_VERSION`, update the version log, then commit and push to **main**. Keep ec2yml on its existing main branch. There are no image references or commit hashes to paste.
2. You may push ec2yml before the application builds finish. **Combined browser tests** waits up to 30 minutes for both `release-MARKER` GHCR images. Missing images cause waiting; wrong labels, denied access and other registry errors fail the run. It never falls back to `latest` or a previous version.
3. The resolver checks version/source/revision labels, obtains both immutable digests, and generates `selected-release.json`. The workflow pulls and checks the images again, checks out matching backend test support, and tests that exact pair.
4. **Browser, GitHub:** open ec2yml **Actions → Combined browser tests → your run**. Both `configuration` and `combined-browser` must pass. A timeout means checking application CI and rerunning the combined workflow once both images are available; it does not deploy anything.
5. Open **Summary → Artifacts → combined-test-results-RUN_ID-ATTEMPT**. Download and extract the artifact. `selected-release.json` records the shared marker, digests and source revisions; `test-results/release-result.json` must say `passed` and identify that pair, coordinator commit, run ID and attempt.

**No local `npm ci` or `npm run release:validate` is required just to submit a release.** GitHub installs the locked test dependencies with `npm ci` and validates the automatically resolved pair in CI. Keep local checks when editing workflow/test code. `release-versions.json` and its example are retained only for legacy local manual checks; CI ignores them. Generated `resolved-release.json` and `selected-release.json` are not committed.

**To rerun manually:** ensure the workflow is on the default branch, open **Actions → Combined browser tests → Run workflow**, choose **main**, then click the green **Run workflow** button. There are no image/commit input fields. It uses the marker from the selected coordinator revision. To retest an older candidate without source changes, rerun its original main workflow run while the images still exist.

Only successful main push/manual runs can be promoted. Same-repository PRs can test; fork PRs get configuration checks only. Application pushes do not push or edit ec2yml automatically: your ec2yml push starts coordination.

If a combined test fails and an application needs a code fix, increment the candidate marker in all three repositories and repeat. If only the coordinator tests/configuration need fixing, its new main commit may retest the same unchanged application pair. For a test-only update, stop here. For production, continue to C.0.3. Artifacts are retained for 90 days subject to repository settings; download evidence for longer retention.

### C.0.3 Approve and promote a major release

**Prerequisite:** complete C.0.1–C.0.2 with a successful combined run from ec2yml main. Minor and major updates use the same suite. The current ec2yml main commit must have a successful push/manual run with retained evidence; otherwise run the same suite on that commit with the matching images. Never rebuild a tested image for promotion.

**Where: your browser, GitHub.**

1. Click ec2yml **Actions** → **Combined browser tests** → the successful main run for your intended pair. Click **Summary** and confirm both jobs passed.
2. Confirm the current ec2yml main commit has passed combined tests. Promotion automatically finds its newest successful trusted run and exact attempt; there is no run ID to copy.
3. Click **Actions** again. In the left sidebar, click **Approve major release and promote to ECR**. Click **Run workflow** above the run list.
4. In the panel, open **Branch** and select `main`. The release label is derived from `RELEASE_VERSION` (`1.1.0-rc.1` becomes `v1.1.0`); there are no run-ID, attempt or version fields. Check **I approve copying this tested pair to production ECR**. Click the green **Run workflow** button inside the panel.
5. Click the newly created run. If it is waiting for environment approval, click **Review deployments**, select the checkbox beside **production**, review the test result, and click **Approve and deploy**. Despite that GitHub button's wording, this workflow only promotes images to ECR; it does not deploy to EC2.
6. Wait for the `promote` job to show a green checkmark. It validates evidence, copies both images with digest preservation and verifies the ECR digests; no build occurs. If it fails, click **promote**, then the red failed step to read its log.
7. Click **Summary**, scroll to **Artifacts**, and click `promoted-release-VERSION-RUN_ID-ATTEMPT`. Extract the downloaded ZIP and keep `promotion.json`, `release-images.env` and the included test evidence together. Continue to C.0.4 to transfer the files, then C.1 for first deployment or C.2 for redeployment.

The workflow requires the downloaded evidence to match the complete candidate marker and current ec2yml commit before obtaining AWS credentials. Its job summary links the selected test run. If tests are missing, unfinished or failed, or evidence is expired/mismatched, promotion stops without selecting an older candidate. After any new ec2yml commit, wait for its combined tests to pass; an application rebuild is unnecessary if the marker and app pair are unchanged.

A failed copy does not create a successful receipt. One image may already have copied; rerun with the same pair and label. Never reuse a label for different contents. Promotion does not automatically restart EC2.

### C.0.4 Download and transfer the approved release

**Where: your browser, GitHub.** If you have not promoted a release yet, follow [C.0.3](#c03-approve-and-promote-a-major-release) first.

1. Open `persona_stand_ec2yml` on GitHub and click the **Actions** tab.
2. In the left sidebar, click **Approve major release and promote to ECR**.
3. Click the successful run for your approved release. Confirm its `promote` job has a green checkmark. If it failed, click the job name and expand the failed step; do not use files from a failed run.
4. Click **Summary** in the left sidebar. Scroll down to **Artifacts**.
5. Click the artifact named `promoted-release-VERSION-RUN_ID-ATTEMPT`. This downloads a ZIP to your computer; it does not send anything to EC2.
6. **Windows File Explorer:** open **Downloads**, right-click the ZIP, click **Extract All…**, choose a destination and click **Extract**. Open the extracted folder and confirm it contains `promotion.json` and `release-images.env`. Keep the rest of the evidence too.
7. Open `promotion.json` in your text editor to check the release version, source commits and image pair. Close it without editing. Transfer the files only after `~/app` exists on EC2 (created in C.1 below).

**Where: your local PowerShell terminal, after extraction and EC2 folder creation.** Run the following, replacing the key/file paths and IP with your actual values. Your Ubuntu EC2 instance uses the SSH login name `ubuntu`.

```powershell
scp -i "C:/path/to/your-key.pem" "C:/path/to/extracted/promotion.json" "C:/path/to/extracted/release-images.env" ubuntu@<ec2-public-ip>:~/app/
```

Press **Enter** to run it. If this is your first SSH connection, verify the host fingerprint against your trusted connection information before accepting it. A completed transfer returns to the terminal prompt. In your **EC2 SSH terminal**, run `ls -l ~/app/promotion.json ~/app/release-images.env` to confirm both files arrived. SCP is a terminal command, not a button on GitHub or AWS.

For an existing server, use your normal SSH connection. If you normally connect through AWS's browser console, click **EC2 → Instances**, select your instance's checkbox, click **Connect**, select **EC2 Instance Connect**, verify the username, then click **Connect**. This option requires the instance's existing networking and connection permissions to support it; it does not replace the file transfer above.

## C.1 First Deployment to a New EC2 Instance
Run in EC2 instance terminal
```bash
mkdir -p ~/app && cd ~/app
git clone https://github.com/<you>/persona_stand_ec2yml.git .
nano .env
```

Run in EC2 instance terminal — paste into the `.env` file you just opened with `nano`
```env
DATABASE_URL=postgresql://<master-username>:<master-password>@<rds-endpoint>:5432/<db-name>
SESSION_SECRET_KEY=<long-random-string — see below>
GCP_PROJECT_ID=<project-id-or-number-matching-what-your-code-expects>
AWS_REGION=ap-southeast-2
# HTTPS -- leave these out until Part A, "HTTPS with Let's Encrypt", says to add them:
# TLS_DOMAIN=<your-domain>
# SESSION_COOKIE_SECURE=true
# HSTS_MAX_AGE=31536000
```
Save with `Ctrl+O → Enter → Ctrl+X`.

`LOG_LEVEL` defaults to `INFO` in `docker-compose.ec2.yml`, and `scripts/deploy_release.py` refuses to deploy at `DEBUG`. Explicit prompt/reply tracing requires `CHAT_TRACE`, which the deploy script refuses. SQL parameters are hidden and exception diagnostics omit exception bodies; failure-path canary tests check this boundary. Do not log arbitrary exception values or request bodies through ordinary log messages. To debug a live problem, reproduce it locally (Part B) with `CHAT_TRACE=true` in the backend's local `.env`.

⚠️ `SESSION_SECRET_KEY` is **required** — the backend reads it with `os.environ[...]` and exits immediately with `KeyError: 'SESSION_SECRET_KEY'` if it is missing, which shows up as a container that restarts forever. Generate one on your local machine and paste it in:

Run in Local machine terminal
```bash
python -c "import secrets; print(secrets.token_urlsafe(48))"
```

This key signs the session cookie, which is what carries a visitor's consent record and invite-code verification. **Changing it logs every visitor out** — existing cookies stop validating, so consent has to be given again and any verified invite session is dropped. Set it once and keep it; do not regenerate it on each deploy.

Before deploying, follow C.0.3 to approve and promote a successful GHCR pair. Download the artifact from that **successful promotion run**, not from the combined-test run. Transfer its `promotion.json` and `release-images.env` to `~/app` on EC2 (for example using your usual SCP/SFTP client). Keep the original artifact as release evidence. Do not edit these generated files or accept receipts from an untrusted source.

`release-images.env` contains ECR_ACCOUNT_ID, AWS_REGION, FRONTEND_DIGEST and BACKEND_DIGEST. Production Compose constructs only ECR references. Keep database/session/GCP secrets in `.env`.

The deployment script needs Python 3 and Docker Compose with `up --wait`. If Python is missing on Amazon Linux, install it with `sudo dnf install -y python3`. The existing EC2 instance role supplies ECR read access; no GHCR login is needed.

⚠️ `DATABASE_URL` here must point **directly at the RDS endpoint on port 5432** — not the local compose database from Part B (`db:5432`) or an SSH tunnel address. Omitting this variable entirely stops the backend at startup with `RuntimeError: DATABASE_URL is not set`.

⚠️ **A new database has no consent policy, invite codes or persona data.** The chatroom refuses every message until a consent policy row exists — see Part D.2, *Seed the consent policy, invite codes and persona data*.

> **There is no `VITE_API_URL`.** Earlier versions of this guide listed one. The frontend calls relative `/api/...` paths and nginx proxies them to the backend container, so no API URL is configured anywhere — and it could not be set at runtime even if it were needed, because Vite inlines `VITE_*` values at **build** time, inside the Docker build in GitHub Actions.

Run in EC2 instance terminal
```bash
aws ecr get-login-password --region ap-southeast-2 | docker login --username AWS --password-stdin <AWS_ACCOUNT_ID>.dkr.ecr.ap-southeast-2.amazonaws.com # for every 12 hours restart
python3 scripts/deploy_release.py promotion.json
```

Run in EC2 instance terminal
```bash
docker ps -a
docker compose --env-file .env --env-file release-images.env -f docker-compose.ec2.yml logs -f
```
The app should be reachable at `http://<ec2-public-ip>` — **Where: your local machine's browser**. Once HTTPS is set up (Part A, *HTTPS with Let's Encrypt*), use `https://<your-domain>` instead.

## C.2 Every Redeploy
For a minor update, stop after the combined tests: nothing needs changing on EC2. For an approved major release:

1. Run the same combined workflow for the intended GHCR pair on ec2yml main.
2. Manually approve and run promotion on main; it automatically selects matching passing evidence (C.0.3).
3. Follow **C.0.4 Download and transfer the approved release** above: click the successful promotion run → **Summary** → its artifact name, extract the ZIP, verify the release, then use the local SCP command to transfer `promotion.json` and `release-images.env` to `~/app`.
4. Back up production data before deploying. For an existing database, stop the old backend before schema changes and apply the selected backend release's SQL migrations. For this release these are `20260917_site_media.sql` (if the media rename is outstanding) and `20260920_conversation_last_handled_index.sql`. Follow that release's `scripts/migrations/README.md`, using `psql -v ON_ERROR_STOP=1` and the intended PostgreSQL connection. Do not run the old backend after the cursor backfill. Fresh databases get the current schema at startup. Preserve the accepted behavior of already-migrated legacy cursors; do not reset them as part of redeployment.
5. Run the commands below. The script validates the receipt, pulls only ECR digests, starts both services, verifies their actual image references, and writes `deployment-records/TIMESTAMP.json` with the full source-to-deployment chain.
6. Confirm `/api/health/ready` returns 200 (required database schema is readable), then test a new guest conversation and an invite conversation. A schema failure prevents backend startup; `/docs` is not a readiness check. Save that deployment record alongside the original promotion/test evidence off the EC2 instance. Open the live site, check consent and chat, and inspect logs. Running containers alone do not establish full application health.

Run in EC2 instance terminal
```bash
cd ~/app
git pull
aws ecr get-login-password --region ap-southeast-2 | docker login --username AWS --password-stdin <AWS_ACCOUNT_ID>.dkr.ecr.ap-southeast-2.amazonaws.com
python3 scripts/deploy_release.py promotion.json
docker ps -a
```

### Rolling back a bad deploy

Retrieve a previous successful **promotion.json** and its `release-images.env`, confirm that the previous application pair remains compatible with the current database schema, and copy both to EC2. Log in to ECR, then run `python3 scripts/deploy_release.py promotion.json`. This records the rollback as another deployment of the original tested/promoted digests. Never rebuild old source to make a rollback image.

Run in EC2 instance terminal
```bash
python3 scripts/deploy_release.py promotion.json
```

This restores the selected pair. A subsequent release should use another
successfully tested pair of immutable image references.

## C.3 After EC2 Stop/Start (public IP changes, unless using an Elastic IP)

- **Nothing in `.env` needs changing.** The frontend talks to the backend over the compose network by service name, and `DATABASE_URL` targets RDS's stable endpoint — neither depends on the instance's public IP. (This step used to say to update `VITE_API_URL`; that variable does not exist. See C.1.)
- Update your local SSH tunnel command with the new IP **— Where: Local machine terminal** (Part D.2, *Connect to the database*)
- Browse to the new public IP. If you want the address to stop changing, attach an Elastic IP **— Where: AWS Console → EC2 → Elastic IPs**
- With HTTPS set up, the instance must keep its Elastic IP: the domain's DNS record points at it, and certificate renewals fail if the domain no longer reaches this instance.

## C.4 Troubleshooting Reference

### Automated tests and promotion

| Symptom | Check |
| --- | --- |
| GHCR publication denied | packages-write, organisation policy, existing package publishing access. |
| GHCR pull denied | Both packages grant ec2yml Actions read access. |
| Private source checkout denied | BACKEND_READ_TOKEN scope, expiry and approval. |
| Matching images unavailable | Check that all three markers match, both application tests/publications passed and the packages grant read access. Rerun after publication; never substitute an older tag. |
| Release marker already used | Increment the candidate suffix in all three repositories and publish both applications. |
| Promotion rejects evidence | Successful main push/manual run for the current coordinator commit, exact candidate marker and unexpired artifact. No older-version fallback. |
| AWS AssumeRole denied | Environment branch rule, exact ARN and trust subject. |
| Existing ECR tag conflict | Retries must use the same pair; new contents need a new release label. |
| Digest changes during copy | Stop; diagnose registry/tool handling. Do not deploy or rebuild. |

Tests use temporary PostgreSQL, fake Gemini and blocked media. Live TLS, real AI quality, CDN availability and production migrations still need separate checks.

### EC2 deployment

*(All diagnostic commands referenced below are run on the **EC2 instance via SSH**, unless the symptom is purely visual, in which case it's observed in your **local machine's browser**.)*

| Symptom | Likely cause |
|---|---|
| `docker login` fails | ECR region mismatch, expired/missing AWS credentials, or missing IAM permissions |
| `pull` fails with "not found" | Check the ECR digests from the successful promotion artifact, ECR retention and instance-role permissions |
| Frontend can't reach backend | The backend container is not running — nginx proxies `/api/` to it by service name, so check `docker compose --env-file .env --env-file release-images.env -f docker-compose.ec2.yml ps` and the backend's logs first |
| Backend restarts forever, `KeyError: 'SESSION_SECRET_KEY'` in the log | `SESSION_SECRET_KEY` missing from `.env` on the instance — see C.1 |
| `deploy_release.py` stops with `Refusing to deploy: backend LOG_LEVEL must be one of INFO, WARNING, ERROR` or `CHAT_TRACE is on` | `.env` on the instance sets `LOG_LEVEL=DEBUG` (or something unrecognised), or `CHAT_TRACE` was added to `docker-compose.ec2.yml`. Both would write visitor conversations to the logs. Remove the line and deploy again |
| Deployed but the site shows the wrong version | Confirm both image references match the intended successful test receipt, then pull and recreate the containers |
| Backend container unhealthy, `curl: not found` in health log | Base image lacks `curl` — install it in the Dockerfile's runtime stage (edited on **local machine**, rebuilt via GitHub Actions), or switch the health check to `wget` |
| Frontend unhealthy, `wget: can't connect... Connection refused` | nginx listens on **8080** inside the container (IPv4 and IPv6), not 80 — a health check or `curl` against `:80` inside the container finds nothing. The image's own health check targets `127.0.0.1:8080/healthz` |
| Frontend restarts forever after `TLS_DOMAIN` was set; `docker logs persona_frontend` says `TLS_DOMAIN is set but /etc/nginx/certs/fullchain.pem is missing` | The certificate was never issued, or the deploy hook did not copy it into `~/app/certs`. Rerun Part A, *HTTPS with Let's Encrypt*, step 6, or remove `TLS_DOMAIN` from `.env` to serve plain HTTP |
| Every chat message returns 403 and consent never sticks, though the site itself loads | `SESSION_COOKIE_SECURE=true` while the site is reached over plain `http://`: browsers never send a Secure cookie over HTTP. Use `https://<your-domain>`, or set it back to `false` until HTTPS works |
| Browser warns the certificate is invalid or for a different site | The site was opened by IP address, or by a name the certificate doesn't cover. The certificate covers exactly `TLS_DOMAIN`; open `https://<your-domain>` |
| `certbot renew --dry-run` fails with a challenge or timeout error | Port 80 is closed in the security group, the domain no longer points at this instance's Elastic IP, or the frontend container is down. Renewals are fetched over plain HTTP on port 80 |
| Backend exits at startup with `RuntimeError: DATABASE_URL is not set` | `DATABASE_URL` missing from `.env` on the instance (the compose file reads it from there) |
| Chatroom says "Consent terms are currently unavailable" and every message is refused | No row in `consent_policy`, or its `condition_text` is malformed — see Part D.2, *Seed the consent policy, invite codes and persona data* |
| `could not translate host name "host.docker.internal"` on EC2 | Local-dev-only `DATABASE_URL` value got copied into EC2's `.env` — use the real RDS endpoint on port 5432 instead |
| `RefreshError: Unable to retrieve AWS region` | `gcp-wif-config.json` is missing `imdsv2_session_token_url` in `credential_source` |
| `403 PERMISSION_DENIED: iam.serviceAccounts.getAccessToken` despite roles being granted in console | The AWS role ARN in the GCP IAM binding doesn't match the EC2 instance's *actual* attached role — verify via instance metadata (EC2 via SSH), not by typing/guessing |
| Can't load app in browser | Security group isn't allowing inbound HTTP on port 80 (or HTTPS on 443, once HTTPS is on) — check in **AWS Console (browser)** |
| Accidentally ran the wrong `docker-compose.yml` on EC2 | `docker system prune -f` **— Where: EC2 instance (via SSH)**, then redeploy correctly |
| EC2 container status unhealthy & Inspect EC2 debug print | run "docker compose --env-file .env --env-file release-images.env -f docker-compose.ec2.yml logs --tail=100 backend" to inspect the debut log|