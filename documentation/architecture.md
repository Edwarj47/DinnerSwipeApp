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

## Authentication

Dinner Swipe uses email/password as the primary credential for the MVP. Passwords are hashed server-side, access tokens are short-lived JWTs, and refresh tokens are issued for session continuity. The mobile app stores tokens through Expo SecureStore on native builds and retries once with the refresh token when an access token expires.

Biometric unlock is a device-local convenience layer. After sign-in, Android and iOS users can enable Face ID, fingerprint, or device unlock support to gate access to the saved local session. The backend still trusts only server-issued tokens.
