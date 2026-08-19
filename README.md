This file contains the deployment notes and setup procedure for a Persona Stand application using:

- **Frontend:** React + TypeScript + Vite
- **Backend:** Python + FastAPI
- **Containers:** Docker / Docker Compose
- **AWS:** EC2, ECR, RDS, IAM
- **GCP:** Vertex AI + Workload Identity Federation
- **CI/CD:** GitHub Actions with AWS OIDC

> **Important:** Replace every value surrounded by `<...>` with your own value. Do not commit passwords, private keys, AWS access keys, Google service-account private keys, or database credentials.

---

# 1. Architecture

The intended production architecture is:

```text
Developer
   │
   ├── Git push
   ▼
GitHub
   │
   ▼
GitHub Actions
   │
   │ OIDC
   ▼
AWS IAM Role
   │
   ▼
Amazon ECR
   │
   │ Docker image pull
   ▼
EC2
   │
   ├── Frontend container
   └── Backend container
          │
          ├── Amazon RDS
          └── Google Vertex AI
                 ▲
                 │ Workload Identity Federation
                 │
              AWS IAM Role
```

For a public deployment, the recommended traffic flow is:

```text
Internet
   │
   ▼
EC2 :80 / :443
   │
   ▼
Reverse Proxy
   ├── Frontend
   └── /api → FastAPI :8000
```

The frontend should preferably call the backend through the same public origin, such as `/api`, rather than embedding the EC2 public IP into the Vite build.

---

# 2. Repository Structure

The application is separated into three GitHub repositories.

## 2.1 Frontend Repository

```text
persona_stand_frontend/
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

The frontend GitHub Actions workflow builds the frontend Docker image and pushes it to Amazon ECR.

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

The backend GitHub Actions workflow builds the backend Docker image and pushes it to Amazon ECR.

---

## 2.3 EC2 Deployment Repository

```text
persona_stand_ec2yml/
├── docker-compose.ec2.yml
└── README.md
```

This repository contains the Docker Compose configuration used to deploy the application on AWS EC2.

`docker-compose.ec2.yml` pulls the pre-built frontend and backend images from Amazon ECR and runs them on the EC2 instance.

The EC2 repository is a deployment/configuration repository rather than an application source-code repository.

---

## 2.4 Repository and Deployment Relationship

```text
persona_stand_frontend
        │
        │ GitHub Actions
        ▼
      Amazon ECR
   frontend image
        │
        │
        ├──────────────────┐
                           │
persona_stand_back         │
        │                  │
        │ GitHub Actions   │
        ▼                  │
      Amazon ECR           │
   backend image            │
                           │
                           ▼
              persona_stand_ec2yml
                 docker-compose.ec2.yml
                           │
                           ▼
                         EC2
                    ┌─────────────┐
                    │  Frontend   │
                    │  Backend    │
                    └─────────────┘
```

There are two independent GitHub Actions workflows:

```text
persona_stand_frontend/.github/workflows/deploy.yml
        ↓
Build frontend image
        ↓
Push frontend image to ECR
```

and:

```text
persona_stand_back/.github/workflows/deploy.yml
        ↓
Build backend image
        ↓
Push backend image to ECR
```

The third repository does not build the application images. It provides the EC2 deployment configuration that pulls the frontend and backend images from ECR and runs them on the EC2 instance.

---

# 3. Manual Structure

The list showing the overall menu of the setup guildence and onging development procedures

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
    └── A.6 CI/CD Setup

Part B — Local Development Workflow 
    ├── B.1 Repository & Dependencies 
    ├── B.2 Local Database Connection 
    ├── B.3 Local Vertex AI Testing 
    └── B.4 Running the App Locally

Part C — Deployment & Ongoing Operations 
    ├── C.1 First Deployment to a New EC2 Instance
    ├── C.2 Every Redeploy
    ├── C.3 After EC2 Stop/Start 
    └── C.4 Troubleshooting Reference
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

### 0.3 Node.js 20+

Match the frontend's Docker image (`node:20-alpine`).

Run in Local machine terminal
- **All platforms (recommended):** install via [nvm](https://github.com/nvm-sh/nvm) (macOS/Linux) or [nvm-windows](https://github.com/coreybutler/nvm-windows):
```bash
nvm install 20
nvm use 20
```
- **Or download directly:** https://nodejs.org/ (choose the LTS 20.x installer)

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
