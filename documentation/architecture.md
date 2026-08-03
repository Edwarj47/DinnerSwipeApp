# Architecture

Dinner Swipe is a monorepo with an Expo universal mobile app and a FastAPI backend.

The current product focus is web-based recipe retrieval, manual recipe creation with optional photo upload, weekly planning, grocery generation, and household group voting. Spreadsheet import remains available but is no longer the primary add-recipe path.

- `apps/mobile`: Expo Router app for Android, iOS, mobile web, and PWA export.
- `apps/api`: FastAPI, SQLAlchemy 2.x, Alembic, import parsing, URL ingestion, and background worker shell.
- `packages/shared-types`: shared TypeScript enum definitions.
- `packages/validation`: canonical import field definitions.
- `packages/config`: public app configuration helper.
- `infrastructure`: Dockerfiles, compose helpers, and proposed reverse-proxy config.

The backend is modular by route and service boundary but remains one deployable app for the MVP. Long-running work is represented in `ingestion_jobs`; the current worker is intentionally minimal and can pick up queued jobs as workflows mature.
