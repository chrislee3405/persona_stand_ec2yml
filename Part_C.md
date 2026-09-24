# Part C — Deployment & Ongoing Operations 🔁

## C.0 Automated tests for every update

Complete the one-time GitHub/package/IAM setup in [Part A.6](Part_A.md#a6-automated-testing-and-github-actions--first-time-setup) first. Use this section every time application code changes.

| Update | Repeat these steps | End result |
| --- | --- | --- |
| Minor | C.0.1 publish changed applications → C.0.2 test the selected pair. | Tested images stay in GHCR; production is unchanged. |
| Major | The same C.0.1–C.0.2 tests → C.0.3 approved promotion → C.0.4 transfer → C.1 or C.2 deployment. | The exact tested images are copied to ECR and deployed on EC2. |

No separate major-only test suite exists. Each changed pair receives the same combined browser tests. A frontend/backend push does not automatically choose a pair in ec2yml: you explicitly select the intended digests after they exist. A failed test means fixing the relevant code and selecting its new commit image, not promoting the failed pair.

### C.0.1 Push application changes and collect GHCR images

1. **Local machine:** review, commit and push each application repository you changed (for example on `dev/v0.8.0`). If only one application changed, keep the other application's existing intended digest and source SHA. Each pushed branch runs independent tests before publishing. No merge to trial/main is necessary just to publish.
2. **Browser, GitHub:** click the repository's **Actions** tab. In the left workflow list, click **Test and publish frontend** (or **Test and publish backend**). Click the run whose commit matches your push. Wait for its checks and `build-and-push` to show green checkmarks.
3. Click **Summary** in the run's left sidebar. Scroll to **Published commit image** and copy `image` and `revision`. To download the record, scroll to **Artifacts** and click the `ghcr-image-COMMIT` artifact name. On Windows, open Downloads, right-click the downloaded ZIP, click **Extract All…**, then **Extract**, and open `image.json` in your editor.
4. Keep both records. The tag is `sha-FULL_COMMIT`; the selection must use the full `ghcr.io/OWNER/persona_stand_front@sha256:...` or `persona_stand_back` reference.

Every branch push publishes after passing tests. Pull-request events test only; they do not publish synthetic merge commits. Reruns reuse the existing commit image and check its labels. Authentication/network errors stop publication. Retain commit tags and tested images; deleting or manually overwriting them destroys reproducibility. New image contents require a new source commit.

### C.0.2 Select the pair and run combined tests — minor and major

1. **Local machine, ec2yml folder:** open your existing `release-versions.json`. Only on your first selection, create it by copying `release-versions.example.json`.
2. Replace frontend `image` and `revision` with values from its build record. Repeat for backend; do not shorten either digest or commit.
3. In the ec2yml terminal, run `npm ci` on a fresh checkout or when the dependency lockfile changes, then run `npm run release:validate`. It produces `selected-release.json`, a generated record of the selected pair. Do not commit that generated file; it is ignored by Git.
4. Review, commit and push **`release-versions.json`** in ec2yml. Workflows/scripts are already installed during first-time setup; include them only when intentionally changing them. The combined workflow runs on every branch push and same-repository PR. Fork PRs receive configuration checks only.
5. **Browser, GitHub:** click ec2yml **Actions** → **Combined browser tests** in the left sidebar → the run matching your push. Check that both `configuration` and `combined-browser` have green checkmarks. To inspect a failure, click the failed job name, then click the failed step to expand its log.
6. Click the run's **Summary**, scroll to **Artifacts**, and click `combined-test-results-RUN_ID-ATTEMPT` to download it. Extract the ZIP on your computer. `test-results/release-result.json` must say `passed` and contain the intended images, source SHAs, coordinator SHA, run ID and attempt. Browser reports/logs explain failures.

`release-versions.json` is the committed choice; `selected-release.json` is the run's generated record. They are normally identical when the committed choice is used. Manual workflow inputs can override that choice, making the generated record different. Push only the committed selection file.

**To start the combined workflow manually — browser, GitHub:**

1. First ensure the workflow file exists on the default branch; otherwise its manual-run control will not appear.
2. Click ec2yml **Actions** → **Combined browser tests** in the left sidebar.
3. Click **Run workflow** above the run list to open the input panel. Open the **Branch** selector and choose `main` for a promotable release.
4. Leave all four image/commit fields empty to use the committed selection, or fill in all four with the intended pair.
5. Click the green **Run workflow** button inside the panel to submit. This is a second click: opening the panel alone does not start anything.
6. Refresh the run list if necessary, click the new run, then inspect its jobs and artifact as above.

Promotion accepts successful main push/manual runs, not PR or development-coordinator runs.

**For a minor update, stop here. For an approved major release, continue to C.0.3 using the successful main run.** A minor update ends here: nothing goes to ECR. Artifact retention is 90 days, subject to repository limits. Download release evidence for longer retention. If evidence expires, test the same GHCR digests again; never rebuild them to obtain a receipt.

### C.0.3 Approve and promote a major release

**Prerequisite:** complete C.0.1–C.0.2 with a successful combined run from ec2yml main. Minor and major updates use the same suite. If the exact pair already has a successful main push/manual run with retained evidence, use that run; otherwise run the same suite on main with the same digests. Never rebuild a tested image for promotion.

**Where: your browser, GitHub.**

1. Click ec2yml **Actions** → **Combined browser tests** → the successful main run for your intended pair. Click **Summary** and confirm both jobs passed.
2. Copy the run ID from your browser address (`.../actions/runs/123456789`). The downloaded artifact name `combined-test-results-RUN_ID-ATTEMPT` gives the exact attempt number; copy its final number as well.
3. Click **Actions** again. In the left sidebar, click **Approve major release and promote to ECR**. Click **Run workflow** above the run list.
4. In the panel, open **Branch** and select `main`. Fill in the run-ID field, attempt-number field and release-version field (for example `v0.8.0`). Check **I approve copying this tested pair to production ECR**. Click the green **Run workflow** button inside the panel.
5. Click the newly created run. If it is waiting for environment approval, click **Review deployments**, select the checkbox beside **production**, review the test result, and click **Approve and deploy**. Despite that GitHub button's wording, this workflow only promotes images to ECR; it does not deploy to EC2.
6. Wait for the `promote` job to show a green checkmark. It validates evidence, copies both images with digest preservation and verifies the ECR digests; no build occurs. If it fails, click **promote**, then the red failed step to read its log.
7. Click **Summary**, scroll to **Artifacts**, and click `promoted-release-VERSION-RUN_ID-ATTEMPT`. Extract the downloaded ZIP and keep `promotion.json`, `release-images.env` and the included test evidence together. Continue to C.0.4 to transfer the files, then C.1 for first deployment or C.2 for redeployment.

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

**Where: your local PowerShell terminal, after extraction and EC2 folder creation.** Run the following, replacing the paths, login name and IP with your actual values. Amazon Linux usually uses `ec2-user`; use your existing SSH login name if different.

```powershell
scp -i "C:/path/to/your-key.pem" "C:/path/to/extracted/promotion.json" "C:/path/to/extracted/release-images.env" ec2-user@<ec2-public-ip>:~/app/
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
2. Manually approve and run promotion using that successful run ID and attempt (C.0.3).
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
| No release selected | Complete the manifest or all four manual inputs. |
| Promotion rejects evidence | Successful main push/manual run, correct attempt, same workflow/repository, unexpired artifact. |
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