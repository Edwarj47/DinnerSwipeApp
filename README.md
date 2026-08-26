# Dinner Swipe

Dinner Swipe is a mobile-first Expo/FastAPI MVP for discovering meals, planning weekly dinners, importing recipes, and generating grocery lists.

## Quick Start

```bash
cd /home/codexvps/Desktop/projects/dinner-swipe
cp .env.example .env
make api-install
make migrate
make seed
make mobile-install
make api-run
```

In another shell:

```bash
make mobile-web
```

Open `http://127.0.0.1:19006`, register from Profile, then use Discover.

## What Works

- Expo Router mobile web, Android, iOS-ready app shell
- Email/password auth with JWT access and refresh tokens, local sign-out, and native biometric unlock for saved sessions
- Account password change, JSON data export, password-confirmed deletion request, and basic auth rate limiting
- Database-backed refresh-token rotation/revocation and first-run sign-in gate
- Swipeable meal cards with accessible action buttons
- Favorites, hidden meals, weekly plan slots, pantry exclusions, grocery aggregation, and configurable retailer search links
- CSV/XLSX upload, column mapping suggestions, validation, duplicate checks, preview, partial import, confirmation, and CSV error export
- Public recipe URL ingestion with SSRF protections, JSON-LD extraction, metadata fallback, conservative HTML hints, AI normalization adapter, and approval gate
- Manual recipe creation with phone-friendly details, photo upload/preview, validation counts, and starter templates
- Configurable media storage adapter with local storage active and Azure Blob-ready configuration
- Email verification and password reset foundation with branded HTML email templates
- Household invite codes, majority-based group voting, owner-visible vote counts, percentages, and voter detail
- User profile max-cook-time filtering and per-user allergen/disliked ingredient storage
- Premium macro-tracker foundation with server-side entitlements, waiver-code unlocks, macro targets, meal confirmations, and Stripe-ready Checkout/webhook adapters
- Dinner Swipe privacy and terms pages adapted from DCSS legal language
- Alembic database migration and Docker Compose stack with isolated PostgreSQL

## Assumptions

- The initial web deployment is hosted behind a future reverse proxy route such as `dinner.dcss.dev`.
- PostgreSQL for Dinner Swipe is separate from existing VPS databases.
- OpenAI ingestion is disabled unless `AI_INGESTION_ENABLED=true` and `OPENAI_API_KEY` are configured in the ignored local `.env`.
- Stripe billing is disabled unless the Stripe account is verified and `STRIPE_ENABLED=true` plus Stripe secrets and price IDs are configured in the ignored local `.env`.
- Retailer MVP support is search-link generation only. No login, cart automation, checkout, or scraping is implemented.
- Placeholder recipe images are development-only and should be replaced or copied into controlled storage before production.

## Common Commands

```bash
cd apps/api && ../../.venv/bin/alembic upgrade head
cd apps/api && ../../.venv/bin/python -m app.workers.seed
cd apps/api && ../../.venv/bin/pytest
npm run lint -w apps/mobile
npm run typecheck -w apps/mobile
npm test -w apps/mobile -- --runInBand
npm run build:web -w apps/mobile
docker compose --profile production up --build
```

For the planned VPS route, point `https://dinner.dcss.dev` at the local web service on `127.0.0.1:8109` and proxy `/api/*` plus `/media/*` to `127.0.0.1:8108`.

## Documentation

- `documentation/environment-assessment.md`
- `documentation/build-plan.md`
- `documentation/architecture.md`
- `documentation/database-overview.md`
- `documentation/import-format-spec.md`
- `documentation/url-ingestion-security.md`
- `documentation/ai-ingestion-behavior.md`
- `documentation/vps-deployment-guide.md`
- `documentation/expo-eas-build-guide.md`
- `documentation/testing-guide.md`
- `documentation/future-walmart-integration.md`
- `documentation/future-onenote-integration.md`
- `documentation/known-limitations.md`
- `documentation/security-checklist.md`
- `documentation/scaling-plan.md`
- `documentation/azure-migration-guide.md`
- `documentation/secrets-and-public-repo.md`
- `documentation/premium-macro-tracker.md`
- `documentation/store-release-and-cicd-roadmap.md`
- `documentation/privacy-policy.md`
- `documentation/terms-of-service.md`
