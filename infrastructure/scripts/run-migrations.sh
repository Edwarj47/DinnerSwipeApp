#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "$0")/../.." && pwd)"
mode="${DINNER_SWIPE_MIGRATION_MODE:-docker}"

if [[ "$mode" == "local" ]]; then
  cd "$repo_root/apps/api"
  set -a
  # shellcheck disable=SC1091
  [[ -f "$repo_root/.env" ]] && . "$repo_root/.env"
  set +a
  "$repo_root/.venv/bin/python" -m alembic upgrade head
else
  cd "$repo_root"
  docker compose --profile production run --rm dinner-swipe-api python -m alembic upgrade head
fi
