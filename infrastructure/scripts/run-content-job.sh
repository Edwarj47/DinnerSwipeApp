#!/usr/bin/env bash
set -euo pipefail
umask 077
root="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$root"
[[ -f .env && "$(stat -c %a .env)" == "600" ]] || { printf 'Private mode-0600 environment required.\n' >&2; exit 1; }
set -a
# shellcheck disable=SC1091
. .env
set +a
: "${DINNER_SWIPE_RUNTIME_DATABASE_URL:?A least-privilege Dinner Swipe connection is required}"
export DATABASE_URL="$DINNER_SWIPE_RUNTIME_DATABASE_URL"
[[ "${MEDIA_STORAGE_BACKEND:-local}" == "local" ]] || { printf 'This job requires the existing local private media store.\n' >&2; exit 1; }
network="$(docker inspect dinner-swipe-api --format '{{range $name, $_ := .NetworkSettings.Networks}}{{$name}}{{end}}')"
[[ "$network" == "dinner-swipe_default" ]] || { printf 'Unexpected Dinner Swipe network.\n' >&2; exit 1; }
volume="$(docker inspect dinner-swipe-api --format '{{range .Mounts}}{{if eq .Destination "/app/media"}}{{.Name}}{{end}}{{end}}')"
[[ "$volume" == dinner-swipe_* ]] || { printf 'Unexpected Dinner Swipe media volume.\n' >&2; exit 1; }
image="${DINNER_CONTENT_IMAGE:-$(docker inspect dinner-swipe-api --format '{{.Image}}')}"
docker run --rm --name "dinner-swipe-content-job-$$" --network "$network" \
  --user 10001:10001 --read-only --cap-drop ALL --security-opt no-new-privileges \
  --pids-limit 64 --memory 384m --memory-swap 384m --cpus 0.5 \
  --tmpfs /tmp:size=32m,mode=1777 -v "$volume:/app/media" \
  -e DATABASE_URL -e APP_ENV -e JWT_SECRET -e PUBLIC_API_URL -e MEDIA_PUBLIC_BASE_URL \
  -e CONTENT_AUTOMATION_OWNER_USER_ID \
  -e MEDIA_ACCOUNT_QUOTA_BYTES -e MAX_IMAGE_UPLOAD_SIZE_BYTES \
  -e IMAGE_STORAGE_PATH=/app/media -e MEDIA_STORAGE_BACKEND=local \
  -e FATSECRET_ENABLED=false -e AI_INGESTION_ENABLED=false -e AI_RECIPE_ENABLED=false \
  -e NUTRITION_AI_ENABLED=false -e NUTRITION_VOICE_ENABLED=false -e STRIPE_ENABLED=false \
  "$image" python -m app.workers.content_daily "$@"
