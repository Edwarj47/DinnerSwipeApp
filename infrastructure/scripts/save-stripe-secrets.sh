#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
env_file="${DINNER_SWIPE_ENV_FILE:-$repo_root/.env}"
expected_account_id="${STRIPE_EXPECTED_ACCOUNT_ID:-acct_1RlaaDDYKLZNKnhL}"

touch "$env_file"
chmod 600 "$env_file"

upsert_env() {
  local key="$1"
  local value="$2"
  local escaped
  escaped="$(printf '%s' "$value" | sed -e 's/[\/&]/\\&/g')"
  if grep -q "^${key}=" "$env_file"; then
    sed -i "s/^${key}=.*/${key}=${escaped}/" "$env_file"
  else
    printf '%s=%s\n' "$key" "$value" >> "$env_file"
  fi
}

printf 'This writes Stripe settings to %s with 0600 permissions.\n' "$env_file"
printf 'Use test-mode Stripe values first, then rotate to live mode only before launch.\n\n'

read -r -p "Stripe price ID for Dinner Swipe Premium: " stripe_price_id
read -r -s -p "Stripe secret key: " stripe_secret_key
printf '\n'
read -r -s -p "Stripe webhook signing secret: " stripe_webhook_secret
printf '\n'
read -r -p "Expected Stripe account ID [$expected_account_id]: " account_id
account_id="${account_id:-$expected_account_id}"

if [[ -z "$stripe_price_id" || -z "$stripe_secret_key" || -z "$stripe_webhook_secret" ]]; then
  echo "Missing one or more required Stripe values." >&2
  exit 1
fi

upsert_env "STRIPE_ENABLED" "true"
upsert_env "STRIPE_PREMIUM_PRICE_ID" "$stripe_price_id"
upsert_env "STRIPE_SECRET_KEY" "$stripe_secret_key"
upsert_env "STRIPE_WEBHOOK_SECRET" "$stripe_webhook_secret"
upsert_env "STRIPE_EXPECTED_ACCOUNT_ID" "$account_id"

chmod 600 "$env_file"
printf 'Stripe settings saved to %s with 0600 permissions.\n' "$env_file"
