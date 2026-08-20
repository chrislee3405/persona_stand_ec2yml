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
VITE_API_URL=http://<ec2-public-ip>:8000
DATABASE_URL=postgresql://<master-username>:<master-password>@<rds-endpoint>:5432/<db-name>
GCP_PROJECT_ID=<project-id-or-number-matching-what-your-code-expects>
AWS_REGION=ap-southeast-2
```
Save with `Ctrl+O → Enter → Ctrl+X`.

⚠️ `DATABASE_URL` here must point **directly at the RDS endpoint on port 5432** — not the local tunnel form from B.2. Omitting this variable entirely causes an immediate startup crash.

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
docker compose -f docker-compose.ec2.yml pull
docker compose -f docker-compose.ec2.yml up -d
docker ps -a
```

## C.3 After EC2 Stop/Start (public IP changes, unless using an Elastic IP)

- Update `VITE_API_URL` **— Where: `.env` file on the EC2 instance (via SSH, `nano .env`)** — then `docker compose -f docker-compose.ec2.yml up -d` **— Where: EC2 instance (via SSH)** — to apply it
- Update your local SSH tunnel command with the new IP **— Where: Local machine terminal** (Part B.2)
- `DATABASE_URL` on EC2 does **not** need updating — it targets RDS's stable endpoint, not the instance's IP

## C.4 Troubleshooting Reference

*(All diagnostic commands referenced below are run on the **EC2 instance via SSH**, unless the symptom is purely visual, in which case it's observed in your **local machine's browser**.)*

| Symptom | Likely cause |
|---|---|
| `docker login` fails | ECR region mismatch, expired/missing AWS credentials, or missing IAM permissions |
| `pull` fails with "not found" | Image tag doesn't exist in ECR, or wrong `AWS_ACCOUNT_ID` in `.env` |
| Frontend can't reach backend | `VITE_API_URL` is stale after an instance restart |
| Backend container unhealthy, `curl: not found` in health log | Base image lacks `curl` — install it in the Dockerfile's runtime stage (edited on **local machine**, rebuilt via GitHub Actions), or switch the health check to `wget` |
| Frontend unhealthy, `wget: can't connect... Connection refused` on `localhost` but not `127.0.0.1` | IPv6 `localhost` resolution — nginx only listens on IPv4; point the health check at `127.0.0.1`, or add `listen [::]:80;` (edited in `nginx.conf` on **local machine**) |
| `sqlalchemy.exc.ArgumentError: Expected string or URL object, got None` | `DATABASE_URL` missing from the compose file's `environment:` block |
| `could not translate host name "host.docker.internal"` on EC2 | Local-dev-only `DATABASE_URL` value got copied into EC2's `.env` — use the real RDS endpoint on port 5432 instead |
| `RefreshError: Unable to retrieve AWS region` | `gcp-wif-config.json` is missing `imdsv2_session_token_url` in `credential_source` |
| `403 PERMISSION_DENIED: iam.serviceAccounts.getAccessToken` despite roles being granted in console | The AWS role ARN in the GCP IAM binding doesn't match the EC2 instance's *actual* attached role — verify via instance metadata (EC2 via SSH), not by typing/guessing |
| Can't load app in browser | Security group isn't allowing inbound traffic on the app's port — check in **AWS Console (browser)** |
| Accidentally ran the wrong `docker-compose.yml` on EC2 | `docker system prune -f` **— Where: EC2 instance (via SSH)**, then redeploy correctly |
| EC2 container status unhealthy | rum "docker compose -f docker-compose.ec2.yml logs --tail=100 backend" to inspect the debut log|