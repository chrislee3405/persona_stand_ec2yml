# EC2 Setup for Docker Deployment - Ubuntu 26.04


---

## 0. Git install

Install Git in EC2 as CLI git clone is used to get docker-compose.ec2.yml from Github repository

```bash
sudo apt install -y git
git --version
# check if git is installed properly
```

---



---

## 1. System Update & Package Refresh 

Synchronize the OS package index and upgrade existing dependencies to ensure stability and security.

```bash
sudo apt update && sudo apt upgrade -y
```

---

## 2. Docker & Docker Compose Installation 

Docker engine executes containerized software, while Docker Compose handles multi-container configurations - essential for Vite frontend, FastAPI backend with a database. These are Docker's own documentation recommends and what's used in most production runbooks.

```bash
# Install prerequisites
sudo apt install -y ca-certificates curl gnupg

# Add Docker's official GPG key
sudo install -m 0755 -d /etc/apt/keyrings
curl -fsSL https://download.docker.com/linux/ubuntu/gpg | sudo gpg --dearmor -o /etc/apt/keyrings/docker.gpg
sudo chmod a+r /etc/apt/keyrings/docker.gpg

# Add the Docker repository
echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] https://download.docker.com/linux/ubuntu $(. /etc/os-release && echo "$VERSION_CODENAME") stable" | sudo tee /etc/apt/sources.list.d/docker.list > /dev/null

# Install Docker Engine, CLI, containerd, Buildx, and Compose plugin
sudo apt update
sudo apt install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin

# Enable and start Docker service
sudo systemctl enable --now docker
```

For easy setup, can use docker.io, it is community-maintained and typically lags behind Docker's official releases by months, missing security patches and newer Compose/BuildKit features.

```bash
# Install Docker and Docker Compose plugin
sudo apt install -y docker.io docker-compose-v2

# Enable and start Docker service
sudo systemctl enable --now docker
```



---

## 3. Docker User Permissions Configuration

By default, Docker's control socket (`/var/run/docker.sock`) is owned by root. Without this step, every `docker` command requires `sudo`. Adding the default `ubuntu` user to the `docker` group fixes this.

```bash
# Add current user to the docker group
sudo usermod -aG docker $USER

# Refresh current shell session group membership
newgrp docker
```

---

## 4. Docker Daemon Log Rotation

Docker's default `json-file` log driver has no size cap. Long-running containers can silently fill the disk over time without this.

```bash
# paste it as in multiple line
sudo tee /etc/docker/daemon.json <<'EOF'
{
  "log-driver": "json-file",
  "log-opts": { "max-size": "10m", "max-file": "3" }
}
EOF
sudo systemctl restart docker
```

---

## 5. AWS CLI v2 Installation 

The AWS Command Line Interface (CLI) is required on EC2 instance so Docker can request temporary authentication tokens from Amazon ECR.
A cleanup step at the end to remove installer artifacts.

```bash
# Download the official AWS CLI v2 installer bundle
curl "https://awscli.amazonaws.com/awscli-exe-linux-x86_64.zip" -o "awscliv2.zip"

# Install unzip utility
sudo apt install -y unzip

# Extract the installer archive
unzip awscliv2.zip
# just type A then

# Run the installation script
sudo ./aws/install

# Verify installation
aws --version

# Clean up installer files
rm -rf awscliv2.zip aws/
```

---

## 6. Attach an IAM Role to the EC2 Instance 

Instead of storing permanent AWS Access Keys (`AWS_ACCESS_KEY_ID`) on the instance, attach an IAM Role directly so it can pull images from ECR securely.

- Go to **AWS Console -> IAM -> Roles -> Create Role**.
- Select **AWS service -> EC2**. Attach the managed policy: `AmazonEC2ContainerRegistryReadOnly`.
  - **Consider:** if you want least-privilege, replace this AWS-managed policy with a custom policy scoped to only the specific ECR repositories this instance needs (`persona_stand/frontend`, `persona_stand/backend`, etc.) instead of read access to every repo in the account.
- Name it `EC2-ECR-ReadOnly-Role` and save it.
- Go back to **EC2 Console -> Instances**, select your instance -> **Actions -> Security -> Modify IAM role**.
- Select `EC2-ECR-ReadOnly-Role` and save.

Now EC2 can log in to ECR without storing sensitive API credentials on disk.

---

## 7. Enforce IMDSv2 

 by default, EC2 instances accept both IMDSv1 and IMDSv2. IMDSv1 is vulnerable to SSRF-based credential theft (an attacker who can trick your app into making an internal HTTP request can steal the IAM role's temporary credentials). Enforcing v2-only closes this off.
 This commend needed to run in AWS CloudShell with root account authorisation, runing it in SSH will show error message.

```bash
                                                       i-0967381552987a8bb
aws ec2 modify-instance-metadata-options --instance-id <your-instance-id> --http-tokens required --http-endpoint enabled
```


---

## 8. Amazon ECR Authentication Test 

After attaching the IAM role, you no longer need to hardcode `AWS_ACCESS_KEY_ID` or `AWS_SECRET_ACCESS_KEY`. The AWS CLI automatically fetches temporary credentials from the EC2 Instance Metadata Service (IMDS).

```bash
# Authenticate Docker against your private ECR registry
aws ecr get-login-password --region ap-southeast-2 | docker login --username AWS --password-stdin 552823820482.dkr.ecr.ap-southeast-2.amazonaws.com
```
It is expected to have [ERROR] message, as AmazonEC2ContainerRegistryReadOnly grants only ECR read/pull permissions. It deliberately does not include ec2:ModifyInstanceMetadataOptions - that's an EC2 management action, completely unrelated to ECR. This is expected, least-privilege behavior working as intended, not a bug.
---

## 9. Automatic Security Patching 

keeps OS-level packages (like `glibc`, `perl`, etc.) patched automatically as security fixes are released, reducing exposure to CVEs found in container/image scans.

```bash
sudo apt install -y unattended-upgrades
sudo dpkg-reconfigure --priority=low unattended-upgrades
```

---

## 10. Security Group / Firewall Hardening

At minimum:

- Restrict inbound **SSH (22)** to your IP or VPN CIDR only - never `0.0.0.0/0`.
- Only expose the ports your application actually needs publicly (e.g. 80/443).
- Don't expose FastAPI/Vite dev ports directly to the internet - put a reverse proxy in front (see step 11).

Configure this under **EC2 Console -> Security Groups** for the instance.

---

## 11. Reverse Proxy + TLS 

if this deployment is public-facing, terminate TLS and route traffic through a reverse proxy (nginx, Caddy, or an AWS ALB) in front of the Vite frontend and FastAPI backend containers, rather than exposing their raw container ports directly. This also gives you a single place to manage HTTPS certificates (e.g. via Let's Encrypt/Certbot or ACM if using an ALB).

---

## 12. Container Restart Policy 

ensure `docker-compose.yml` sets a restart policy on every service so containers come back up automatically after a reboot or crash, without manual intervention:

```yaml
services:
  frontend:
    restart: unless-stopped
  backend:
    restart: unless-stopped
  db:
    restart: unless-stopped
```

---

