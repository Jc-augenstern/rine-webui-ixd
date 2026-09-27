#!/bin/sh
# Restores only into a new uniquely named database and directory; never replaces the live application.
set -eu
if [ "$#" -ne 2 ]; then echo "Usage: sh deploy/restore-check.sh /absolute/path/production.env /absolute/path/backup" >&2; exit 1; fi
env_file=$1
source=$2
repo=$(CDPATH='' cd -- "$(dirname -- "$0")/.." && pwd)
compose() { docker compose --env-file "$env_file" -f "$repo/deploy/compose.production.yml" "$@"; }
if [ ! -f "$source/COMPLETE" ]; then echo "Backup is incomplete" >&2; exit 1; fi
(cd "$source" && sha256sum -c database.sha256 && sha256sum -c uploads.sha256)
umask 077
database="ixd_restore_$(date -u +%Y%m%d%H%M%S)_$$_test"
target="$repo/.local/restores/$database"
if [ -e "$target" ]; then echo "Restore directory already exists" >&2; exit 1; fi
mkdir -p "$target"
# createdb fails if the fresh name already exists; never pass --clean or drop an existing database.
compose exec -T db createdb -U ixd_database_owner -O ixd_platform "$database"
compose exec -T db pg_restore -U ixd_platform --dbname "$database" --exit-on-error --no-owner --no-acl < "$source/database.dump"
cp -R "$source/uploads" "$target/uploads"
cp "$source/uploads.sha256" "$target/uploads.sha256"
(cd "$target" && sha256sum -c uploads.sha256)
compose exec -T db psql -U ixd_platform -d "$database" -v ON_ERROR_STOP=1 -c 'SELECT count(*) AS users FROM users; SELECT count(*) AS contents FROM contents; SELECT count(*) AS media FROM media;' > "$target/verification.txt"
printf 'database=%s\nsource=%s\nuploads=%s/uploads\n' "$database" "$source" "$target" > "$target/restore-owner.txt"
echo "Isolated restore completed: $database and $target"
echo "Review database content and attachment references before planning any live recovery. This script never switches the application database."
