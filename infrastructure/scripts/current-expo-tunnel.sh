#!/usr/bin/env bash
set -euo pipefail

if ! curl -fsS http://127.0.0.1:4040/api/tunnels >/tmp/dinner-swipe-expo-tunnels.json 2>/dev/null; then
  echo "Expo tunnel metadata is not available."
  echo "Start Metro first with: infrastructure/scripts/start-expo-dev-client.sh"
  exit 1
fi

python3 - <<'PY'
import json
from pathlib import Path

data = json.loads(Path("/tmp/dinner-swipe-expo-tunnels.json").read_text())
urls = [t.get("public_url") for t in data.get("tunnels", []) if t.get("public_url")]
http_urls = [url for url in urls if url.startswith("http://")]
https_urls = [url for url in urls if url.startswith("https://")]

if http_urls:
    print(http_urls[0])
elif https_urls:
    print(https_urls[0])
else:
    raise SystemExit("No Expo tunnel URLs found.")
PY
