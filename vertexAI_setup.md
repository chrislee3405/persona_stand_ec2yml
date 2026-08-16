1. Create a GCP project
2. Enable the Vertex AI API
    Console > search "Vertex AI API" > Enable
3. Authentication — create a Service Account
    Console > IAM & Admin > Service Accounts > Create Service Account
     - Grant role: Agent Platform User
     - Principals with access: leave it blank for indiviual project, add other people when working in a team
4. Create a Workload Identity Pool in GCP for letting EC2 instance authenticate to Vertex AI using its existing AWS IAM role
    Console > IAM & Admin > Workload Identity Federation > Create Pool
     - Provider name: Name it with any name
5. Get EC2 instance's IAM role ARN
    run it in EC2 terminal to get ARN like: arn:aws:sts::123456789012:assumed-role/EC2-ECR-ReadOnly-Role/i-098765...
        aws sts get-caller-identity
6. Allow that AWS role to impersonate your GCP service account
    Get PROJECT_NUMBER via 
        gcloud projects describe project-id --format="value(projectNumber)"
    Then put it in .env as GCP_PROJECT_ID=${GCP_PROJECT_ID}
    run the following commend
        gcloud iam service-accounts add-iam-policy-binding \
            {service-account-name}@{project-id}.iam.gserviceaccount.com \
            --project={your-project-id} \
            --role="roles/iam.workloadIdentityUser" \
            --member="principalSet://iam.googleapis.com/projects/{PROJECT_NUMBER}/locations/global/workloadIdentityPools/{aws-ec2-pool}/attribute.aws_role/{arn:aws:sts::123456789012:assumed-role/your-ec2-role}"
7. Generate the credential config file
    This is a not a secret, just describes how to fetch tokens, containing no actual credentials itself. Safe to keep in  repo
        gcloud iam workload-identity-pools create-cred-config \
            projects/PROJECT_NUMBER/locations/global/workloadIdentityPools/{pool-name}/providers/aws-provider \
            --service-account={service-account-name}@{project-id}.iam.gserviceaccount.com \
            --aws \
            --output-file=app/secrets/gcp-wif-config.json
8. Download the credential config file to local device
        cloudshell download app/secrets/gcp-wif-config.json

9. Get the credentials file onto the EC2 host
    SSH go to the EC2
        ssh -i C:\Users\user\persona_stand_key\persona_stand_key.pem ubuntu@32.236.171.225 
    Create the folder
        mkdir -p ~/secrets
    run the following commend in local device terminal
        scp -i C:\Users\user\persona_stand_key\persona_stand_key.pem C:\Users\user\persona_stand_key\gcp-wif-config.json ubuntu@32.236.171.225:~/secrets/gcp-wif-config.json

10. Update docker-compose.ec2.yml to Mount the config file and point the app at it
    state the file in docker-compose.yml
        services:
            backend:
                environment:
                    - GOOGLE_APPLICATION_CREDENTIALS=/app/secrets/gcp-wif-config.json
                    - GCP_PROJECT_ID=${GCP_PROJECT_ID}
                volumes:
                    - ./app/secrets/gcp-wif-config.json:/app/secrets/gcp-wif-config.json:ro

11. Add the required Python dependency in venv
    run the commend to Activate venv
        .venv\Scripts\activate
    Install the packages then Freeze to requirements.txt
        pip install google-cloud-aiplatform "google-auth[external_account]"
        pip freeze > requirements.txt

12. Ensure the ai servive file is well developed
    login to GCP from local device first
        gcloud auth application-default login
        gcloud auth application-default set-quota-project your-project-id
    Add the volume mount to docker-compose.yml:
        services:
        backend:
            volumes:
            - .:/app
            - /app/__pycache__
            - "C:/Users/user/AppData/Roaming/gcloud/application_default_credentials.json:/app/adc.
    test the connection with a one-off diagnostic command WHILE THE APP IS RUNNING IN BACKGROUND
        docker compose exec backend python -c "import vertexai; from vertexai.generative_models import GenerativeModel; vertexai.init(project='project-id', location='global'); model = GenerativeModel('gemini-2.5-flash'); print(model.generate_content('Say hello').text)"





