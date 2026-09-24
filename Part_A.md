# Part A — First-Time Infrastructure Setup 

> Use this section when provisioning a new AWS/GCP environment or enabling automated testing for an existing installation. Existing installations can start at **A.6** without recreating EC2, ECR, RDS, or GCP resources.

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
- HTTP (80): source = `0.0.0.0/0` if public-facing. Keep it open after HTTPS is on: certificate renewals arrive on 80, and it redirects visitors to HTTPS
- HTTPS (443): source = `0.0.0.0/0` if public-facing (needed from the HTTPS steps below)
- Do **not** open 8000. The backend port is not published on the host (`docker-compose.ec2.yml` uses `expose`, not `ports`), so every API call goes through nginx on port 80/443 and a rule for 8000 would reach nothing

### HTTPS with Let's Encrypt
HTTPS terminates in the frontend container's own nginx, with a free Let's Encrypt certificate that `certbot` on the instance issues and renews. There is no load balancer, so nginx still sees each visitor's real IP address and the rate limits keep working unchanged.

The frontend image serves plain HTTP until `TLS_DOMAIN` is set in `.env`, then HTTPS on 443 with port 80 redirecting to it. The same image works both ways, so the tested release is what runs.

#### Before you start: get a domain name
Let's Encrypt does not issue certificates for a bare IP address, so the site needs a domain. Skip this if you already own one; note which registrar it is with, because step 2 depends on it.

Buying it in Route 53 keeps DNS in the same AWS account and needs no extra DNS setup.
**Where:** AWS Console → **Route 53** → **Registered domains** → **Register domains**.
1. Type the name you want in the search box and click **Search**.
2. Click **Select** next to an available name (a `.com` is about US$15 a year), then **Proceed to checkout**.
3. Choose the duration, leave **Auto-renew** on so the domain does not lapse, and click **Next**.
4. Fill in the contact details. Leave **Privacy protection** on, so your details are hidden from public WHOIS lookups. Click **Next**, review, tick the terms, and click **Submit**.
5. Open the email Route 53 sends to the registrant address and click the verification link. **The domain is suspended after 15 days if this is not done.**
6. Wait for the registration to finish. **Where:** Route 53 → **Registered domains** → **Requests**. It usually takes a few minutes, occasionally hours.

When it finishes, Route 53 creates a **hosted zone** for the domain automatically. That is where step 2 adds the DNS record. A hosted zone costs US$0.50 a month.

Other registrars (Namecheap, GoDaddy, Cloudflare, ...) work equally well. Buy the domain there and use that registrar's own DNS settings in step 2.

#### Steps
1. **Give the instance a fixed address.**
   **Where:** AWS Console → EC2 → **Elastic IPs** → **Allocate Elastic IP address** → **Allocate**. Then select it → **Actions** → **Associate Elastic IP address** → choose your instance → **Associate**.
   Without it, the public IP changes on every stop/start and the domain stops pointing at the site.
2. **Point the domain at it.** Add an **A** record whose value is the Elastic IP, wherever the domain's DNS is managed:
   - **Domain bought in Route 53.** **Where:** Route 53 → **Hosted zones** → click the domain → **Create record**. Leave **Record name** empty for the bare domain (`example.com`), or type `www` for `www.example.com`. Set **Record type** to **A**, paste the Elastic IP into **Value**, and click **Create records**.
   - **Domain bought elsewhere.** **Where:** that registrar's site → your domain → **DNS** (sometimes "Manage DNS" or "DNS records"). Add a record with type **A**, host **`@`** for the bare domain (or **`www`**), and value = the Elastic IP. Delete any existing A record for the same host that points somewhere else, such as a registrar parking page.
   - **No hosted zone listed for a domain you bought in Route 53?** The registration is still in progress or waiting on the verification email (see *Before you start*), or you are signed in to a different AWS account. Hosted zones are global, so the region selector does not matter.

   `<your-domain>` everywhere below is exactly the name you created the record for, e.g. `www.example.com` or `example.com`. The certificate covers only that name.
   Check from your local machine that `nslookup <your-domain>` returns the Elastic IP before continuing. A new record usually works within minutes, but can take up to an hour.
3. **Open port 443.** Add the HTTPS rule in *Security Group Hardening* above.
4. **Deploy a release whose frontend supports HTTPS**, still over plain HTTP, the normal way (Part C). Leave `TLS_DOMAIN` unset for now. Open `http://<your-domain>` in your browser and confirm the site loads.
   `docker compose` creates `~/app/certs` and `~/app/certbot-www` on first start; they stay empty until step 6.
5. **Install certbot.** Run in the EC2 instance terminal:
   ```bash
   sudo apt update && sudo apt install -y certbot
   ```
   On Amazon Linux, use `sudo dnf install -y certbot` instead.
   The package installs a systemd timer that checks twice a day and renews the certificate when it is within 30 days of expiry.
6. **Issue the certificate.** Run in the EC2 instance terminal, with your own domain and email:
   ```bash
   sudo certbot certonly --webroot -w /home/ubuntu/app/certbot-www -d <your-domain> \
     --deploy-hook "sh /home/ubuntu/app/ops/certbot-deploy-hook.sh" \
     --email <your-email> --agree-tos --no-eff-email
   sudo ls -l /home/ubuntu/app/certs
   ```
   `ls` should list `fullchain.pem` and `privkey.pem`, owned by uid `101`.
   - The running site serves certbot's challenge file on port 80, so there's no downtime.
   - The deploy hook copies the certificate where the container can read it, and certbot remembers the hook for every renewal.
   - The email only receives expiry warnings.
7. **Switch the frontend to HTTPS.** Add this line to `~/app/.env`:
   ```env
   TLS_DOMAIN=<your-domain>
   ```
   Then restart only the frontend. Run in the EC2 instance terminal:
   ```bash
   cd ~/app
   docker compose --env-file .env --env-file release-images.env -f docker-compose.ec2.yml up -d frontend
   docker logs persona_frontend 2>&1 | grep persona:
   ```
   The log should say `persona: serving https://<your-domain> on 8443`.
   **Where: your browser.**
   - `https://<your-domain>` shows a padlock.
   - `http://<your-domain>` redirects to it.
   - The chat works.
8. **Mark the session cookie Secure.** Only after step 7 works: add `SESSION_COOKIE_SECURE=true` to `~/app/.env`, then run the same `up -d` command with `backend` instead of `frontend`.
   **Where:** browser DevTools → Application → Cookies → `session`. The **Secure** column should be ticked.
   Then send a chat message to confirm consent and replies still work.
9. **Check that renewal will work.** Run in the EC2 instance terminal:
   ```bash
   sudo certbot renew --dry-run
   systemctl list-timers | grep certbot
   ```
   The first command should report success, and the second should list the timer.
10. **After a few days of working HTTPS**, add `HSTS_MAX_AGE=31536000` to `~/app/.env` and restart the frontend as in step 7.
    HSTS tells browsers to use HTTPS for your domain without asking. It starts at 5 minutes (300 seconds) on purpose: if the certificate broke while a year-long policy was cached, visitors could not fall back to HTTP until it expired.

**Undoing it.** Remove `TLS_DOMAIN`, set `SESSION_COOKIE_SECURE=false`, and restart both services. Browsers that have seen the HSTS header still insist on HTTPS until its max-age runs out.

**If the frontend container keeps restarting after step 7**, run `docker logs persona_frontend`. The container refuses to start when `TLS_DOMAIN` is set but `~/app/certs` holds no certificate; it prints the exact reason. Fix the certificate, or remove `TLS_DOMAIN` to go back to HTTP.

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

Set **Tag immutability: Enabled**, with no exclusions. Only approved major releases are copied here under immutable release labels such as `v0.8.0`; branch builds are published to GHCR. Retain deployed and rollback images.

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

Note the **Endpoint** and **Port** shown on the instance's **Connectivity & security** tab — you'll need these for EC2's `.env` (Part C.1) and for the SSH tunnel used to manage content (Part D.2). Local development does not use RDS; it runs its own database (Part B).

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

# Run in EC2 instance terminal
chmod 644 ~/secrets/gcp-wif-config.json
```

The `chmod` matters: the backend container runs as a non-root user (uid 10001), which cannot read a file that only `ubuntu` can. Vertex AI would then fail on every chat turn with a refresh error that never mentions permissions. The file holds no key material, so world-readable is fine.

## A.6 Automated Testing and GitHub Actions — First-Time Setup

Configure the test and release infrastructure once in this section. Tests run on GitHub's temporary computers: **no running EC2, ECR images, RDS or Google credentials are needed**. AWS is used only for approved promotion and production deployment.

For repeatable application pushes, image selection, testing and release approval, use [Part C.0](Part_C.md#c0-automated-tests-for-every-update).

For a quick lookup of every value and its destination, use [Automated testing and release settings](placeholder_lookup.md#automated-testing-and-release-settings).

**How to read the steps:** **bold text** names a button, tab, menu or field. “Click” means use your browser. “Type” means fill in a field. “Run” means enter a command in the named terminal. GitHub/AWS can change labels slightly; if a control is missing, check that you are in the correct repository/account and have administrator access. These are instructions for you to follow, not confirmation that the settings have already been changed.

### A.6.1 Understand the route

```text
Push frontend or backend, on any branch
  -> independent tests
  -> build once and publish to GHCR
  -> select exact frontend + backend digests in ec2yml
  -> ONE combined browser-test workflow
      -> minor update: keep images in GHCR and test report in GitHub
      -> approved major release: copy tested images unchanged to ECR
          -> EC2 pulls only those promoted ECR digests
```

A commit SHA identifies source code. An image digest identifies exact packaged contents, like a fingerprint. Tags are readable labels; tests and deployment use digests. “Major” means your explicit production release decision, not a branch name or automatic version-number rule.

Push order does not matter. Select a pair once both intended images exist. A frontend-only update retains the previous backend digest and commit. Every changed pair receives the same combined suite.

### A.6.2 Configure application publication

**Where: your browser, GitHub. Repeat the Actions check for frontend and backend.**

1. Open the repository page and click the **Settings** tab near the top. If it is hidden, open the top-tab **…** menu and click **Settings**.
2. In the left sidebar, click **Actions**, then **General**.
3. Find **Actions permissions**. Confirm Actions are enabled and the workflow's actions are allowed by your repository/organisation policy. If you change the selected permission option, click **Save** in that section. The YAML explicitly requests the publishing job's `packages: write`; you do not need to grant every job broad write permission.
4. For frontend only, click **Secrets and variables** in the Settings sidebar, then **Actions**. Click the **Variables** tab, then **New repository variable**.
5. In **Name**, type `VITE_CDN_BASE`. In **Value**, paste your real HTTPS CloudFront base URL. Click **Add variable**. Confirm the variable now appears in the list. If it already exists, use its pencil/**Edit** control, check the value and click **Update variable** only if changing it.
6. Do not create a GHCR password: `GITHUB_TOKEN` is supplied automatically. Application publication does not need AWS credentials.

The CDN value is baked into the image. To change it, make a new source commit and test its new image. Promotion never changes build settings or rebuilds an image.

### A.6.3 Install workflows and initialise GHCR packages

This is a one-time bootstrap step. The packages must exist before you can grant ec2yml access to them.

1. Confirm the frontend/backend repositories contain their `.github/workflows/deploy.yml`, publication script and independent tests. Confirm ec2yml contains its workflows, scripts and test configuration. For a new owner, check the owner/account placeholders in the example selection and IAM templates.
2. Commit and push any initial setup files that are not already on GitHub. Ensure ec2yml's workflows are present on its default branch so their **Run workflow** buttons can appear. A combined run without a selected pair will fail until you complete the first selection; this is expected and is not a passing release test.
3. If your application packages do not yet exist, follow [C.0.1](Part_C.md#c01-push-application-changes-and-collect-ghcr-images) once to publish the first tested application commits. If the intended packages/images already exist, reuse them.
4. Return here and finish A.6.4–A.6.8 before the first end-to-end setup check in A.6.9. Future application updates go directly to Part C; do not reinstall the workflows or recreate roles.

### A.6.4 Give ec2yml read access to both GHCR packages

**Where: your browser, GitHub.**

1. For a personal package, click your profile picture in the top-right, click **Your profile**, then the **Packages** tab. For an organisation package, open the organisation page and click **Packages**.
2. Click the package **persona_stand_front**, then **Package settings**.
3. Scroll to **Manage Actions access** and click **Add Repository**. Search for `persona_stand_ec2yml`, select the matching repository, and use **Add repository** to confirm the selection if the dialog shows that button.
4. In the added repository's row, open its role dropdown and choose **Read**. Confirm ec2yml is listed with Read access. Keep the frontend repository's publishing access.
5. Return to **Packages**, click **persona_stand_back**, and repeat steps 2–4.
6. Leave package visibility unchanged. Both packages can remain private; EC2 does not need a GHCR token.

Package access does not grant permission to read private backend source code; configure that separately below.

### A.6.5 Allow reading private backend test support

Skip this for a public backend. Keep an existing suitable `BACKEND_READ_TOKEN`.

**Where: your browser, GitHub.**

1. Click your profile picture → **Settings**. At the bottom of the left sidebar, click **Developer settings** → **Personal access tokens** → **Fine-grained tokens** → **Generate new token**. Complete password/2FA confirmation if prompted.
2. Fill in **Token name** (for example `ec2yml-backend-read`) and **Expiration**. In **Resource owner**, select the backend's owner.
3. Under **Repository access**, select **Only select repositories**, open **Select repositories**, and select `persona_stand_back`.
4. Under **Permissions**, add/select the repository permission **Contents** and choose **Read-only**. If the interface groups permissions, expand **Repository permissions** first. Click **Generate token** at the bottom.
5. Click the copy icon next to the displayed token. Store it securely; GitHub will not display the full value again. Obtain organisation approval if required.
6. Open the ec2yml repository → click **Settings** → **Secrets and variables** → **Actions** → **Secrets** tab → **New repository secret**.
7. In **Name**, type `BACKEND_READ_TOKEN`. Paste the token into **Secret**. Click **Add secret** and confirm the name appears in the list.

The workflow checks out test support at the selected backend commit. Application code runs from the GHCR image, with test support mounted separately.

### A.6.6 Protect release decisions

**Where: your browser, GitHub.**

1. In each repository, click **Settings** → **Rules** → **Rulesets**. Click **New ruleset** → **New branch ruleset**. If a suitable rule already exists, click its name to edit it instead.
2. Enter a **Ruleset name**. Set **Enforcement status** to **Active**. Under **Target branches**, click **Add target** → **Include by pattern**, enter `main`, and click **Add inclusion pattern**. Add `trial` separately if it also needs protection.
3. Under **Branch rules**, check **Require a pull request before merging** and configure the required approvals for your team. Check **Require status checks to pass**, click **Add checks**, and choose frontend `checks`, backend `test`, or ec2yml `configuration` and `combined-browser`, as appropriate for that repository. Run each workflow once first if its checks do not yet appear. Click **Create** at the bottom, or **Save changes** when editing. Limit bypass access to your intended administrators.
4. In ec2yml, click **Settings** → **Environments** → **New environment**. Type `production` into **Name**, then click **Configure environment**. If it exists, click **production** in the environment list instead.
5. Under **Deployment branches and tags**, open the dropdown and choose **Selected branches and tags**. Click **Add deployment branch or tag rule**. Select **Branch**, enter `main` as the name pattern, and click **Add rule**. Confirm that only the intended main branch rule is listed.
6. Where available, check **Required reviewers**, search for and select your reviewer. With a second reviewer, select **Prevent self-review**; a solo owner must leave that off to approve their own run. Clear **Allow administrators to bypass configured protection rules** if that option is shown and bypass is not intended. Click **Save protection rules**.

Required reviewers depend on GitHub plan and repository visibility. If unavailable, the workflow still requires a write-authorised operator to manually select the successful run and check the approval checkbox. That is a single-operator approval, not an independent second-person gate. If a second-person gate is required, arrange a supported environment before enabling promotion. YAML alone does not configure reviewer protection.

### A.6.7 Prepare ECR for promoted releases

**Where: your browser, AWS Console.**

1. Use the top search bar to search for `ECR`, then click **Elastic Container Registry**. Use the top-right region selector to choose your ECR region.
2. In the sidebar under **Private registry**, click **Repositories**. Select the radio button beside `persona_stand/frontend` and click **Edit**.
3. Under **Image tag mutability**, select **Immutable**. Leave the exclusion list empty. Click **Save**.
4. Repeat for `persona_stand/backend`. Keep existing deployed/rollback images.
5. To inspect retention, click a repository name, then **Lifecycle policy**. Check its rules before making changes; images required for current deployment or rollback must remain available. The same retention requirement applies to the GHCR originals and downloaded evidence.

### A.6.8 Create the promotion IAM role

This role copies images only; it cannot deploy EC2 or manage databases.

**Where: your browser, AWS Console, then GitHub.**

1. In AWS's top search bar, type `IAM` and click **IAM**. Click **Policies** in the left sidebar, then **Create policy**.
2. In the policy editor, click **JSON**. In your local editor, open [iam/promotion-policy.json](iam/promotion-policy.json), replace `YOUR_ACCOUNT_ID` with your 12-digit account ID and change the region if needed. Copy the completed JSON into the AWS editor, replacing its existing contents.
3. Click **Next**. Enter `PersonaStandPromotionECRWrite` in **Policy name**, review the two repository resources, then click **Create policy**.
4. Click **Identity providers** in the IAM sidebar. If `token.actions.githubusercontent.com` exists, keep it. Otherwise click **Add provider**, choose **OpenID Connect**, enter `https://token.actions.githubusercontent.com` in **Provider URL** and `sts.amazonaws.com` in **Audience**, then click **Add provider** to finish.
5. Click **Roles** → **Create role**. Under trusted entity type, select **Custom trust policy**. Paste the completed [iam/promotion-trust.json](iam/promotion-trust.json), replacing `YOUR_ACCOUNT_ID` and `chrislee3405` if necessary. Click **Next**.
6. In the permissions-policy search box, type `PersonaStandPromotionECRWrite`. Select its checkbox, then click **Next**.
7. In **Role name**, enter `PersonaStandPromotionRole`. Review the trust subject: it must end in `persona_stand_ec2yml:environment:production`. Click **Create role**.
8. Click the new role's name in the Roles list. In its summary, click the copy icon beside **ARN**.
9. In GitHub ec2yml, click **Settings** → **Environments** → **production**. Scroll to **Environment variables**, then click **Add environment variable**.
10. Enter `AWS_PROMOTION_ROLE_ARN` in **Name**, paste the ARN in **Value**, and click **Add variable**. Repeat to add `AWS_REGION` with value `ap-southeast-2` (or your actual region). Confirm both names appear under Environment variables, not Environment secrets.

The environment trust subject does not contain a branch name: A.6.6's **main-only environment restriction is essential**. Builds and combined tests get no AWS credentials. EC2 keeps its existing ECR read-only instance role.

### A.6.9 Verify setup and hand over to the update workflow

1. Follow [C.0.2](Part_C.md#c02-select-the-pair-and-run-combined-tests--minor-and-major) once using the two existing GHCR images. Confirm both jobs pass and download their result artifact.
2. If required status-check names were unavailable when configuring A.6.6, return to its ruleset settings, add the now-visible checks, and click **Save changes**.
3. Confirm package read access, private backend source access if needed, production environment restrictions, IAM role and its environment variables are saved. You do not need to promote a release just to finish testing setup.
4. First-time setup is complete. For every future minor or major update, start at [Part C.0](Part_C.md#c0-automated-tests-for-every-update). Use [Part B](Part_B.md#b5-local-automated-tests) for local tests while developing.

The setup in A.6.6–A.6.8 is needed for production releases. If you are currently enabling testing only, you can defer production setup until before your first promotion; it is not part of every minor update.

References: [GHCR access](https://docs.github.com/en/packages/working-with-a-github-packages-registry/working-with-the-container-registry), [environment protection availability](https://docs.github.com/en/actions/how-tos/deploy/configure-and-manage-deployments/manage-environments), [ECR permissions](https://docs.aws.amazon.com/AmazonECR/latest/userguide/image-push-iam.html), [Skopeo copy](https://github.com/containers/skopeo/blob/main/docs/skopeo-copy.1.md).

Button-label references: [GitHub Actions settings](https://docs.github.com/en/repositories/managing-your-repositorys-settings-and-features/enabling-features-for-your-repository/managing-github-actions-settings-for-a-repository), [package access](https://docs.github.com/en/packages/learn-github-packages/configuring-a-packages-access-control-and-visibility), [branch rulesets](https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/managing-rulesets/creating-rulesets-for-a-repository), [IAM role creation](https://docs.aws.amazon.com/IAM/latest/UserGuide/id_roles_create_for-custom.html), [ECR tag settings](https://docs.aws.amazon.com/AmazonECR/latest/userguide/image-tag-mutability.html).
