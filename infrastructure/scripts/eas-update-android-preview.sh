#!/usr/bin/env bash
set -euo pipefail
umask 077
[[ "$#" == 1 && -n "$1" ]] || { printf 'Usage: bash %s "release message"\n' "$0" >&2; exit 1; }
repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$repo_root"
[[ -z "$(git status --porcelain --untracked-files=no)" ]] || { printf 'Commit and test changes first.\n' >&2; exit 1; }
[[ -z "$(git ls-files --others --exclude-standard | sed '/^AGENTS.md$/d')" ]] || { printf 'Review untracked source before publishing.\n' >&2; exit 1; }
node infrastructure/scripts/check-ota-runtime.cjs
version="$(node -p 'require("./apps/mobile/app.json").expo.version')"
export DINNER_OTA_RECEIPT="$repo_root/backups/eas-runtime-$version.json"
node <<'NODE'
const fs = require('node:fs'), cp = require('node:child_process');
const lock = require('./apps/mobile/native-runtime.json');
const receipt = JSON.parse(fs.readFileSync(process.env.DINNER_OTA_RECEIPT));
if (receipt.runtime !== lock.version || receipt.contract !== lock.hash || receipt.status !== 'FINISHED' || !/^[0-9a-f]{40}$/.test(receipt.commit)) throw Error('A verified completed APK is required for this runtime');
cp.execFileSync('git', ['merge-base', '--is-ancestor', receipt.commit, 'HEAD']);
NODE
secret_file="${DINNER_SWIPE_EAS_ENV_FILE:-$HOME/.config/dinner-swipe/eas.env}"
if [[ -f "$secret_file" ]]; then set -a; source "$secret_file"; set +a; fi
[[ -n "${EXPO_TOKEN:-}" ]] || { printf 'Missing EAS authentication.\n' >&2; exit 1; }
export OTA_MESSAGE="$1"
while IFS= read -r name; do unset "$name"; done < <(compgen -e | sed -n '/^EXPO_PUBLIC_/p')
cd apps/mobile
temporary="$(mktemp -d)"
trap 'rm -rf "$temporary"' EXIT
for channel in development preview production; do
  npx --yes eas-cli@27.2.0 channel:view "$channel" --json > "$temporary/$channel.json"
done
node - "$temporary" <<'NODE'
const fs = require('node:fs'), path = require('node:path'), ids = new Set();
for (const name of ['development', 'preview', 'production']) {
  const value = JSON.parse(fs.readFileSync(path.join(process.argv[2], name + '.json'))).currentPage;
  const mapping = JSON.parse(value.branchMapping);
  if (value.name !== name || value.isPaused || mapping.data.length !== 1 || mapping.data[0].branchMappingLogic !== 'true' || value.updateBranches.length !== 1 || value.updateBranches[0].name !== name || value.updateBranches[0].id !== mapping.data[0].branchId) throw Error('Unexpected channel mapping; review without automatically changing it');
  ids.add(mapping.data[0].branchId);
}
if (ids.size !== 3) throw Error('Release channels must use distinct branches');
NODE
npx --yes eas-cli@27.2.0 env:exec preview 'set -eu; node ../../infrastructure/scripts/check-ota-runtime.cjs --check-env; exec npx --yes eas-cli@27.2.0 update --channel preview --environment preview --platform android --message "$OTA_MESSAGE" --non-interactive --json' --non-interactive
