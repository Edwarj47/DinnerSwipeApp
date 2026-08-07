#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
secret_file="${DINNER_SWIPE_EAS_ENV_FILE:-$HOME/.config/dinner-swipe/eas.env}"

if [[ -f "$secret_file" ]]; then
  set -a
  # shellcheck disable=SC1090
  source "$secret_file"
  set +a
fi

if [[ -z "${EXPO_TOKEN:-}" ]]; then
  echo "EXPO_TOKEN is missing. Run infrastructure/scripts/save-expo-token.sh first." >&2
  exit 1
fi

cd "$repo_root/apps/mobile"
EAS_BUILD_NO_EXPO_GO_WARNING="${EAS_BUILD_NO_EXPO_GO_WARNING:-true}" \
  npx --yes eas-cli@latest build --profile development --platform android --non-interactive
