For AWS config setup:

1. Create Security Group & Subnet Group (Networking Prep)
   Before launching the database instance, set up your network access control:
    - VPC Security Group: Create a security group dedicated to RDS.
    - Inbound Rules: Restrict traffic so only your application server (e.g., EC2 instance, ECS container, or local development IP) can access the database port (e.g., port 5432 for PostgreSQL or 3306 for MySQL). 
    - Subnet Group: Ensure your RDS DB Subnet Group spans across at least two Availability Zones in your targeted VPC for multi-AZ flexibility.  
2. Launch the RDS Instance
    - Open the AWS Console and navigate to RDS.  
    - Click Create database.  
    - Select Standard Create (gives full control over networking and security settings).  
    - Engine Options: Choose your DB engine (e.g., PostgreSQL or MySQL).  
    - Templates: Select Dev/Test or Free Tier / Sandbox depending on budget requirements.  
3. Instance Settings & CredentialsDB Instance Identifier: 
    - Assign a clear identifier.  
    - Master Username & Password: Set your administrator credentials or opt for AWS Secrets Manager for automatic key management.  
    - Instance Configuration: Select an appropriate instance class (e.g., db.t3.micro or db.t4g.micro for lightweight/testing environments).  
4. Connectivity & Additional ConfigurationPublic Access: 
    - Set to No if the app runs within the same VPC or connects via VPN/Bastion host.  
    - VPC Security Group: Attach the security group you configured in Step 1.  
    - Initial Database Name (Crucial): Under Additional Configuration, specify an Initial Database Name. If left blank, RDS creates the server instance without a default database schema, requiring you to create one manually via SQL client after connecting.


For connection setup:

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


For ongoing connection (local)
1. restart EC2 and RDS instance
2. get the new IP of the EC2 instance
3. Update and re-run the SSH tunnel with the new IP in step 1 above
   ssh -i /path/to/your-key.pem -L 5433:your-rds-endpoint.rds.amazonaws.com:5432 ec2-user@your-ec2-public-ip -N
4. start docker
   docker compose up --build
5. Connect via psql for manual SQL
   psql -h localhost -p 5433 -U your_master_username -d database_name "sslmode=require"
   - if forgot the database name, login to default postgres database using database name "postgres"
      then use commend \l to show all databases