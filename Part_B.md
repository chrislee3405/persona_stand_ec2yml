# Part B — Local Development Workflow

Everything in this part runs on **local machine**, except where explicitly noted otherwise (e.g. commands run *inside* a Docker container).

## B.1 Repository & Dependencies

Run in Local machine terminal
```bash
mkdir -p ~/projects && cd ~/projects
git clone https://github.com/<you>/persona_stand_frontend.git
git clone https://github.com/<you>/persona_stand_back.git
git clone https://github.com/<you>/persona_stand_ec2yml.git
```

Backend Python dependencies — Run in Local machine terminal
```bash
cd persona_stand_back
python -m venv .venv
.venv\Scripts\activate        # Windows
# source .venv/bin/activate   # macOS/Linux

pip install sqlalchemy psycopg2-binary python-dotenv google-cloud-aiplatform "google-auth[external_account]"
pip freeze > requirements.txt
```

Frontend dependencies — Run in Local machine terminal
```bash
cd ../persona_stand_frontend
npm install
```

## B.2 Local Database Connection 🔁 *(repeat after every EC2/RDS restart)*

Run in Local machine terminal — keep this running in its own dedicated terminal window/tab
```bash
ssh -i /path/to/your-key.pem -L 5433:<rds-endpoint>:5432 ubuntu@<ec2-public-ip> -N
```

Edit `.env` in the backend repo, on your **local machine**
```env
DATABASE_URL=postgresql://<master-username>:<master-password>@host.docker.internal:5433/<db-name>
```
⚠️ This tunnel-based form is **local-dev only** — never reuse it in EC2's own `.env`.

Confirm in `docker-compose.yml`, on your **local machine**, in the backend repo
```yaml
services:
  backend:
    env_file:
      - .env
```

## B.3 Local Vertex AI Testing

Run in Local machine terminal
```bash
gcloud auth application-default login
gcloud auth application-default set-quota-project <project-id>
```

Edit `docker-compose.yml`, on your **local machine**, in the backend repo
```yaml
services:
  backend:
    volumes:
      - .:/app
      - /app/__pycache__
      - "<path-to-application_default_credentials.json>:/app/adc.json:ro"
```

Run in Local machine terminal (this launches a command that runs *inside* the running backend container)
```bash
docker compose exec backend python -c "import vertexai; from vertexai.generative_models import GenerativeModel; vertexai.init(project='<project-id>', location='global'); model = GenerativeModel('gemini-2.5-flash'); print(model.generate_content('Say hello').text)"
```

## B.4 Running the App Locally

**Backend only — Run in Local machine terminal backend folder**
```bash
.venv\Scripts\activate        # Windows
uvicorn app.main:app --reload
```

**Frontend only — Run in Local machine terminal frontend folder**
```bash
npm run dev
```

**Full stack via Docker — Run in Local machine terminal backend folder**
```bash
docker compose up --build
```

---
