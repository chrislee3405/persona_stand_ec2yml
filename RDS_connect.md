0. Install dependencies in container ***IN VENV***

pip install sqlalchemy psycopg2-binary python-dotenv
pip freeze > requirements.txt
 - This installs it locally and updates requirements.txt

docker compose up --build
 - Rebuild the Docker image so the container gets the new package too

1. Keep the SSH tunnel running on your host
Run in a terminal on local machine (not in Docker):

ssh -i /path/to/your-key.pem -L 5433:your-rds-endpoint.rds.amazonaws.com:5432 ec2-user@your-ec2-public-ip -N
 - /path/to/your-key.pem
    The private key file for the EC2 instance. 
    Example: ~/keys/my-ec2-key.pem or C:\Users\YourName\.ssh\my-ec2-key.pem
 - your-rds-endpoint.rds.amazonaws.com
    RDS instance's DNS endpoint. 
    Find it: AWS Console > RDS > Databases > click your DB instance > Connectivity & security tab > "Endpoint" field.
    Example: mydb-instance.abcdefg1234.us-east-1.rds.amazonaws.com
 - 5432
    RDS Postgres's port, same page as above, listed as "Port" right next to the endpoint. 
    Default for Postgres is 5432 unless changed.  
 - ec2-user
    The SSH login username for the EC2 instance, depends on the AMI (OS image) launched
    Find it: AWS Console > EC2 > Instances > click your instance > check the AMI name shown in the details panel.
    Examples: ubuntu
 - your-ec2-public-ip
    Find it: AWS Console > EC2 > Instances > click your instance > "Public IPv4 address" field in the details panel.
    Note: This address changes every time the instance stop/start , unless Elastic IP is used 

Leave this running in the background the whole time of developing. The tunnel lives on host, not in a container.


2. Update .env to use host.docker.internal
host.docker.internal is Docker's special DNS name that resolves to the host machine from inside a container. This works out of the box on Docker Desktop (Windows/Mac).

DATABASE_URL=postgresql://your_user:your_password@host.docker.internal:5433/your_db_name
 - your_user
    the master username you set when creating the RDS instance. 
    Find it: RDS console > your DB instance > Configuration tab > "Master username" (the password itself is never shown again)
 - your_password
    the master password setted at RDS creation time. AWS does not store or redisplay this
    if it is lost and need to reset it: RDS console > your instance > Modify > "New master password" > apply immediately.
 - 5433
    not from AWS at all, it's the arbitrary local port chose in the -L 5433:... part of the SSH command. It can be any free port on the machine (e.g. 5433, 5555); just keep it consistent between the SSH command and DATABASE_URL.
 - your_db_name
    the specific database name inside the Postgres instance. 
    Find it: RDS console > your instance > Configuration tab > "Initial database name"
    if not sure, connect via psql and run \l to list all databases on the instance.

3. Make sure docker-compose.yml loads the .env file and exposes the variable
    env_file pulls in DATABASE_URL from .env and makes it available as an environment variable inside the container, so your app/database.py (os.getenv("DATABASE_URL")) picks it up automatically.

env_file:
    - .env  
- add this

