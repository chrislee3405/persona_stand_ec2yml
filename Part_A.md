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
- HTTP (80): source = `0.0.0.0/0` if public-facing
- Do **not** open 8000. The backend port is not published on the host (`docker-compose.ec2.yml` uses `expose`, not `ports`), so every API call goes through nginx on port 80 and a rule for 8000 would reach nothing

### Reverse Proxy + TLS (recommended for production)
If this deployment is public-facing, terminate TLS in front of the frontend container. The included `nginx.conf` — **edited on your local machine, then deployed via the frontend Docker image** — already proxies `/api/` to the backend container, so only TLS termination is missing: e.g. Let's Encrypt/Certbot **on the EC2 instance** (nginx already serves `/.well-known/acme-challenge/` from `/var/www/certbot`, which needs a volume mounted there), or an ACM certificate on an ALB configured in the **AWS Console**. Once HTTPS works end to end, set `ENV=production` in the instance's `.env` — not before: it marks the session cookie `Secure`, and a browser never sends that over plain HTTP (see the note in `docker-compose.ec2.yml`).

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

This replaces the old ECR-based testing setup. Tests run on GitHub's temporary computers: **no running EC2, ECR images, RDS or Google credentials are needed**. AWS is used only for approved promotion and production deployment.

Already followed the old steps before Step 8? See A.6.12 below for cleanup. Keep your working production infrastructure.

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
6. Do not create a GHCR password: `GITHUB_TOKEN` is supplied automatically. Remove old AWS settings only after the new workflows are active, following A.6.12.

The CDN value is baked into the image. To change it, make a new source commit and test its new image. Promotion never changes build settings or rebuilds an image.

### A.6.3 Publish the first GHCR images

1. Review and commit the frontend changes, then push your working branch (for example `dev/v0.8.0`). Repeat independently for backend. No merge to trial/main is necessary just to publish.
2. **Browser, GitHub:** click the repository's **Actions** tab. In the left workflow list, click **Test and publish frontend** (or **Test and publish backend**). Click the run whose commit matches your push. Wait for its checks and `build-and-push` to show green checkmarks.
3. Click **Summary** in the run's left sidebar. Scroll to **Published commit image** and copy `image` and `revision`. To download the record, scroll to **Artifacts** and click the `ghcr-image-COMMIT` artifact name. On Windows, open Downloads, right-click the downloaded ZIP, click **Extract All…**, then **Extract**, and open `image.json` in your editor.
4. Keep both records. The tag is `sha-FULL_COMMIT`; the selection must use the full `ghcr.io/OWNER/persona_stand_front@sha256:...` or `persona_stand_back` reference.

Every branch push publishes after passing tests. Pull-request events test only; they do not publish synthetic merge commits. Reruns reuse the existing commit image and check its labels. Authentication/network errors stop publication. Retain commit tags and tested images; deleting or manually overwriting them destroys reproducibility. New image contents require a new source commit.

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

### A.6.6 Select the pair and run combined tests

1. Locally in ec2yml, copy `release-versions.example.json` to `release-versions.json`.
2. Replace frontend `image` and `revision` with values from its build record. Repeat for backend; do not shorten either digest or commit.
3. In the ec2yml terminal run `npm ci`, then `npm run release:validate`. This produces generated `selected-release.json`; do not commit that generated file.
4. Review and commit the workflows, scripts, documentation and completed `release-versions.json`; push ec2yml. The workflow runs on every branch push and same-repository PR. Fork PRs receive configuration checks only.
5. **Browser, GitHub:** click ec2yml **Actions** → **Combined browser tests** in the left sidebar → the run matching your push. Check that both `configuration` and `combined-browser` have green checkmarks. To inspect a failure, click the failed job name, then click the failed step to expand its log.
6. Click the run's **Summary**, scroll to **Artifacts**, and click `combined-test-results-RUN_ID-ATTEMPT` to download it. Extract the ZIP on your computer. `test-results/release-result.json` must say `passed` and contain the intended images, source SHAs, coordinator SHA, run ID and attempt. Browser reports/logs explain failures.

**To start the combined workflow manually — browser, GitHub:**

1. First ensure the workflow file exists on the default branch; otherwise its manual-run control will not appear.
2. Click ec2yml **Actions** → **Combined browser tests** in the left sidebar.
3. Click **Run workflow** above the run list to open the input panel. Open the **Branch** selector and choose `main` for a promotable release.
4. Leave all four image/commit fields empty to use the committed selection, or fill in all four with the intended pair.
5. Click the green **Run workflow** button inside the panel to submit. This is a second click: opening the panel alone does not start anything.
6. Refresh the run list if necessary, click the new run, then inspect its jobs and artifact as above.

Promotion accepts successful main push/manual runs, not PR or development-coordinator runs.

A minor update ends here: nothing goes to ECR. Artifact retention is 90 days, subject to repository limits. Download release evidence for longer retention. If evidence expires, test the same GHCR digests again; never rebuild them to obtain a receipt.

### A.6.7 Protect release decisions

**Where: your browser, GitHub.**

1. In each repository, click **Settings** → **Rules** → **Rulesets**. Click **New ruleset** → **New branch ruleset**. If a suitable rule already exists, click its name to edit it instead.
2. Enter a **Ruleset name**. Set **Enforcement status** to **Active**. Under **Target branches**, click **Add target** → **Include by pattern**, enter `main`, and click **Add inclusion pattern**. Add `trial` separately if it also needs protection.
3. Under **Branch rules**, check **Require a pull request before merging** and configure the required approvals for your team. Check **Require status checks to pass**, click **Add checks**, and choose frontend `checks`, backend `test`, or ec2yml `configuration` and `combined-browser`, as appropriate for that repository. Run each workflow once first if its checks do not yet appear. Click **Create** at the bottom, or **Save changes** when editing. Limit bypass access to your intended administrators.
4. In ec2yml, click **Settings** → **Environments** → **New environment**. Type `production` into **Name**, then click **Configure environment**. If it exists, click **production** in the environment list instead.
5. Under **Deployment branches and tags**, open the dropdown and choose **Selected branches and tags**. Click **Add deployment branch or tag rule**. Select **Branch**, enter `main` as the name pattern, and click **Add rule**. Confirm that only the intended main branch rule is listed.
6. Where available, check **Required reviewers**, search for and select your reviewer. With a second reviewer, select **Prevent self-review**; a solo owner must leave that off to approve their own run. Clear **Allow administrators to bypass configured protection rules** if that option is shown and bypass is not intended. Click **Save protection rules**.

Required reviewers depend on GitHub plan and repository visibility. If unavailable, the workflow still requires a write-authorised operator to manually select the successful run and check the approval checkbox. That is a single-operator approval, not an independent second-person gate. If a second-person gate is required, arrange a supported environment before enabling promotion. YAML alone does not configure reviewer protection.

### A.6.8 Prepare ECR for promoted releases

**Where: your browser, AWS Console.**

1. Use the top search bar to search for `ECR`, then click **Elastic Container Registry**. Use the top-right region selector to choose your ECR region.
2. In the sidebar under **Private registry**, click **Repositories**. Select the radio button beside `persona_stand/frontend` and click **Edit**.
3. Under **Image tag mutability**, select **Immutable**. Remove the old `main`/`trial` exclusion entries using their remove control, if present. Click **Save**.
4. Repeat for `persona_stand/backend`. Keep existing deployed/rollback images.
5. To inspect retention, click a repository name, then **Lifecycle policy**. Check its rules before making changes; images required for current deployment or rollback must remain available. The same retention requirement applies to the GHCR originals and downloaded evidence.

### A.6.9 Create the promotion IAM role

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

The environment trust subject does not contain a branch name: A.6.7's **main-only environment restriction is essential**. Builds and combined tests get no AWS credentials. EC2 keeps its existing ECR read-only instance role.

### A.6.10 Approve and promote a major release

**Where: your browser, GitHub.**

1. Click ec2yml **Actions** → **Combined browser tests** → the successful main run for your intended pair. Click **Summary** and confirm both jobs passed.
2. Copy the run ID from your browser address (`.../actions/runs/123456789`). The downloaded artifact name `combined-test-results-RUN_ID-ATTEMPT` gives the exact attempt number; copy its final number as well.
3. Click **Actions** again. In the left sidebar, click **Approve major release and promote to ECR**. Click **Run workflow** above the run list.
4. In the panel, open **Branch** and select `main`. Fill in the run-ID field, attempt-number field and release-version field (for example `v0.8.0`). Check **I approve copying this tested pair to production ECR**. Click the green **Run workflow** button inside the panel.
5. Click the newly created run. If it is waiting for environment approval, click **Review deployments**, select the checkbox beside **production**, review the test result, and click **Approve and deploy**. Despite that GitHub button's wording, this workflow only promotes images to ECR; it does not deploy to EC2.
6. Wait for the `promote` job to show a green checkmark. It validates evidence, copies both images with digest preservation and verifies the ECR digests; no build occurs. If it fails, click **promote**, then the red failed step to read its log.
7. Click **Summary**, scroll to **Artifacts**, and click `promoted-release-VERSION-RUN_ID-ATTEMPT`. Extract the downloaded ZIP and keep `promotion.json`, `release-images.env` and the included test evidence together. Continue to Part C for EC2 deployment.

A failed copy does not create a successful receipt. One image may already have copied; rerun with the same pair and label. Never reuse a label for different contents. Promotion does not automatically restart EC2.

### A.6.11 Troubleshooting

| Symptom | Check |
| --- | --- |
| GHCR publication denied | packages-write, organisation policy, existing package publishing access. |
| GHCR pull denied | Both packages grant ec2yml Actions read access. |
| Private source checkout denied | BACKEND_READ_TOKEN scope, expiry and approval. |
| No release selected | Complete the manifest or all four manual inputs. |
| Promotion rejects evidence | Successful main push/manual run, correct attempt, same workflow/repository, unexpired artifact. |
| AWS AssumeRole denied | Environment branch rule, exact ARN and trust subject. |
| Existing ECR tag conflict | Retries must use the same pair; new contents need a new release label. |
| Digest changes during copy | Stop; diagnose registry/tool handling. Do not deploy or rebuild. |

Tests use temporary PostgreSQL, fake Gemini and blocked media. Live TLS, real AI quality, CDN availability and production migrations still need separate checks.

### A.6.12 Clean up the old configuration before old Step 8

These are the old guide's step numbers. Clean up after the new workflows are active. This does not undo your working production infrastructure.

1. **Record old role ARNs first.** Copy the old ec2yml `AWS_TEST_ROLE_ARN` and application `AWS_ROLE_ARN` values into a temporary note so you can identify the exact roles later. They are identifiers, not passwords.
2. **Finish or cancel old runs.** In each repository, click **Actions**, then the old running ECR workflow run. Wait for it to finish, or open the run's **…** menu and click **Cancel workflow**, confirming if prompted. Confirm the new application workflow publishes to ghcr.io and combined tests no longer configure AWS credentials.
3. **Delete the old test variable.** ec2yml → Settings → Secrets and variables → Actions → Variables: find the `AWS_TEST_ROLE_ARN` row, click its trash-can/**Delete** control, then click **Delete variable** in the confirmation dialog (or the displayed **Delete** confirmation). Check environment variables too if you saved it there. Keep AWS_REGION if another workflow uses it; promotion now uses the production environment variable. Remove a redundant repository value only once the new value exists.
4. **Delete obsolete application variables.** Frontend/backend → the same Variables screen: find each `AWS_ROLE_ARN`, `ECR_REPOSITORY`, and `AWS_REGION` row. Only if no remaining workflow uses it, click its trash-can/**Delete** control and confirm **Delete variable**. Repeat for each obsolete variable. Keep frontend `VITE_CDN_BASE` and unrelated settings.
5. **Keep private backend access.** Keep ec2yml `BACKEND_READ_TOKEN` if backend is private. If public and the token was created only for this purpose, click the **Secrets** tab, use that secret's trash-can/**Delete** control and confirm deletion. Then open your profile **Settings → Developer settings → Personal access tokens → Fine-grained tokens**, locate that specific token, click **Delete** and confirm. Do not revoke a token used elsewhere.
6. **Delete the old AWS test role.** AWS IAM → Roles: open `PersonaStandCombinedTestsRole` (or the ARN recorded in step 1). Confirm no other workflow uses it and that it is not the EC2 or new promotion role. Return to the **Roles** list, select only that role's checkbox and click **Delete**. Review last-access information, type the role name if requested by the dialog, and click **Delete** to confirm.
7. **Delete its unused policy.** IAM → Policies → `PersonaStandCombinedTestsECRRead`: check Entities attached. Once no other role uses it, return to **Policies**, select that policy's checkbox, click **Actions → Delete**, then confirm **Delete** in the dialog. If the console asks for a confirmation phrase, type the exact phrase shown. Do not remove shared/AWS-managed policies.
8. **Retire old app publishing roles only if exclusive.** Inspect roles from the recorded application ARNs. Once GHCR publishing works, delete roles used solely by the replaced workflows; delete customer-managed policies only if unused elsewhere. For a shared role, remove only the obsolete repository trust statements instead.
9. **Keep shared infrastructure.** Keep the GitHub OIDC provider, EC2 ECR-read instance role, ECR repositories, deployed/rollback images, EC2, RDS, GCP federation and CDN. New promotion and deployment still need them. No new AWS access keys are required.
10. **Old ECR test images are optional cleanup.** If you already published one, delete it only after confirming it is neither deployed nor kept for rollback. An old dev/trial tag alone does not mean an image is unused.
11. **Verify.** A development push should test and publish to GHCR with no AWS role in the application repository. Combined tests should work with EC2 stopped. ECR receives new images only after explicit approved promotion.

References: [GHCR access](https://docs.github.com/en/packages/working-with-a-github-packages-registry/working-with-the-container-registry), [environment protection availability](https://docs.github.com/en/actions/how-tos/deploy/configure-and-manage-deployments/manage-environments), [ECR permissions](https://docs.aws.amazon.com/AmazonECR/latest/userguide/image-push-iam.html), [Skopeo copy](https://github.com/containers/skopeo/blob/main/docs/skopeo-copy.1.md).

Button-label references: [GitHub Actions settings](https://docs.github.com/en/repositories/managing-your-repositorys-settings-and-features/enabling-features-for-your-repository/managing-github-actions-settings-for-a-repository), [package access](https://docs.github.com/en/packages/learn-github-packages/configuring-a-packages-access-control-and-visibility), [branch rulesets](https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/managing-rulesets/creating-rulesets-for-a-repository), [IAM role creation](https://docs.aws.amazon.com/IAM/latest/UserGuide/id_roles_create_for-custom.html), [ECR tag settings](https://docs.aws.amazon.com/AmazonECR/latest/userguide/image-tag-mutability.html).
