#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "$0")/../.." && pwd)"
mode="${DINNER_SWIPE_MIGRATION_MODE:-docker}"
if [[ -f "$repo_root/.env.migrations" ]]; then
  [[ "$(stat -c %a "$repo_root/.env.migrations")" == "600" ]] || { printf 'Migration environment must be mode 0600.\n' >&2; exit 1; }
  set -a
  # shellcheck disable=SC1091
  . "$repo_root/.env.migrations"
  set +a
fi
: "${MIGRATION_DATABASE_URL:?A separate migration-owner connection is required}"
migration_url="$MIGRATION_DATABASE_URL"

if [[ "$mode" == "local" ]]; then
  cd "$repo_root/apps/api"
  set -a
  # shellcheck disable=SC1091
  [[ -f "$repo_root/.env" ]] && . "$repo_root/.env"
  set +a
  export MIGRATION_DATABASE_URL="$migration_url"
  "$repo_root/apps/api/.venv/bin/python" -m alembic upgrade head
else
  cd "$repo_root"
  docker compose --profile production run --rm -e MIGRATION_DATABASE_URL dinner-swipe-api python -m alembic upgrade head
fi
