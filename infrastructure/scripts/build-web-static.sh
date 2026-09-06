#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "$0")/../.." && pwd)"
node_image="${DINNER_SWIPE_WEB_NODE_IMAGE:-node:20-bookworm}"
image_tag="${DINNER_SWIPE_WEB_IMAGE_TAG:-dinner-swipe-dinner-swipe-web}"
tmp_context="$(mktemp -d)"

cleanup() {
  rm -rf "$tmp_context"
}
trap cleanup EXIT

cd "$repo_root"

docker run --rm \
  --user "$(id -u):$(id -g)" \
  -e HOME=/tmp \
  -e EXPO_NO_STATIC=1 \
  -e CI=1 \
  -v "$repo_root":/app \
  -w /app \
  "$node_image" \
  bash -lc "npm run build:web -w apps/mobile"

cp infrastructure/docker/nginx.conf "$tmp_context/nginx.conf"
cp -R apps/mobile/dist "$tmp_context/dist"

docker build \
  -f infrastructure/docker/web-static.Dockerfile \
  -t "$image_tag" \
  "$tmp_context"

echo "Built $image_tag from apps/mobile/dist"
