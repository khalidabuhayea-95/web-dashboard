#!/usr/bin/env bash
# Nightly database backup on the production server (cron: /etc/cron.d/nayroz-db-backup, from
# deploy/cloud-init.yml). deploy.sh copies it to /srv/nayroz/backup-db.sh.
#
#   1. pg_dump (custom format) from the running postgres container into /srv/nayroz/backups/
#   2. checks the dump is readable (pg_restore --list)
#   3. if BACKUP_R2_BUCKET is set in .env.production, uploads it off-site to that PRIVATE R2
#      bucket (db/<file>), using the existing R2_* credentials, via the official aws-cli image
#   4. keeps KEEP_DAYS (default 14) of local dumps; R2 retention is a lifecycle rule on the bucket
#
# Restore: docs/deploy-hetzner.md ("Restore a backup").
set -euo pipefail

DIR="${NAYROZ_DIR:-/srv/nayroz}"
OUT="${DIR}/backups"
KEEP_DAYS="${KEEP_DAYS:-14}"
cd "$DIR"

# Read single values without sourcing the file (it holds multi-line keys and shell-unsafe text).
env_value() { grep -E "^$1=" .env.production | head -n 1 | cut -d= -f2- | sed -e 's/^"//' -e 's/"$//'; }

PG_USER="$(env_value POSTGRES_USER)"
PG_DB="$(env_value POSTGRES_DB)"
compose() { docker compose -f docker-compose.yml -f docker-compose.prod.yml "$@"; }

STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
FILE="nayroz_app-${STAMP}.dump"
TMP="${OUT}/.${FILE}.partial"

mkdir -p "$OUT"
compose exec -T postgres pg_dump -U "$PG_USER" -d "$PG_DB" -Fc > "$TMP"
compose exec -T postgres pg_restore --list < "$TMP" > /dev/null
mv "$TMP" "${OUT}/${FILE}"
echo "$(date -u +%FT%TZ) dump ok: ${FILE} ($(du -h "${OUT}/${FILE}" | cut -f1))"

BUCKET="$(env_value BACKUP_R2_BUCKET)"
if [[ -n "$BUCKET" ]]; then
  docker run --rm \
    -e AWS_ACCESS_KEY_ID="$(env_value R2_ACCESS_KEY_ID)" \
    -e AWS_SECRET_ACCESS_KEY="$(env_value R2_SECRET_ACCESS_KEY)" \
    -e AWS_DEFAULT_REGION=auto \
    -v "${OUT}:/backups:ro" \
    amazon/aws-cli s3 cp "/backups/${FILE}" "s3://${BUCKET}/db/${FILE}" \
    --endpoint-url "$(env_value R2_ENDPOINT)" --only-show-errors
  echo "$(date -u +%FT%TZ) uploaded: s3://${BUCKET}/db/${FILE}"
fi

find "$OUT" -maxdepth 1 -name 'nayroz_app-*.dump' -mtime "+${KEEP_DAYS}" -delete
