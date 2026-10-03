# Offline Support: First Release

## Release Status

Source `bbe2e76` was pushed on 2026-10-03. All GitHub CI jobs passed. Standalone
Android preview 14 completed and its APK passed artifact verification; see
[the build record](android-preview-uat.md#build-14-update).

The production API/database and web remain on their prior deployment. Offline
cache access and queued writes require migration `e19a71c042bf` and the updated
API; installing the APK alone does not activate them. Physical-phone acceptance
testing remains pending after that deployment.

## Scope

- First sign-in, account creation, password reset, billing/coupons, AI, web imports,
  sharing/group actions and weekly-plan mutations require the API.
- Network errors, timeouts, 429 and 5xx responses preserve credentials. An explicit
  invalid/revoked session does not unlock cached content.
- Recently verified members can read downloaded recipes, the current week's plan
  and groceries. Premium members can read downloaded macro entries and totals.
- Grocery check-offs/quantity changes and personal macro create/edit/delete are
  persisted before the app reports success. Recipe logs capture the reviewed
  nutrition totals, not values recalculated when a queued request reaches the API.
- Shared planning, recipe edits, pantry changes and grocery regeneration remain
  online-only in this phase. They are not silently queued.

## Device Behavior

The server grants at most 72 hours of offline use, capped by the subscription's
known period end. Expiry or a detected clock rollback requires reconnection, but
does not delete queued work. This is a bounded convenience cache, not a new
subscription entitlement or tamper-proof offline DRM. Server authorization is
always checked on synchronization. Existing device biometrics still apply.

An active app checks reconnects and foreground events; pending/offline sessions
retry every 30 seconds. Android/iOS do not receive a new background job in this
release. Reopening the app may be necessary to finish synchronization.

The status band opens a pending-changes view. Conflicts stop synchronization and
retain the user's local values. Retry preserves the same operation ID; it never
forces an overwrite. Discard local changes removes the whole pending chain for
that item, then refreshed server data can be used to make a new edit. No other
item's changes are discarded.

Daily entries reflect pending changes. Server summary/trend totals exclude them
until acknowledged; the tracker labels this and disables export while macros
are pending. A macro date must be downloaded before editing it offline. Missing
data is not represented as an empty saved day. Last week's cached plan/groceries
are not represented as this week's current data.

## Storage and Privacy

Native tokens use SecureStore; web tokens retain the existing localStorage flow.
Downloaded data and pending edits use account-scoped AsyncStorage in the app's
sandbox (browser storage on web). This cache is **not separately encrypted**.
Device lock/OS protections matter. Do not describe it as encrypted storage.

The app warms profile, weekly plan, groceries and the first 100 library/discover
recipes. Premium also warms macro entries from 30 days before through 3 days
after the current date and targets. Visited supported responses are cached too.
Recipe search offline searches downloaded rows only. Photos are not explicitly
downloaded; their availability depends on the image cache.

Storage evicts old read snapshots, never unsynced edits; the queue is limited to
100 operations and the document to roughly 500,000 JSON characters. A failed
local save reports an error instead of acknowledging the action. Web queued
writes require Web Locks (secure context). Multiple tabs share the locked outbox.

Sign-out removes credentials/active ownership, not unsynced data. Reauthenticating
as the same user restores that account's queue; another account cannot read it
through the app. Clearing app/browser storage or uninstalling loses unsynced
work. Account exports reflect server data, so sync first for a complete export.

Server retry receipts contain user/operation IDs, a request hash, result ID,
revision/status and timestamps. They do not retain deleted meal content. They
are retained for replay protection, included in account export, and cascade on
actual account deletion. Account deletion remains the existing reviewed workflow.

The standalone native app already bundles its shell. This phase does **not** add
a web service worker: an open web app can use the offline data, and an API outage
can survive a browser reload while the web host is reachable. A fully offline
cold launch of the PWA is not guaranteed.

## Verification and Release

Verified locally on 2026-10-03: 72 mobile tests (cold Jest cache), 109 API tests,
lint, TypeScript, Ruff, mypy and the web export passed. The opt-in PostgreSQL test
passed separately and is skipped by the normal suite. Playwright passed at
320px, 390px and 1280px widths with mocked API outages, saved-edit reloads,
reconnection and conflict/discard checks. No real billing or AI calls were used.
Physical-phone airplane-mode testing remains a release acceptance step.

Automated mobile tests cover credential retention, revocation, account isolation,
storage failures, restart hydration, bounded access, outbox ordering, response
loss/retry, conflict discard, downloaded recipe search and offline macro edits.
API tests cover validation, ownership, current entitlement checks and replay.
The opt-in PostgreSQL test exercises five concurrent retries, atomic rollback,
and migration up/down/up preserving existing users/meals.

Run the API suite from `apps/api`, not the repository root where production
environment configuration may be loaded. Optional PostgreSQL test:

```sh
OFFLINE_TEST_DATABASE_URL=postgresql+psycopg://postgres@127.0.0.1:15413/offline_test \
  .venv/bin/pytest app/tests/test_offline_postgres.py
```

That URL must point to a fresh, disposable local database. The test changes its
schema; it explicitly rejects any other host, port or database name.

Deployment order:

1. Take a Dinner Swipe-only database backup and retain current API/worker/web
   images. Confirm restoration before applying the migration.
2. Apply `e19a71c042bf` and deploy the API. Older clients remain supported.
3. Publish web and build a new standalone APK. AsyncStorage, NetInfo and Crypto
   include native modules; this is not an OTA-only release.
4. On a phone: sign in online, wait for downloads, enable airplane mode, restart,
   check a grocery item and log a macro; restart again, reconnect, verify one
   server mutation per action. Test biometrics, conflict review and sign-out.

Keep the additive receipt table during an application rollback. Dropping it after
real clients have queued work removes replay protection and must not be done as
a routine rollback. No production migration/deployment is part of local testing.
