# Part A — First-Time Infrastructure Setup 

> Only the person provisioning a *new* AWS/GCP environment needs this section.

## A.1 Access Your AWS Account

Log in to the [AWS Console](https://console.aws.amazon.com). No local AWS CLI configuration (`aws configure`, access keys) is needed for the setup steps below — everything CLI-based either runs **on EC2 itself** (using its attached instance role) or in **AWS CloudShell** (⚠️ some commands, like enforcing IMDSv2, specifically require root/admin-level console authorization and won't work from the EC2 instance's own limited role — CloudShell picks up whatever account you're logged into the console with).

## A.2 EC2 Setup

### Launch the instance
1. **EC2** → **Launch instance**.
2. Name it (e.g. `persona-stand-backend`).
3. AMI: **Ubuntu Server 24.04 LTS**.
4. Instance type: `t3.micro` (free-tier eligible) or larger depending on load.
5. Key pair: create a new one, download the `.pem` file, store it somewhere safe on your **local machine** (e.g. `~/.ssh/persona_stand_key.pem` or `C:\Users\<you>\.ssh\persona_stand_key.pem`). ⚠️ **Secret — never commit this file.**
6. Network settings: allow SSH (22) from **My IP** only for now (tighten further in the Security Hardening step below).
7. Launch.

### Connect and prepare the environment
Run in Local machine terminal
```bash
chmod 400 /path/to/your-key.pem      # macOS/Linux only
ssh -i /path/to/your-key.pem ubuntu@<ec2-public-ip>
```

Everything below in this subsection runs **on the EC2 instance**, inside the SSH session you just opened.

**Install Git:**

Run in EC2 instance terminal
```bash
sudo apt update && sudo apt install -y git
git --version
```

**System update:**

Run in EC2 instance terminal
```bash
sudo apt update && sudo apt upgrade -y
```

**Install Docker Engine + Compose plugin**

Run in EC2 instance terminal
```bash
sudo apt install -y ca-certificates curl gnupg
sudo install -m 0755 -d /etc/apt/keyrings
curl -fsSL https://download.docker.com/linux/ubuntu/gpg | sudo gpg --dearmor -o /etc/apt/keyrings/docker.gpg
sudo chmod a+r /etc/apt/keyrings/docker.gpg

echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] https://download.docker.com/linux/ubuntu $(. /etc/os-release && echo "$VERSION_CODENAME") stable" | sudo tee /etc/apt/sources.list.d/docker.list > /dev/null

sudo apt update
sudo apt install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
sudo systemctl enable --now docker
```

**Docker permissions (run Docker without `sudo`)**

Run in EC2 instance terminal
```bash
sudo usermod -aG docker $USER
newgrp docker
```

**Docker log rotation (prevents unbounded disk growth)**

Run in EC2 instance terminal
```bash
sudo tee /etc/docker/daemon.json <<'EOF'
{
  "log-driver": "json-file",
  "log-opts": { "max-size": "10m", "max-file": "3" }
}
EOF
sudo systemctl restart docker
```

**AWS CLI v2**

Run in EC2 instance terminal
```bash
curl "https://awscli.amazonaws.com/awscli-exe-linux-x86_64.zip" -o "awscliv2.zip"
sudo apt install -y unzip
unzip awscliv2.zip
sudo ./aws/install
aws --version
rm -rf awscliv2.zip aws/
```

### Attach an IAM Role (so EC2 can pull from ECR without stored keys)

1. **IAM** → **Roles** → **Create role**.
2. Trusted entity: **AWS service** → **EC2**.
3. Attach policy: `AmazonEC2ContainerRegistryReadOnly` (or a custom policy scoped to just your repos, for least-privilege).
4. Name it (e.g. `EC2-ECR-ReadOnly-Role`) → create.
5. **EC2 Console** → **Instances** → select your instance → **Actions → Security → Modify IAM role** → select the role you just created → save.

### Enforce IMDSv2
⚠️ **Run in AWS CloudShell** (in the browser, NOT the EC2 SSH session) — the instance's own attached role only has ECR permissions, so running this via SSH on the instance itself will fail with a permissions error.
```bash
aws ec2 modify-instance-metadata-options \
  --instance-id <your-instance-id> \
  --http-tokens required \
  --http-endpoint enabled
```

### Security Group Hardening
EC2 Console → your instance → **Security** tab → click the security group → **Edit inbound rules**:
- SSH (22): source = your IP or VPN CIDR only, never `0.0.0.0/0`
- HTTP (80): source = `0.0.0.0/0` if public-facing
- Custom TCP (8000), only if you need direct API access outside the reverse proxy — otherwise omit and route everything through port 80

### Reverse Proxy + TLS (recommended for production)
If this deployment is public-facing, terminate TLS and route traffic through nginx/Caddy/an AWS ALB in front of both containers rather than exposing raw ports directly. (The included `nginx.conf` — **edited on your local machine, then deployed via the frontend Docker image** — already proxies `/api/` to the backend container; you just need TLS termination in front of it, e.g. via Let's Encrypt/Certbot running **on the EC2 instance**, or an ACM certificate on an ALB configured in the **AWS Console**.)

### Automatic Security Patching
Run in EC2 instance terminal
```bash
sudo apt install -y unattended-upgrades
sudo dpkg-reconfigure --priority=low unattended-upgrades
```

### Container Restart Policy
In `docker-compose.ec2.yml` on  **local machine**, in the `persona_stand_ec2yml` repo (then committed/pushed — it takes effect on EC2 the next time you `docker compose up -d` there)
Confirm every service has:
```yaml
restart: unless-stopped
```

## A.3 ECR Setup

### Create repositories
**ECR** → **Create repository**, once each for:
- `persona_stand/backend`
- `persona_stand/frontend`

Set **Tag immutability: Enabled**, with `latest` as an **exclusion** pattern if your workflow re-pushes `latest` on every build.

### Test EC2 → ECR authentication

Run in EC2 instance terminal
```bash
aws ecr get-login-password --region ap-southeast-2 | docker login --username AWS --password-stdin <AWS_ACCOUNT_ID>.dkr.ecr.ap-southeast-2.amazonaws.com
```
This should succeed (confirming pull access). It will *not* let you run AWS management commands like `modify-instance-metadata-options` — that's expected, since the attached role only grants ECR read access, not EC2 management permissions.

## A.4 RDS Setup

### Network preparation
1. **RDS** → create a dedicated **security group** for the database.
2. Inbound rules: allow port 5432 from **EC2's security group** (reference the SG ID directly, not an IP) — plus, temporarily, your own IP for initial setup/testing via SSH tunnel.
3. Ensure your **DB Subnet Group** spans at least two Availability Zones.

### Create the instance
1. **RDS Console** → **Create database** → **Standard create**.
2. Engine: **PostgreSQL**.
3. Template: **Free tier** or **Dev/Test**, depending on budget.
4. Set a master username and password. ⚠️ **Secret — store this somewhere safe on your local machine, e.g. a password manager; AWS will not show it again.**
5. Instance class: `db.t3.micro` / `db.t4g.micro` for light use.
6. Public access: **No** (app connects via VPC/tunnel, not the public internet).
7. Attach the security group from the step above.
8. Under **Additional configuration**, set an **Initial database name** — if you skip this, you'll need to create a database manually after connecting.
9. Create database, and wait for it to become available.

Note the **Endpoint** and **Port** shown on the instance's **Connectivity & security** tab — you'll need these for both local development and EC2's `.env`.

## A.5 GCP / Vertex AI Setup

### Create a project
Go to GCP Console (browser) — console.cloud.google.com
Project dropdown → **New Project**. Note both the **Project ID** (string) and, later, the **Project Number** (numeric) — they are different values used in different places.

### Enable the Vertex AI API
Search "Vertex AI API" → **Enable**.

### Create a service account
**IAM & Admin → Service Accounts → Create Service Account**.
- Grant role: **Vertex AI User** (or the specific role your app needs).
- Leave "Principals with access" blank for a solo project; add teammates later if needed.

### Create a Workload Identity Pool
**IAM & Admin → Workload Identity Federation → Create Pool**.
- Choose **AWS** as the provider type, and supply your AWS Account ID when prompted.
- Name the pool and provider anything memorable (e.g. `aws-ec2-pool`, `aws-provider`).

### Get EC2's real IAM role name
⚠️ Fetch this directly from the instance — don't type or guess it, a mismatch here causes a hard-to-diagnose permission error later.

Run in EC2 instance terminal, *inside the backend Docker container*
```bash
docker exec <backend-container-name> sh -c '
TOKEN=$(curl -s -X PUT "http://169.254.169.254/latest/api/token" -H "X-aws-ec2-metadata-token-ttl-seconds: 21600")
curl -s -H "X-aws-ec2-metadata-token: $TOKEN" http://169.254.169.254/latest/meta-data/iam/security-credentials/
'
```
Or, before the app is running — **Where: EC2 instance (via SSH), directly on the host, not in a container**:
```bash
aws sts get-caller-identity
```

### Allow that AWS role to impersonate the GCP service account

Run in Local machine terminal (`gcloud` CLI) — or GCP Cloud Shell in the browser, either works
Get your project number:
```bash
gcloud projects describe <project-id> --format="value(projectNumber)"
```
Grant the binding, using the exact role name from the previous step:
```bash
gcloud iam service-accounts add-iam-policy-binding \
    <service-account-name>@<project-id>.iam.gserviceaccount.com \
    --project=<project-id> \
    --role="roles/iam.workloadIdentityUser" \
    --member="principalSet://iam.googleapis.com/projects/<PROJECT_NUMBER>/locations/global/workloadIdentityPools/<pool-id>/attribute.aws_role/arn:aws:sts::<AWS_ACCOUNT_ID>:assumed-role/<REAL_ROLE_NAME>"
```

### Generate the credential configuration file
Run in Local machine terminal, or GCP Cloud Shell in the browser
```bash
gcloud iam workload-identity-pools create-cred-config \
    projects/<PROJECT_NUMBER>/locations/global/workloadIdentityPools/<pool-id>/providers/<provider-id> \
    --service-account=<service-account-name>@<project-id>.iam.gserviceaccount.com \
    --aws \
    --output-file=gcp-wif-config.json
```
⚠️ **Open the generated file** (wherever you ran the command — locally in a text editor, or in Cloud Shell's editor) **and check the `credential_source` block includes `imdsv2_session_token_url`.** Some `gcloud` versions omit it, which causes a silent `RefreshError: Unable to retrieve AWS region` on IMDSv2-enforced instances. If missing, add it manually:
```json
"imdsv2_session_token_url": "http://169.254.169.254/latest/api/token"
```
This file contains no actual private key material — it only describes how to fetch a token — so it's safe to keep in a private repo, but treat it as configuration, not a plaintext secret like an API key.

### Copy the config to EC2
```bash
# Run in GCP Cloud Shell (browser) — only if you generated the file there
cloudshell download gcp-wif-config.json

# Run in Local machine terminal
ssh -i /path/to/your-key.pem ubuntu@<ec2-public-ip>

# Run in EC2 instance terminal — inside the session you just opened
mkdir -p ~/secrets
exit

# Run in Local machine terminal
scp -i /path/to/your-key.pem /path/to/gcp-wif-config.json ubuntu@<ec2-public-ip>:~/secrets/gcp-wif-config.json
```

## A.6 CI/CD Setup

Go to GitHub
In each of your **frontend** and **backend** GitHub repositories:
1. **Settings → Secrets and variables → Actions**.
2. Add repository variables: `AWS_REGION`, `AWS_ROLE_ARN` (a role trusting GitHub's OIDC provider, scoped to push access on your ECR repos — `AmazonEC2ContainerRegistryPowerUser` or a scoped equivalent, created in the **AWS Console**), `ECR_REPOSITORY`.
3. Confirm `.github/workflows/deploy.yml` exists in both repos (viewable on GitHub, or in your **local machine**'s clone of each repo) and builds + pushes to ECR on push.

---
