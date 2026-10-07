#!/usr/bin/env bash
set -euo pipefail
umask 077

root="$(cd "$(dirname "$0")/../.." && pwd)"
stamp="$(date -u +%Y%m%dT%H%M%SZ)"
directory="$root/backups/group-planning-$stamp"
container="dinner-swipe-group-check-$stamp"
mkdir -p "$directory"
password="$(openssl rand -hex 24)"
printf 'POSTGRES_USER=dinner_swipe_app\nPOSTGRES_DB=dinner_swipe\nPOSTGRES_PASSWORD=%s\n' "$password" > "$directory/disposable.env"
docker exec dinner-swipe-postgres pg_dump -U dinner_swipe_app -Fc dinner_swipe > "$directory/database.dump"
sha256sum "$directory/database.dump" > "$directory/database.sha256"
docker run -d --name "$container" --memory=384m --cpus=0.5 --env-file "$directory/disposable.env" --tmpfs /var/lib/postgresql/data:rw -p 127.0.0.1::5432 postgres:16 > "$directory/container.id"
trap 'docker rm -f "$container" >/dev/null' EXIT
for _ in $(seq 1 60); do
  if docker exec "$container" pg_isready -U dinner_swipe_app -d dinner_swipe >/dev/null 2>&1; then break; fi
  sleep 1
done
docker exec -i "$container" pg_restore -U dinner_swipe_app -d dinner_swipe --exit-on-error < "$directory/database.dump"
port="$(docker port "$container" 5432/tcp | cut -d: -f2)"
export DATABASE_URL="postgresql+psycopg://dinner_swipe_app:$password@127.0.0.1:$port/dinner_swipe"
export DINNER_MIGRATION_CHECK_DIRECTORY="$directory"
cd "$root/apps/api"
.venv/bin/python "$root/infrastructure/scripts/verify_group_rows.py" before
.venv/bin/alembic upgrade head
.venv/bin/python "$root/infrastructure/scripts/verify_group_rows.py" after
printf 'Migration verified. Private backup and fingerprints: %s\n' "$directory"
