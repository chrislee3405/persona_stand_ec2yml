
# <AWS_ACCOUNT_ID> / <your-12-digit-account-id> - AWS Account ID
 - AWS Console → top-right account menu, or IAM → Account
 - or run aws sts get-caller-identity (in EC2 SSH or CloudShell) and read the Account field

# <your-instance-id> - EC2 Instance ID
 - AWS Console → EC2 → Instances, "Instance ID" column

# <ec2-public-ip> - EC2 Public IP
 - AWS Console → EC2 → Instances → select instance → "Public IPv4 address"
 - ⚠️ changes on stop/start unless you attach an Elastic IP

# <REAL_ROLE_NAME> - EC2's real IAM role name — 
 - Don't type/guess — fetch it: run the docker exec ... curl .../iam/security-credentials/ command from Part A.5, or aws sts get-caller-identity directly on the instance

# <backend-container-name> - Backend container name
 - Run docker ps -a on the EC2 instance → value under NAMES (set by container_name: in docker-compose.ec2.yml, e.g. persona_backend)
 - SSH key path — /path/to/your-key.pem
 - Wherever you saved the .pem file when launching the EC2 instance (Part A.2, step 5) — you choose the location, just reuse it consistently

# <rds-endpoint> - RDS endpoint
 - AWS Console → RDS → Databases → your instance → "Connectivity & security" tab → "Endpoint" field

# <master-username> / <master-password> - RDS master username / password
 - Values you set when creating the RDS instance (Part A.4, step 4) — AWS never shows the password again, so it must be recorded at creation time (e.g. in a password manager)

# <db-name> - Database name 
 - The "Initial database name" you set in RDS creation (Part A.4, step 8), or whatever you created manually afterward

# <project-id> - GCP Project ID
 - GCP Console → project dropdown (top bar), or IAM & Admin → Settings page

# <PROJECT_NUMBER> - GCP Project Number
 - Different value from Project ID — run gcloud projects describe <project-id> --format="value(projectNumber)", or find it on IAM & Admin → Settings

# <service-account-name> - Service account name
 - The name you chose creating it (Part A.5) — full address is <service-account-name>@<project-id>.iam.gserviceaccount.com, viewable under IAM & Admin → Service Accounts

# <pool-id> / <provider-id> - Workload Identity pool / provider ID
 - Names you chose when creating them (Part A.5) — viewable under IAM & Admin → Workload Identity Federation

# <project-id-or-number-matching-what-your-code-expects> - GCP_PROJECT_ID env var value
 - Check your backend code (wherever vertexai.init(project=...) is called) to see whether it expects the Project ID string or Project Number, then use the matching value from above

# <path-to-application_default_credentials.json> - Local ADC credentials path 
 - Created by gcloud auth application-default login — default location is ~/.config/gcloud/application_default_credentials.json (macOS/Linux) or %APPDATA%\gcloud\application_default_credentials.json (Windows)

# <you> - GitHub username/org
 - Your own GitHub username or organization, as it appears in each repo's URL on GitHub