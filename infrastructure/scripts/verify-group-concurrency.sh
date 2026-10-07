#!/usr/bin/env bash
set -euo pipefail
umask 077

root="$(cd "$(dirname "$0")/../.." && pwd)"
if ss -ltn 'sport = :15413' | tail -n +2 | read -r _; then
  printf 'Port 15413 is occupied; no test service was started.\n' >&2
  exit 1
fi
directory="$(mktemp -d)"
container="dinner-swipe-group-concurrency-$(date -u +%Y%m%dT%H%M%SZ)"
password="$(openssl rand -hex 24)"
printf 'POSTGRES_USER=postgres\nPOSTGRES_DB=offline_test\nPOSTGRES_PASSWORD=%s\n' "$password" > "$directory/disposable.env"
docker run -d --name "$container" --memory=384m --cpus=0.5 --env-file "$directory/disposable.env" --tmpfs /var/lib/postgresql/data:rw -p 127.0.0.1:15413:5432 postgres:16 > "$directory/container.id"
trap 'docker rm -f "$container" >/dev/null; rm -f "$directory/disposable.env" "$directory/container.id"; rmdir "$directory"' EXIT
for _ in $(seq 1 60); do
  if docker exec "$container" pg_isready -U postgres -d offline_test >/dev/null 2>&1; then break; fi
  sleep 1
done
export OFFLINE_TEST_DATABASE_URL="postgresql+psycopg://postgres:$password@127.0.0.1:15413/offline_test"
cd "$root/apps/api"
.venv/bin/pytest app/tests/test_offline_postgres.py app/tests/test_group_postgres.py
