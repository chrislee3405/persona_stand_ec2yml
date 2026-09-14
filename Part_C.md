# Part C — Deployment & Ongoing Operations 🔁

## C.1 First Deployment to a New EC2 Instance
Run in EC2 instance terminal
```bash
mkdir -p ~/app && cd ~/app
git clone https://github.com/<you>/persona_stand_ec2yml.git .
nano .env
```

Run in EC2 instance terminal — paste into the `.env` file you just opened with `nano`
```env
AWS_ACCOUNT_ID=<your-12-digit-account-id>
DATABASE_URL=postgresql://<master-username>:<master-password>@<rds-endpoint>:5432/<db-name>
SESSION_SECRET_KEY=<long-random-string — see below>
GCP_PROJECT_ID=<project-id-or-number-matching-what-your-code-expects>
AWS_REGION=ap-southeast-2
IMAGE_TAG=main
```
Save with `Ctrl+O → Enter → Ctrl+X`.

⚠️ `SESSION_SECRET_KEY` is **required** — the backend reads it with `os.environ[...]` and exits immediately with `KeyError: 'SESSION_SECRET_KEY'` if it is missing, which shows up as a container that restarts forever. Generate one on your local machine and paste it in:

Run in Local machine terminal
```bash
python -c "import secrets; print(secrets.token_urlsafe(48))"
```

This key signs the session cookie, which is what carries a visitor's consent record and invite-code verification. **Changing it logs every visitor out** — existing cookies stop validating, so consent has to be given again and any verified invite session is dropped. Set it once and keep it; do not regenerate it on each deploy.

⚠️ `IMAGE_TAG` selects which branch's image this instance pulls from ECR — both the backend and frontend workflows now push a `main` tag and a `trial` tag (in addition to the per-commit SHA tag) instead of `latest`. Set it to `main` on your production instance and `trial` on a trial/staging instance. **If omitted, `docker-compose.ec2.yml` falls back to `trial`** — so on a production instance, set it explicitly.

⚠️ `DATABASE_URL` here must point **directly at the RDS endpoint on port 5432** — not the local compose database from Part B (`db:5432`) or an SSH tunnel address. Omitting this variable entirely stops the backend at startup with `RuntimeError: DATABASE_URL is not set`.

⚠️ **A new database has no consent policy, invite codes or persona data.** The chatroom refuses every message until a consent policy row exists — see Part D.2, *Seed the consent policy, invite codes and persona data*.

> **There is no `VITE_API_URL`.** Earlier versions of this guide listed one. The frontend calls relative `/api/...` paths and nginx proxies them to the backend container, so no API URL is configured anywhere — and it could not be set at runtime even if it were needed, because Vite inlines `VITE_*` values at **build** time, inside the Docker build in GitHub Actions.

Run in EC2 instance terminal
```bash
aws ecr get-login-password --region ap-southeast-2 | docker login --username AWS --password-stdin <AWS_ACCOUNT_ID>.dkr.ecr.ap-southeast-2.amazonaws.com # for every 12 hours restart
docker compose -f docker-compose.ec2.yml pull
docker compose -f docker-compose.ec2.yml up -d
```

Run in EC2 instance terminal
```bash
docker ps -a
docker compose -f docker-compose.ec2.yml logs -f
```
The app should be reachable at `http://<ec2-public-ip>` — **Where: your local machine's browser**.

## C.2 Every Redeploy
# main steps: have update images in ECR > connect to EC2 terminal > go to app folder > update .env > login with CLI "aws ecr get-..." > pull images > docker up

Run in EC2 instance terminal
```bash
cd ~/app
git pull
# login with CLI "aws ecr get-..."
docker compose -f docker-compose.ec2.yml pull
docker compose -f docker-compose.ec2.yml up -d
docker ps -a
```

### ⚠️ One-off steps for the next deploy only

The routine above is unchanged, but the first deploy of 0.6.3 / 0.6.4 (the
async database layer, durable rate-limit table, non-root containers, consent
withdrawal and the content-index changes) needs the numbered steps below done
once. Do steps 1–7 **in this order**, on the
instance, before `docker compose up -d`; steps 8 and 9 can follow.

**1. `git pull` the ec2yml repo BEFORE pulling the new images.** The frontend
container now runs nginx as a non-root user, so it listens on **8080** instead
of 80, and `docker-compose.ec2.yml` publishes `80:8080` to match. A new
frontend image under an old compose file publishes 80:80 at a container that
is not listening there, and the site is simply refused. The `git pull` in the
routine above already does this — just do not skip it.

**2. Make the WIF credential readable by the container's user.** The backend
now runs as uid 10001, not root. `~/secrets/gcp-wif-config.json` is owned by
`ubuntu` (uid 1000), and if it was copied over with mode 600 the container
cannot read it — Vertex AI then fails on every chat turn with a refresh error
that does not mention permissions. The file describes how to fetch a token and
holds no key material (see Part_A A.5), so world-readable is fine:

Run in EC2 instance terminal
```bash
chmod 644 ~/secrets/gcp-wif-config.json
ls -l ~/secrets/gcp-wif-config.json   # want -rw-r--r--
```

**3. Migrate `condition_text` to JSONB.** The consent policy is now
`{"header"?, "condition"}` rather than a flat string. The app creates missing
TABLES on startup but **never alters existing columns**, so this one change
has to be applied by hand. It is safe and reversible-in-effect: existing text
becomes a JSON string, which `ConsentService.normalise_terms` still reads as
the legacy form (rendering with no header).

Run in EC2 instance terminal — check first, and skip if it already says `jsonb`
```bash
docker compose -f docker-compose.ec2.yml exec backend python - <<'PY'
import asyncio, os, asyncpg
async def main():
    url = os.environ["DATABASE_URL"].replace("postgresql+asyncpg://", "postgresql://")
    conn = await asyncpg.connect(url)
    for t in ("consent_policy", "consent_record"):
        print(t, await conn.fetchval(
            "SELECT data_type FROM information_schema.columns "
            "WHERE table_name=$1 AND column_name='condition_text'", t))
    await conn.close()
asyncio.run(main())
PY
```

If either says `text`, run the conversion with psql (Part_D D.2 has the
connection recipe):
```sql
ALTER TABLE consent_policy
  ALTER COLUMN condition_text TYPE jsonb USING to_jsonb(condition_text);
ALTER TABLE consent_record
  ALTER COLUMN condition_text TYPE jsonb USING to_jsonb(condition_text);
```

**4. Confirm the `VITE_CDN_BASE` repository Variable is set** on the FRONTEND
repo before pushing. The build now **fails** without it instead of quietly
producing an image whose favicon, og:image and hero preloads contain the
literal text `%VITE_CDN_BASE%`. Settings → Secrets and variables → Actions →
Variables.

**5. Deploy the frontend and backend images TOGETHER.** `GET /api/consent` has
been replaced by `GET /api/chatroom_initialize`, and `POST /api/code` no longer
returns the code. A new frontend against an old backend gets a 404 on load and
shows the consent terms as unavailable; an old frontend against a new backend
does the same. Both images share `IMAGE_TAG`, so the routine above already
deploys them as a pair — just do not pull one without the other.

**6. Add consent withdrawal to `consent_record`.** Visitors can now withdraw
consent ("Disagree with consent" under the chatroom). A withdrawn record is
kept and stamped rather than deleted, and agreeing again inserts a new row — so
the old one-row-per-(session, version) unique constraint becomes a *partial*
unique index over active rows only. `create_all` cannot alter an existing
table, so run this once with psql (Part_D D.2 has the connection recipe):

```sql
BEGIN;
ALTER TABLE consent_record ADD COLUMN IF NOT EXISTS withdrawn_at timestamptz;
ALTER TABLE consent_record DROP CONSTRAINT IF EXISTS uq_session_policy_version;
CREATE UNIQUE INDEX IF NOT EXISTS uq_consent_record_active
  ON consent_record (session_id, policy_version) WHERE withdrawn_at IS NULL;
COMMIT;
```

Existing rows get `withdrawn_at = NULL`, i.e. they stay in force — nobody is
asked to consent again.

**7. Rename `personality_reference.cluture_background` to `culture_background`.**
The column was misspelled, and the backend model now uses the correct
spelling. Against the old column name the new backend cannot read the persona
profile at all, so this is a breaking change: run it right before
`docker compose up -d` so the gap between the two is seconds. Safe to run twice:

```sql
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns
             WHERE table_name = 'personality_reference'
               AND column_name = 'cluture_background') THEN
    ALTER TABLE personality_reference
      RENAME COLUMN cluture_background TO culture_background;
  END IF;
END $$;
```

**8. Swap the content-table indexes.** The current version of a section is now
the row with the highest `id` (these tables are append-only and single-owner,
so id order is write order); `created_at` is record metadata only. The queries
order by `(key, id DESC)`, and the old `(key, created_at)` indexes could not
serve them. Same reason as step 6 — `create_all` never adds an index to a
table that already exists:

```sql
BEGIN;
DROP INDEX IF EXISTS ix_site_content_section_created_at;
DROP INDEX IF EXISTS ix_site_image_section_description_created_at;
DROP INDEX IF EXISTS ix_site_journey_journey_id_created_at;
DROP INDEX IF EXISTS ix_site_project_project_id_created_at;
CREATE INDEX IF NOT EXISTS ix_site_content_section_id_desc ON site_content (section, id DESC);
CREATE INDEX IF NOT EXISTS ix_site_image_section_description_id_desc ON site_image (section, description, id DESC);
CREATE INDEX IF NOT EXISTS ix_site_journey_journey_id_id_desc ON site_journey (journey_id, id DESC);
CREATE INDEX IF NOT EXISTS ix_site_project_project_id_id_desc ON site_project (project_id, id DESC);
COMMIT;
```

The app works before this runs — the queries are correct either way, just
unindexed — so it is safe to do after the new images are up.

**9. Drop the duplicate primary-key indexes.** Every table's `id` column was
declared with `index=True` as well as `primary_key=True`, so `create_all` built
an ordinary `ix_<table>_id` index *next to* the primary key's own unique index:
two indexes on the same column, both maintained on every insert. The models no
longer ask for the second one. Nothing reads these indexes that the primary key
cannot serve, so this is safe at any time after the new images are up:

```sql
BEGIN;
DROP INDEX IF EXISTS ix_code_id;
DROP INDEX IF EXISTS ix_consent_policy_id;
DROP INDEX IF EXISTS ix_consent_record_id;
DROP INDEX IF EXISTS ix_message_message_id;
DROP INDEX IF EXISTS ix_question_bank_id;
DROP INDEX IF EXISTS ix_doc_reference_id;
DROP INDEX IF EXISTS ix_personality_reference_id;
DROP INDEX IF EXISTS ix_scenario_reference_id;
DROP INDEX IF EXISTS ix_site_content_id;
DROP INDEX IF EXISTS ix_site_image_id;
DROP INDEX IF EXISTS ix_site_journey_id;
DROP INDEX IF EXISTS ix_site_project_id;
COMMIT;
```

Leave `ix_consent_record_session_id`, `ix_conversation_owner_session_id` and
`ix_message_conversation_id` alone — those are on non-key columns and are used.

**Expect every verified invite session to re-enter its code once.** The session
cookie used to carry the invite code in plaintext (readable with a base64
decode); it now carries only the code's database id. Sessions still holding the
old key are treated as unverified, and their next chat message goes through as
a guest turn until the visitor verifies again. Nothing needs doing on the
instance.

Nothing else changes. `asyncpg` and the new `rate_limit_counter` table are
handled automatically — the dependency by the image rebuild, the table by the
startup schema check.

### Rolling back a bad deploy

Both workflows tag every image with the commit SHA as well as the branch
name, so going back is a one-liner — pin `IMAGE_TAG` to the previous SHA
instead of `main`:

Run in EC2 instance terminal
```bash
aws ecr describe-images --repository-name persona_stand/backend --region ap-southeast-2   --query 'sort_by(imageDetails,&imagePushedAt)[-5:].imageTags' --output text
IMAGE_TAG=<previous-sha> docker compose -f docker-compose.ec2.yml up -d
```

Both images share the tag, so this rolls the frontend and backend back
together. Put `IMAGE_TAG` back to `main` in `.env` once a fixed image has
been pushed.

⚠️ Rolling back **across** the release described above needs the compose file
rolled back with it (`git checkout <prev> -- docker-compose.ec2.yml`), because
an older frontend image listens on 80 while the newer compose file publishes
`80:8080`. The database changes do not need undoing: an older image reads a
`jsonb` `condition_text` fine, an unused `rate_limit_counter` table is inert,
and the new indexes only make its queries faster. **The column rename (step 7)
is the exception:** an older backend image reads `cluture_background`, so undo
it when rolling back past this release —
`ALTER TABLE personality_reference RENAME COLUMN culture_background TO cluture_background;`.

⚠️ **One consequence of rolling back is not inert: withdrawn consent comes back
into force.** An image older than the withdrawal feature does not know the
`withdrawn_at` column exists, so it counts every `consent_record` row as
active — including ones a visitor explicitly withdrew. If you roll back past
that release, block chat until you roll forward again, or delete the withdrawn
rows first (`DELETE FROM consent_record WHERE withdrawn_at IS NOT NULL;`) —
the visitor's later re-agreement, if any, is a separate row and survives.

## C.3 After EC2 Stop/Start (public IP changes, unless using an Elastic IP)

- **Nothing in `.env` needs changing.** The frontend talks to the backend over the compose network by service name, and `DATABASE_URL` targets RDS's stable endpoint — neither depends on the instance's public IP. (This step used to say to update `VITE_API_URL`; that variable does not exist. See C.1.)
- Update your local SSH tunnel command with the new IP **— Where: Local machine terminal** (Part D.2, *Connect to the database*)
- Browse to the new public IP. If you want the address to stop changing, attach an Elastic IP **— Where: AWS Console → EC2 → Elastic IPs**

## C.4 Troubleshooting Reference

*(All diagnostic commands referenced below are run on the **EC2 instance via SSH**, unless the symptom is purely visual, in which case it's observed in your **local machine's browser**.)*

| Symptom | Likely cause |
|---|---|
| `docker login` fails | ECR region mismatch, expired/missing AWS credentials, or missing IAM permissions |
| `pull` fails with "not found" | Image tag doesn't exist in ECR, wrong `AWS_ACCOUNT_ID` in `.env`, or `IMAGE_TAG` in `.env` doesn't match a branch that's actually been pushed (`main`/`trial`) |
| Frontend can't reach backend | The backend container is not running — nginx proxies `/api/` to it by service name, so check `docker compose -f docker-compose.ec2.yml ps` and the backend's logs first |
| Backend restarts forever, `KeyError: 'SESSION_SECRET_KEY'` in the log | `SESSION_SECRET_KEY` missing from `.env` on the instance — see C.1 |
| Deployed but the site shows the wrong version | `IMAGE_TAG` unset in `.env`, so the compose file fell back to `trial` — set it to `main` |
| Backend container unhealthy, `curl: not found` in health log | Base image lacks `curl` — install it in the Dockerfile's runtime stage (edited on **local machine**, rebuilt via GitHub Actions), or switch the health check to `wget` |
| Frontend unhealthy, `wget: can't connect... Connection refused` | nginx listens on **8080** inside the container (IPv4 and IPv6), not 80 — a health check or `curl` against `:80` inside the container finds nothing. The image's own health check targets `127.0.0.1:8080` |
| Backend exits at startup with `RuntimeError: DATABASE_URL is not set` | `DATABASE_URL` missing from `.env` on the instance (the compose file reads it from there) |
| Chatroom says "Consent terms are currently unavailable" and every message is refused | No row in `consent_policy`, or its `condition_text` is malformed — see Part D.2, *Seed the consent policy, invite codes and persona data* |
| `could not translate host name "host.docker.internal"` on EC2 | Local-dev-only `DATABASE_URL` value got copied into EC2's `.env` — use the real RDS endpoint on port 5432 instead |
| `RefreshError: Unable to retrieve AWS region` | `gcp-wif-config.json` is missing `imdsv2_session_token_url` in `credential_source` |
| `403 PERMISSION_DENIED: iam.serviceAccounts.getAccessToken` despite roles being granted in console | The AWS role ARN in the GCP IAM binding doesn't match the EC2 instance's *actual* attached role — verify via instance metadata (EC2 via SSH), not by typing/guessing |
| Can't load app in browser | Security group isn't allowing inbound HTTP on port 80 — check in **AWS Console (browser)** |
| Accidentally ran the wrong `docker-compose.yml` on EC2 | `docker system prune -f` **— Where: EC2 instance (via SSH)**, then redeploy correctly |
| EC2 container status unhealthy & Inspect EC2 debug print | run "docker compose -f docker-compose.ec2.yml logs --tail=100 backend" to inspect the debut log|
