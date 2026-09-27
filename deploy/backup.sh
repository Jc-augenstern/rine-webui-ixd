#!/bin/sh
# Explicit maintenance operation for an already configured production Compose project.
set -eu
if [ "$#" -ne 2 ] || [ "$2" != "--maintenance" ]; then
  echo "Usage: sh deploy/backup.sh /absolute/path/production.env --maintenance" >&2
  echo "Stops API and web briefly, takes database + upload snapshot, then restores their previous running state." >&2
  exit 1
fi
env_file=$1
repo=$(CDPATH='' cd -- "$(dirname -- "$0")/.." && pwd)
compose() { docker compose --env-file "$env_file" -f "$repo/deploy/compose.production.yml" "$@"; }
umask 077
stamp=$(date -u +%Y%m%dT%H%M%SZ)
target="$repo/backups/production-$stamp"
if [ -e "$target" ]; then echo "Backup target already exists" >&2; exit 1; fi
mkdir -p "$target"
running=$(compose ps --status running --services)
api_running=0
web_running=0
if printf '%s\n' "$running" | grep -qx api; then api_running=1; fi
if printf '%s\n' "$running" | grep -qx web; then web_running=1; fi
resume() {
  if [ "$api_running" = 1 ]; then compose start api; fi
  if [ "$web_running" = 1 ]; then compose start web; fi
}
trap resume EXIT HUP INT TERM
compose stop web api
compose exec -T db sh -c 'PGPASSWORD="$POSTGRES_APP_PASSWORD" pg_dump -h 127.0.0.1 -U ixd_platform --format=custom --no-owner --no-acl ixd_platform' > "$target/database.dump"
compose cp api:/data/uploads "$target/uploads"
(cd "$target" && find uploads -type f -exec sha256sum {} \; > uploads.sha256 && sha256sum database.dump > database.sha256)
printf 'created=%s\nformat=ixd-production-maintenance-v1\n' "$stamp" > "$target/COMPLETE"
echo "Private backup completed: $target"
echo "Database includes personal data and password hashes; encrypt off-machine copies. Server configuration and TLS keys must be backed up separately."
