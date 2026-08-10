# Dinner Swipe Build Plan

## Phase 1: Foundation

- [x] Create isolated monorepo under `/home/codexvps/Desktop/dinner-swipe`
- [x] Record VPS environment assessment
- [x] Add root README, `.env.example`, Makefile, Docker Compose, and CI
- [x] Scaffold Expo universal app with Expo Router
- [x] Scaffold FastAPI API with strict Pydantic schemas
- [x] Add SQLAlchemy models and Alembic migration
- [x] Add auth foundation with email/password, JWT access and refresh tokens
- [x] Add health checks
- [x] Add development seed recipes
- [ ] Run the full production-like compose stack against local PostgreSQL

## Phase 2: Core Meal Experience

- [x] Discover tab with swipeable meal cards and visible action buttons
- [x] Favorites and hidden recipe actions
- [x] This Week tab with dinner slots, reordering hooks, leftovers/dining-out/flexible slots, servings, removal, and lock state
- [x] Recipe list/detail/create/edit/archive foundations
- [x] Zustand store for offline-capable client state
- [ ] Full native-device gesture QA on Android and iOS hardware

## Phase 3: Grocery Generation

- [x] Ingredient normalization and conservative aggregation
- [x] Pantry exclusions
- [x] Grocery categories
- [x] Manual item additions
- [x] Check-off and quantity editing endpoints
- [x] Configurable retailer search-link adapters
- [ ] Preferred product selection UI is implemented as stored metadata, not a live product picker

## Phase 4: Spreadsheet Import

- [x] CSV and XLSX upload endpoint
- [x] Safe parser limits and extension/content-type checks
- [x] Column mapping suggestions
- [x] Preview endpoint
- [x] Row validation
- [x] Duplicate detection
- [x] Partial import of valid rows
- [x] Invalid rows retained for review
- [x] Error-report CSV export with formula-injection protection
- [x] Canonical CSV/XLSX templates
- [ ] Uploaded archive image matching is deferred

## Phase 5: URL Ingestion

- [x] SSRF-guarded URL fetcher
- [x] Schema.org JSON-LD recipe extraction
- [x] Open Graph image/title fallback
- [x] Conservative visible HTML extraction
- [x] AI normalization provider interface using OpenAI Responses API
- [x] Graceful disabled state when no API key or flag is present
- [x] Review/approval endpoint
- [x] Photo URL validation
- [ ] Browser-rendered extraction worker is adapter-only and disabled

## Phase 6: Production Preparation

- [x] Mobile web and PWA configuration
- [x] EAS build profiles
- [x] Dockerfiles and compose services
- [x] CI workflows for lint, type checks, tests, builds
- [x] Deployment docs and proposed reverse-proxy config
- [x] Security checklist
- [ ] Store submission setup is documentation only
- [ ] Production OpenAI credentials, app signing, and domain routing require external account setup
