#!/usr/bin/env bash
set -euo pipefail
umask 077
root="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$root"
image="${DINNER_NUTRITION_IMAGE:-dinner-swipe-api:nutrition}"
set -a
# shellcheck disable=SC1091
. .env
set +a
: "${DINNER_SWIPE_RUNTIME_DATABASE_URL:?A least-privilege runtime connection is required}"
export DATABASE_URL="$DINNER_SWIPE_RUNTIME_DATABASE_URL"
network="$(docker inspect dinner-swipe-api --format '{{range $name, $_ := .NetworkSettings.Networks}}{{$name}}{{end}}')"
if [[ "$network" != "dinner-swipe_default" ]]; then
  printf 'Unexpected Dinner Swipe network; task not started.\n' >&2
  exit 1
fi
if [[ ! -f .env.fatsecret || "$(stat -c %a .env.fatsecret)" != "600" ]]; then
  printf 'A private mode-0600 FatSecret environment file is required.\n' >&2
  exit 1
fi
docker run --rm --name dinner-swipe-nutrition-daily --network "$network" \
  --user 10001:10001 --read-only --cap-drop ALL --security-opt no-new-privileges \
  --pids-limit 64 --memory 256m --memory-swap 256m --cpus 0.5 \
  --env-file .env --env-file .env.fatsecret \
  -e DATABASE_URL -e MIGRATION_DATABASE_URL= -e DINNER_SWIPE_POSTGRES_PASSWORD= \
  -e DINNER_SWIPE_RUNTIME_DB_PASSWORD= \
  "$image" python -m app.workers.nutrition_daily "$@"
