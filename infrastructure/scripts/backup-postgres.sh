#!/usr/bin/env bash
set -euo pipefail

mkdir -p backups/postgres
stamp="$(date -u +%Y%m%dT%H%M%SZ)"
docker exec dinner-swipe-postgres pg_dump -U dinner_swipe_app dinner_swipe > "backups/postgres/dinner_swipe_${stamp}.sql"
echo "Wrote backups/postgres/dinner_swipe_${stamp}.sql"

