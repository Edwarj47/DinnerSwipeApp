#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
app_dir="$repo_root/apps/mobile"
log_dir="$repo_root/logs"
log_file="$log_dir/metro-dev-client.log"
session_name="${DINNER_SWIPE_METRO_SESSION:-codex-dinner-swipe-metro}"
api_url="${EXPO_PUBLIC_API_URL:-https://dinner.dcss.dev}"
expo_env_file="${DINNER_SWIPE_EXPO_ENV:-$HOME/.config/dinner-swipe/eas.env}"

mkdir -p "$log_dir"

if tmux has-session -t "$session_name" 2>/dev/null; then
  tmux kill-session -t "$session_name"
fi

tmux new -d -s "$session_name" \
  "cd '$app_dir' && : > '$log_file' && set -a && [ -f '$expo_env_file' ] && . '$expo_env_file'; set +a; EXPO_PUBLIC_API_URL='$api_url' npx expo start --dev-client --tunnel --clear --port 8081 2>&1 | tee -a '$log_file'"

echo "Started Expo dev-client Metro in tmux session: $session_name"
echo "Attach with: tmux attach -t $session_name"
echo "Logs: $log_file"
echo "API URL: $api_url"
