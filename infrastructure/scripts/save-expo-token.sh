#!/usr/bin/env bash
set -euo pipefail

secret_dir="${DINNER_SWIPE_SECRET_DIR:-$HOME/.config/dinner-swipe}"
secret_file="${DINNER_SWIPE_EAS_ENV_FILE:-$secret_dir/eas.env}"

mkdir -p "$secret_dir"
chmod 700 "$secret_dir"

if [[ -n "${EXPO_TOKEN:-}" ]]; then
  token="$EXPO_TOKEN"
else
  printf "Paste Expo access token; input is hidden: " >&2
  IFS= read -r -s token
  printf "\n" >&2
fi

if [[ -z "$token" ]]; then
  echo "No Expo token provided." >&2
  exit 1
fi

umask 077
tmp_file="$(mktemp "$secret_dir/eas.env.XXXXXX")"
printf "EXPO_TOKEN=%q\n" "$token" > "$tmp_file"
mv "$tmp_file" "$secret_file"
chmod 600 "$secret_file"

echo "Expo token saved to $secret_file with 0600 permissions."
