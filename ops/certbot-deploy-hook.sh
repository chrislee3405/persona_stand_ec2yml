#!/bin/sh
# certbot deploy hook for persona_frontend's HTTPS mode.
#
# certbot runs this as root after EVERY successful issuance or renewal, with
# RENEWED_LINEAGE set to the certificate's directory
# (/etc/letsencrypt/live/<domain>). Registered once, at first issuance, with
#   --deploy-hook /home/ubuntu/app/ops/certbot-deploy-hook.sh
# and remembered by certbot for every renewal after that. See Part A,
# "HTTPS with Let's Encrypt".
#
# WHY COPY rather than mount /etc/letsencrypt into the container:
#   - live/<domain>/*.pem are symlinks into ../../archive/, which a mount of
#     live/ alone cannot follow;
#   - privkey.pem is readable by root only, and the frontend container runs
#     nginx as uid 101.
# So the two files the container needs are copied, dereferenced, into
# ~/app/certs, owned by uid 101 -- the key readable by that user and nobody
# else -- and docker-compose.ec2.yml mounts that directory read-only.
set -eu

: "${RENEWED_LINEAGE:?certbot sets RENEWED_LINEAGE; run this as a certbot --deploy-hook}"

APP_DIR="$(cd "$(dirname "$0")/.." && pwd)"
DEST="$APP_DIR/certs"
NGINX_UID=101   # the `nginx` user in the frontend image (see its Dockerfile)

install -d -m 0750 -o "$NGINX_UID" -g "$NGINX_UID" "$DEST"
install -m 0644 -o "$NGINX_UID" -g "$NGINX_UID" "$RENEWED_LINEAGE/fullchain.pem" "$DEST/fullchain.pem"
install -m 0600 -o "$NGINX_UID" -g "$NGINX_UID" "$RENEWED_LINEAGE/privkey.pem" "$DEST/privkey.pem"
echo "persona: certificate for $(basename "$RENEWED_LINEAGE") copied to $DEST"

# A reload, not a restart: nginx re-reads the certificate with no dropped
# connections. Nothing to do if the container is not up yet -- it reads the
# files when it starts.
if docker ps --format '{{.Names}}' | grep -qx persona_frontend; then
    docker exec persona_frontend nginx -s reload
    echo "persona: persona_frontend reloaded"
else
    echo "persona: persona_frontend is not running; it will load the certificate when it starts"
fi
