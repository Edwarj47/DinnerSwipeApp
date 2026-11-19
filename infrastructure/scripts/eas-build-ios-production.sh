#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
node "$repo_root/infrastructure/scripts/store-build-preflight.cjs" ios

if [[ "${DINNER_SWIPE_IOS_SIGNING_READY:-}" != 1 ]]; then
  echo "Apple enrollment and existing EAS signing must be confirmed first. See documentation/store-internal-testing.md." >&2
  exit 1
fi

secret_file="${DINNER_SWIPE_EAS_ENV_FILE:-$HOME/.config/dinner-swipe/eas.env}"
if [[ -f "$secret_file" ]]; then
  set -a
  # shellcheck disable=SC1090
  source "$secret_file"
  set +a
fi
if [[ -z "${EXPO_TOKEN:-}" ]]; then
  echo "EXPO_TOKEN is missing. Use the private EAS credential file, never source control." >&2
  exit 1
fi

cd "$repo_root/apps/mobile"
export EAS_BUILD_NO_EXPO_GO_WARNING="${EAS_BUILD_NO_EXPO_GO_WARNING:-true}"
npx --yes eas-cli@27.2.0 env:exec production 'node ../../infrastructure/scripts/check-ota-runtime.cjs --check-env' --non-interactive
EAS_BUILD_NO_EXPO_GO_WARNING="${EAS_BUILD_NO_EXPO_GO_WARNING:-true}" \
  npx --yes eas-cli@27.2.0 build --profile production --platform ios --non-interactive --freeze-credentials
