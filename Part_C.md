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

⚠️ `DATABASE_URL` here must point **directly at the RDS endpoint on port 5432** — not the local tunnel form from B.2. Omitting this variable entirely causes an immediate startup crash.

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

## C.3 After EC2 Stop/Start (public IP changes, unless using an Elastic IP)

- **Nothing in `.env` needs changing.** The frontend talks to the backend over the compose network by service name, and `DATABASE_URL` targets RDS's stable endpoint — neither depends on the instance's public IP. (This step used to say to update `VITE_API_URL`; that variable does not exist. See C.1.)
- Update your local SSH tunnel command with the new IP **— Where: Local machine terminal** (Part B.2)
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
| Frontend unhealthy, `wget: can't connect... Connection refused` on `localhost` but not `127.0.0.1` | IPv6 `localhost` resolution — nginx only listens on IPv4; point the health check at `127.0.0.1`, or add `listen [::]:80;` (edited in `nginx.conf` on **local machine**) |
| `sqlalchemy.exc.ArgumentError: Expected string or URL object, got None` | `DATABASE_URL` missing from `.env` on the instance (the compose file reads it from there) |
| `could not translate host name "host.docker.internal"` on EC2 | Local-dev-only `DATABASE_URL` value got copied into EC2's `.env` — use the real RDS endpoint on port 5432 instead |
| `RefreshError: Unable to retrieve AWS region` | `gcp-wif-config.json` is missing `imdsv2_session_token_url` in `credential_source` |
| `403 PERMISSION_DENIED: iam.serviceAccounts.getAccessToken` despite roles being granted in console | The AWS role ARN in the GCP IAM binding doesn't match the EC2 instance's *actual* attached role — verify via instance metadata (EC2 via SSH), not by typing/guessing |
| Can't load app in browser | Security group isn't allowing inbound traffic on the app's port — check in **AWS Console (browser)** |
| Accidentally ran the wrong `docker-compose.yml` on EC2 | `docker system prune -f` **— Where: EC2 instance (via SSH)**, then redeploy correctly |
| EC2 container status unhealthy & Inspect EC2 debug print | run "docker compose -f docker-compose.ec2.yml logs --tail=100 backend" to inspect the debut log|
