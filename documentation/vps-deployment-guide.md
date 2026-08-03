# VPS Deployment Guide

1. Copy `.env.example` to `.env` and set production values.
2. Use a unique `DINNER_SWIPE_POSTGRES_PASSWORD`.
3. Run `docker compose --profile production up --build`.
4. Run migrations inside the API container or via `infrastructure/scripts/run-migrations.sh`.
5. Seed only development or demo environments.
6. Reverse proxy `dinner.dcss.dev` to `127.0.0.1:8109`, with `/api/*` and `/media/*` proxied to `127.0.0.1:8108`.
7. Add the proposed Caddy config from `infrastructure/reverse-proxy/dinner.dcss.dev.Caddyfile.example` after review.

Do not place `OPENAI_API_KEY`, `JWT_SECRET`, or database passwords in tracked files. Keep them in the local `.env` with `0600` permissions or a deployment secret store.

PostgreSQL is not publicly exposed. The API and web services bind to localhost by default for reverse-proxy use.

Backups:

```bash
infrastructure/scripts/backup-postgres.sh
```

No active VPS reverse-proxy configuration is changed by this repository.
