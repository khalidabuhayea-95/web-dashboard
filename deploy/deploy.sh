#!/usr/bin/env bash
# Deploys a CI-built image to the production server. Run from the repo root on your machine:
#
#   deploy/deploy.sh <server-ip-or-host> [image-tag]
#
# image-tag defaults to the current commit (git rev-parse HEAD). The image must already be on
# GHCR: the "Docker image" workflow pushes ghcr.io/khalidabuhayea-95/web-dashboard:<sha> for
# every push to main. Rollback = run this again with an older SHA.
#
# What it does on the server (/srv/nayroz, as the `deploy` user):
#   1. copies the compose files, the Caddyfile and backup-db.sh (never .env.production: that file
#      lives only on the server)
#   2. pulls the pinned image, starts Postgres, applies Prisma migrations
#   3. starts or updates every service, then checks /v1/health through Caddy
set -euo pipefail

HOST="${1:?usage: deploy/deploy.sh <server-ip-or-host> [image-tag]}"
TAG="${2:-$(git rev-parse HEAD)}"
REMOTE="deploy@${HOST}"
DIR="/srv/nayroz"

cd "$(git rev-parse --show-toplevel)"

if [[ -n "$(git status --porcelain -- docker-compose.yml docker-compose.prod.yml Caddyfile deploy/)" ]]; then
  echo "Uncommitted changes in the deploy files: commit them first so the server matches the repo." >&2
  exit 1
fi

echo "→ copying deploy files to ${REMOTE}:${DIR}"
rsync -az --chmod=F644 docker-compose.yml docker-compose.prod.yml Caddyfile "${REMOTE}:${DIR}/"
rsync -az --chmod=F755 deploy/backup-db.sh "${REMOTE}:${DIR}/backup-db.sh"

echo "→ deploying image tag ${TAG}"
ssh "$REMOTE" bash -s -- "$DIR" "$TAG" <<'REMOTE_SCRIPT'
set -euo pipefail
DIR="$1"
export IMAGE_TAG="$2"
cd "$DIR"
if [[ ! -f .env.production ]]; then
  echo "Missing ${DIR}/.env.production — copy .env.production.example there and fill it in." >&2
  exit 1
fi
compose() { docker compose -f docker-compose.yml -f docker-compose.prod.yml "$@"; }

compose pull web worker
compose up -d postgres
compose run --rm web npx prisma migrate deploy
compose up -d --remove-orphans
echo "$IMAGE_TAG" > DEPLOYED_TAG

# Through Caddy, exactly as the app reaches it (needs DNS + certificates; a warning before that).
for i in $(seq 1 30); do
  if curl -fsS --max-time 5 --resolve api.nayroz.com:443:127.0.0.1 https://api.nayroz.com/v1/health >/dev/null 2>&1; then
    echo "✓ api.nayroz.com/v1/health is up (image ${IMAGE_TAG})"
    exit 0
  fi
  sleep 4
done
echo "! /v1/health did not answer through Caddy yet. Check: docker compose -f docker-compose.yml -f docker-compose.prod.yml ps / logs" >&2
exit 1
REMOTE_SCRIPT
