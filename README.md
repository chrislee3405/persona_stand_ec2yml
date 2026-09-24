This file contains the deployment notes and setup procedure for a Persona Stand application using:

- **Frontend:** React + TypeScript + Vite
- **Backend:** Python + FastAPI
- **Containers:** Docker / Docker Compose
- **AWS:** EC2, ECR, RDS, IAM, S3 + CloudFront (images and video)
- **GCP:** Vertex AI + Workload Identity Federation
- **CI/CD:** GitHub Actions, GHCR for tested builds, AWS OIDC for approved ECR promotion

## Automated tests and release coordination

Start with [Part A.6](Part_A.md#a6-automated-testing-and-github-actions--first-time-setup)
for the step-by-step first-time GitHub and AWS testing setup.
See [TESTING.md](TESTING.md) for independent frontend/backend checks and the
combined Playwright suite owned by this repository. Select exact frontend and
backend image digests in `release-versions.json` (start from the example), test
the pair with one workflow for minor and major updates. All passing branch
builds publish to GHCR. Minor updates stay there; approved major releases copy
the tested images unchanged to ECR. EC2 pulls only promoted ECR digests using
`promotion.json`; see [Part C](Part_C.md). No image is rebuilt after testing.

> **Important:** Replace every value surrounded by `<...>` with your own value. Do not commit passwords, private keys, AWS access keys, Google service-account private keys, or database credentials.

---

# 1. Architecture

The intended production architecture is:

```text
Application branch push
   -> independent tests -> commit-specific GHCR images
   -> ec2yml selects exact frontend/backend digests and source commits
   -> combined Playwright tests on a GitHub-hosted runner
       -> minor: retain GHCR images and test evidence
       -> approved major: copy unchanged images to ECR using AWS OIDC
           -> EC2 pulls promoted ECR digests and records deployment
               -> frontend -> backend -> RDS / Vertex AI
```

A visitor's request flows like this:

```text
Internet
   │
   ├── HTTPS :443 ───────────► EC2   (HTTP :80 redirects to HTTPS, and serves certificate renewals)
   │                            │
   │                            ▼
   │                  frontend container — nginx (listens :8443 / :8080, published as :443 / :80)
   │                            ├── the React SPA
   │                            └── /api/ ──► backend container — FastAPI :8000 (not published)
   │                                                 ├── Amazon RDS (PostgreSQL)
   │                                                 └── Google Vertex AI (Gemini)
   │
   └── HTTPS ────────────────► CloudFront ──► S3   (images, video, CV)
```

nginx inside the frontend container is the reverse proxy: the browser calls relative `/api/...` paths on the same origin, so no backend address is ever built into the frontend, and the backend port is never exposed on the host.

HTTPS terminates in that same nginx, with a Let's Encrypt certificate that certbot on the instance issues and renews (Part A, *HTTPS with Let's Encrypt*). The frontend image serves plain HTTP until `TLS_DOMAIN` is set in the instance's `.env`, so the image CI tests over HTTP is the one production runs over HTTPS. Keep `SESSION_COOKIE_SECURE=false` until HTTPS works end to end (see the note in `docker-compose.ec2.yml`).

---

# 2. Repository Structure

The application is separated into three GitHub repositories.

## 2.1 Frontend Repository

```text
persona_stand_front/
├── src/
├── public/
├── package.json
├── vite.config.ts
├── ...
└── .github/
    └── workflows/
        └── deploy.yml
```

The frontend repository contains:

- React
- TypeScript
- Vite
- Frontend application code
- Frontend Docker configuration
- Its own GitHub Actions workflow

The frontend GitHub Actions workflow builds the frontend Docker image and publishes it to GHCR after independent tests pass.

---

## 2.2 Backend Repository

```text
persona_stand_back/
├── app/
├── requirements.txt
├── Dockerfile
├── docker-compose.yml
├── ...
└── .github/
    └── workflows/
        └── deploy.yml
```

The backend repository contains:

- Python
- FastAPI
- Backend application code
- `docker-compose.yml` for local development
- Its own GitHub Actions workflow

The local `docker-compose.yml` is intended for development on the local device. It is separate from the production EC2 Compose configuration.

The backend GitHub Actions workflow builds the backend Docker image and publishes it to GHCR after independent tests pass.

---

## 2.3 EC2 Deployment Repository

```text
persona_stand_ec2yml/
├── .github/workflows/integration.yml  combined tests for every selected pair
├── .github/workflows/promote.yml      approved GHCR-to-ECR copy
├── release-versions.example.json     template for your image selection
├── docker-compose.test.yml           isolated browser-test services
├── docker-compose.ec2.yml            production ECR services
├── scripts/                          selection, verification, testing, promotion and deployment
├── tests/e2e/                        Playwright browser journeys
├── iam/                              promotion policy and trust templates
├── TESTING.md                        test architecture and release evidence
├── README.md               (this file: architecture + Part 0)
├── Part_A.md               first-time infrastructure setup
├── Part_B.md               local development workflow
├── Part_C.md               deployment and ongoing operations
├── Part_D.md               site content and images
├── placeholder_lookup.md   where each <placeholder> value comes from
└── version_log.md
```

This repository coordinates combined testing, approved image promotion and EC2 deployment, and contains the setup manual.

`docker-compose.ec2.yml` pulls the pre-built frontend and backend images from Amazon ECR and runs them on the EC2 instance.

The EC2 repository is a deployment/configuration repository rather than an application source-code repository.

---

## 2.4 Repository and Deployment Relationship

```text
front deploy.yml -> checks -> GHCR frontend digest ---+
                                                    +-> ec2yml integration.yml
back deploy.yml  -> tests  -> GHCR backend digest ----+     -> Playwright result
                                                          -> minor: stop here
                                                          -> approved major:
                                                             promote.yml -> ECR
                                                             deploy_release.py -> EC2
```

Application `scripts/publish_image.py` builds each new commit image once. ec2yml never rebuilds application images: it tests selected GHCR digests, copies the successful pair unchanged to ECR after approval, then records EC2 deployment. See [TESTING.md](TESTING.md) for file responsibilities and [Part A.6](Part_A.md#a6-automated-testing-and-github-actions--first-time-setup) for permissions and setup.

---

# 3. Manual Structure

Use these guides in order: Part A for first-time setup, Part B for local development, Part C for repeated automated tests and approved production releases, and Part D for content/media operations. Complete infrastructure setup in Part A.6 once. For each minor or major update, start at Part C.0; minor updates stop after its combined tests, while major releases continue to approval and deployment.

```text
Part 0 - Local Machine Prerequisites—
    ├── 0.1 Git Setup 
    ├── 0.2 Python Setup 
    ├── 0.3 Node.js Setup 
    ├── 0.4 Docker Desktop Setup 
    ├── 0.5 AWS CLI Setup 
    ├── 0.6 Google Cloud CLI Setup
    └── 0.7 PostgreSQL client tools Setup

Part A — First-Time Infrastructure Setup 
    ├── A.1  Access AWS Account
    ├── A.2 EC2 Setup 
    ├── A.3 ECR Setup 
    ├── A.4 RDS Setup 
    ├── A.5 GCP / Vertex AI Setup 
    └── A.6 Automated Testing / Release Infrastructure (once)

Part B — Local Development Workflow 
    ├── B.1 Repository & Dependencies 
    ├── B.2 Environment Files 
    ├── B.3 Local Vertex AI Credentials 
    ├── B.4 Running the App Locally
    └── B.5 Local Automated Tests

Part C — Deployment & Ongoing Operations 
    ├── C.0 Every Update — Publish / Test / Major Promotion
    ├── C.1 First Deployment to a New EC2 Instance
    ├── C.2 Every Redeploy
    ├── C.3 After EC2 Stop/Start 
    └── C.4 Troubleshooting Reference

Part D — Site Content & Images 
    ├── D.1 First-Time Setup — S3 + CloudFront
    ├── D.2 First-Time Setup — Content Table
    ├── D.3 Every Content Update
    ├── D.4 Every Image Update
    ├── D.5 Content Shapes Reference
    └── D.6 Troubleshooting Reference
```

---

# Part 0 — Local Machine Prerequisites 💻

Install these once on any machine you'll develop from. Commands are given
for Windows (PowerShell), macOS, and Ubuntu/Debian Linux — use whichever
matches your OS. Every step in this Part 0 runs on **your local machine**.

### 0.1 Git

- **Windows:** download and run the installer from https://git-scm.com/download/win
- **macOS:** `brew install git` (install Homebrew first from https://brew.sh if needed)
- **Linux:** `sudo apt update && sudo apt install -y git`

Run in Local machine terminal
```bash
git --version
```

### 0.2 Python 3.11+

Match the backend's Docker image (`python:3.11-slim`) for local parity.

- **Windows:** download from https://www.python.org/downloads/ — during install, check **"Add python.exe to PATH"**
- **macOS:** `brew install python@3.11`
- **Linux:** `sudo apt install -y python3.11 python3.11-venv python3-pip`

Run in Local machine terminal
```bash
python --version   # or python3 --version
pip --version
```

### 0.3 Node.js 22.12+

Use Node.js 22 (at least 22.12), matching the frontend's Docker image (`node:22-alpine`) and automated-test runtime.

Run in Local machine terminal
- **All platforms (recommended):** install via [nvm](https://github.com/nvm-sh/nvm) (macOS/Linux) or [nvm-windows](https://github.com/coreybutler/nvm-windows):
```bash
nvm install 22
nvm use 22
```
- **Or download directly:** https://nodejs.org/ (choose the 22.x installer)

Run in Local machine terminal
```bash
node --version
npm --version
```

### 0.4 Docker Desktop

- **Windows/macOS:** download from https://www.docker.com/products/docker-desktop/ and run the installer. Windows users: enable WSL2 integration when prompted.
- **Linux:** follow https://docs.docker.com/engine/install/ for your distro, then:

Run in Local machine terminal (Linux only)
```bash
sudo usermod -aG docker $USER
newgrp docker
```

Run in Local machine terminal
```bash
docker --version
docker compose version
```

### 0.5 AWS CLI v2

- **Windows:** download the MSI installer from https://awscli.amazonaws.com/AWSCLIV2.msi and run it
- **macOS:** download the `.pkg` from https://awscli.amazonaws.com/AWSCLIV2.pkg and run it
- **Linux:**

Run in Local machine terminal (Linux only)
```bash
curl "https://awscli.amazonaws.com/awscli-exe-linux-x86_64.zip" -o "awscliv2.zip"
sudo apt install -y unzip
unzip awscliv2.zip
sudo ./aws/install
rm -rf awscliv2.zip aws/
```

Run in Local machine terminal
```bash
aws --version
```

### 0.6 Google Cloud CLI (`gcloud`)

- **Windows:** download the installer from https://cloud.google.com/sdk/docs/install
- **macOS:** `brew install --cask google-cloud-sdk`
- **Linux:**

Run in Local machine terminal (Linux only)
```bash
curl -O https://dl.google.com/dl/cloudsdk/channels/rapid/downloads/google-cloud-cli-linux-x86_64.tar.gz
tar -xf google-cloud-cli-linux-x86_64.tar.gz
./google-cloud-sdk/install.sh
```

Run in Local machine terminal
```bash
gcloud --version
gcloud init
gcloud auth login
```

### 0.7 PostgreSQL client tools (optional, for direct DB debugging)

- **Windows:** included with the [PostgreSQL installer](https://www.postgresql.org/download/windows/) (you only need the `psql` client, not the server)
- **macOS:** `brew install libpq && brew link --force libpq`
- **Linux:** `sudo apt install -y postgresql-client`

Run in Local machine terminal
```bash
psql --version
```

---
