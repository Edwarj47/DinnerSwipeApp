#!/usr/bin/env bash
set -euo pipefail
umask 077
root="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$root"
image="${DINNER_NUTRITION_IMAGE:-dinner-swipe-api:nutrition}"
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
  --user 1000:1000 --read-only --cap-drop ALL --security-opt no-new-privileges \
  --pids-limit 64 --memory 256m --memory-swap 256m --cpus 0.5 \
  --env-file .env --env-file .env.fatsecret \
  "$image" python -m app.workers.nutrition_daily "$@"
