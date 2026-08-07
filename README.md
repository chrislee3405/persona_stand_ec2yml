# persona_stand_ec2yml
For ec2 to pull image from ECR

# Deploying to EC2 with Docker Compose

This guide walks through deploying the app to an EC2 instance using `docker-compose.ec2.yml` and images stored in AWS ECR.

## Prerequisites

Before starting, make sure the EC2 instance has:

- **Docker** and the **Docker Compose plugin** installed (`docker compose version` should work)
- **AWS CLI v2** installed and configured with credentials/role that has `ecr:GetAuthorizationToken` and pull permissions on the relevant repositories
- **Git** installed (if using the clone method in Step 1)
- Inbound rules on the instance's **security group** allowing traffic on the ports the app uses (e.g. `8000` for the API, plus whatever port the frontend serves on)

## 1. Get `docker-compose.ec2.yml` onto the EC2 instance

**Option A — Clone the repository**

```bash
# Create a project folder and clone your repo
mkdir -p ~/app && cd ~/app
git clone https://github.com/{your-username}/{your-backend-repo}.git .

# Verify docker-compose.ec2.yml is present
ls -la
```

**Option B — Copy/paste directly with nano**

```bash
mkdir -p ~/app && cd ~/app
nano docker-compose.ec2.yml
# Paste the YAML content, then save: Ctrl+O -> Enter -> Ctrl+X
```

**Future yml update — Git pull**

```bash
cd ~/app
git pull
```

## 2. Create the `.env` file

```bash
cd ~/app
nano .env
```

Paste in the runtime environment variables:

```env
AWS_ACCOUNT_ID=123456789012      # 12-digit AWS account ID
VITE_API_URL=http://<EC2_PUBLIC_IPV4>:8000
```

> **Note:** `VITE_API_URL` must be updated whenever the instance stops/starts, since EC2 assigns a new public IP on restart (unless you attach an [Elastic IP](https://docs.aws.amazon.com/AWSEC2/latest/UserGuide/elastic-ip-addresses-eip.html), in which case the IP stays fixed).

Save with `Ctrl+O -> Enter -> Ctrl+X`.

## 3. Authenticate, pull, and launch

```bash
cd ~/app

# 1. Log Docker in to your AWS ECR registry (token valid for 12 hours)
aws ecr get-login-password --region ap-southeast-2 | docker login --username AWS --password-stdin <AWS_ACCOUNT_ID>.dkr.ecr.ap-southeast-2.amazonaws.com

# 2. Pull the latest backend and frontend images from ECR
docker compose -f docker-compose.ec2.yml pull

# 3. Start the app in detached (background) mode
docker compose -f docker-compose.ec2.yml up -d
```

> Replace `ap-southeast-2` in both the `--region` flag and the ECR hostname if your images live in a different region — the two must match.

## Verifying the deployment

```bash
# Check that both containers (persona_backend, persona_frontend) are running
docker compose -f docker-compose.ec2.yml ps

# Tail logs if something fails to start
docker compose -f docker-compose.ec2.yml logs -f
```

Once running, the app is accessible at:

```
http://<EC2_PUBLIC_IP>
```

## Troubleshooting

| Symptom | Likely cause |
|---|---|
| `docker login` fails | ECR region mismatch, expired/missing AWS credentials, or missing IAM permissions |
| `pull` fails with "not found" | Image tag doesn't exist in ECR, or wrong `AWS_ACCOUNT_ID` in `.env` |
| Frontend can't reach backend | `VITE_API_URL` is stale after an instance restart — update `.env` and re-run `up -d` |
| Can't load app in browser | Security group isn't allowing inbound traffic on the app's port |