# Part B — Local Development Workflow

Everything in this part runs on **local machine**, except where explicitly noted otherwise (e.g. commands run *inside* a Docker container).

The local stack is self-contained: `persona_stand_back/docker-compose.yml` runs its own Postgres, the backend and the frontend. **Nothing in this part connects to production.** The SSH tunnel to RDS is only for managing production content — see Part D.

For independent and combined automated-test commands, see the frontend/backend `TESTING.md` files and this repository's [TESTING.md](TESTING.md). Local Docker builds are development rehearsals. Release candidates are built once in application CI, published to GHCR, then selected and tested by digest in ec2yml. Follow [Part A.6](Part_A.md#a6-automated-testing-and-github-actions--first-time-setup) to enable that flow and [Part C](Part_C.md) to promote/deploy an approved pair without rebuilding.

## B.1 Repository & Dependencies

Run in Local machine terminal — the three repositories must sit side by side, because the backend's `docker-compose.yml` builds the frontend from `../persona_stand_front`
```bash
mkdir -p ~/projects && cd ~/projects
git clone https://github.com/<you>/persona_stand_front.git
git clone https://github.com/<you>/persona_stand_back.git
git clone https://github.com/<you>/persona_stand_ec2yml.git
```

Backend Python dependencies — Run in Local machine terminal. *Optional:* the container installs its own, so this is only for editor tooling or running Python outside Docker. Use Python 3.11 to match the image.
```bash
cd persona_stand_back
python -m venv .venv
.venv\Scripts\activate        # Windows
# source .venv/bin/activate   # macOS/Linux

pip install -r requirements.txt
```

Frontend dependencies — Run in Local machine terminal (needed for `npm run dev`, `npm run build` and lint)
```bash
cd ../persona_stand_front
npm install
```

## B.2 Environment Files

Both files are gitignored. Each repo has a committed `.env.example` to copy from.

**Backend** — Run in Local machine terminal, in `persona_stand_back`
```bash
cp .env.example .env
```

Then edit `.env`. What each value means is in `persona_stand_back/README.md`; the essentials:

```env
DATABASE_URL=postgresql://persona:persona_dev_password@db:5432/persona
SESSION_SECRET_KEY=<generate one: python -c "import secrets; print(secrets.token_urlsafe(48))">
GCP_PROJECT_ID=<project-id>
GOOGLE_ADC_PATH=<path-to-application_default_credentials.json>
GOOGLE_APPLICATION_CREDENTIALS=/app/adc.json
```

- `DATABASE_URL` uses the compose service name `db` on port 5432 — the local Postgres container, not RDS.
- `GOOGLE_ADC_PATH` is **your** credentials file on the host (see B.3); compose mounts it read-only into the container at `/app/adc.json`, and `GOOGLE_APPLICATION_CREDENTIALS` is what tells the Google client to read it there. Without that second line the mount does nothing and every chat turn fails to authenticate.
- Leave `LOG_LEVEL` and `SESSION_COOKIE_SECURE` unset locally (DEBUG logging, and a session cookie that works over plain `http://localhost`).

**Frontend** — Run in Local machine terminal, in `persona_stand_front`
```bash
cp .env.example .env
```

and set `VITE_CDN_BASE=https://<cloudfront-domain>` (no trailing slash). It is **required** — the build fails without it (Part D.1).

⚠️ These files are **local-dev only** — never reuse either on EC2. EC2's own `.env` is described in Part C.1.

## B.3 Local Vertex AI Credentials

Run in Local machine terminal
```bash
gcloud auth application-default login
gcloud auth application-default set-quota-project <project-id>
```

This writes `application_default_credentials.json` — to `~/.config/gcloud/` on macOS/Linux, `%APPDATA%\gcloud\` on Windows. Put that path in `GOOGLE_ADC_PATH` (B.2). Production does not use this file: EC2 authenticates through Workload Identity Federation (Part A.5).

Run in Local machine terminal, once the stack is up (B.4) — this runs *inside* the backend container, using the same client and model the app uses
```bash
docker compose exec backend python -c "from app.constants import DEFAULT_MODEL; from app.services.ai.gemini_service import _get_client; print(_get_client().models.generate_content(model=DEFAULT_MODEL, contents='Say hello').text)"
```

A reply means credentials, project and model access all work.

## B.4 Running the App Locally

**Full stack — Run in Local machine terminal, backend folder**
```bash
docker compose up --build
```

Postgres starts first (the backend waits for its healthcheck), then the backend creates any missing tables. Seed the database once:

```bash
docker compose exec backend python -m app.models.seed.load
```

The real content seed files are gitignored, so a fresh clone seeds only the consent policy — see `persona_stand_back/app/models/seed/README.md` for loading real content and adding a local invite code.

- Site: http://localhost
- API: http://localhost:8000 (interactive docs at `/docs`)
- Database: `localhost:5434` for pgAdmin or psql — steps in `persona_stand_back/README.md`

The backend runs with `--reload` over a bind mount of the source. If an edit does not trigger a reload (file-change events do not always cross a Windows bind mount), run `docker compose restart backend`.

**Frontend with hot reload — Run in Local machine terminal, frontend folder** (with the full stack still running)
```bash
npm run dev
```

Open http://localhost:5173. Vite proxies `/api` to the backend on :8000, so the browser still talks to one origin. The nginx headers (CSP, rate limit) only apply to the built image on :80.

**Stopping**
```bash
docker compose down      # keeps the database volume
docker compose down -v   # also deletes the local database; re-run the seed loader afterwards
```

---

## B.5 Local automated tests

Use local tests while developing, before pushing a change. They do not create the GitHub evidence used to approve a production release.

1. **Frontend terminal:** follow [frontend TESTING.md](https://github.com/chrislee3405/persona_stand_front/blob/main/TESTING.md) to install dependencies and run `npm test`, lint and build checks.
2. **Backend terminal:** follow [backend TESTING.md](https://github.com/chrislee3405/persona_stand_back/blob/main/TESTING.md) for pytest and its disposable PostgreSQL database. Never point tests at production data.
3. **ec2yml terminal:** follow [the local browser-test instructions](TESTING.md#run-locally-powershell) for a development rehearsal with Docker and Playwright.
4. When ready to publish and test an intended image pair, follow [Part C.0](Part_C.md#c0-automated-tests-for-every-update). Both minor and major updates start with the same steps there.
