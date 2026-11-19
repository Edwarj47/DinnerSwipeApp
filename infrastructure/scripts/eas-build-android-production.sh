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
node "$repo_root/infrastructure/scripts/store-build-preflight.cjs" android
export EAS_BUILD_NO_EXPO_GO_WARNING="${EAS_BUILD_NO_EXPO_GO_WARNING:-true}"
npx --yes eas-cli@27.2.0 env:exec production 'node ../../infrastructure/scripts/check-ota-runtime.cjs --check-env' --non-interactive
EAS_BUILD_NO_EXPO_GO_WARNING="${EAS_BUILD_NO_EXPO_GO_WARNING:-true}" \
  npx --yes eas-cli@27.2.0 build --profile production --platform android --non-interactive --freeze-credentials
