# Discover, Meal Assistant, Week History, And Workouts

## Scope

- Discover category switches are account preferences. They narrow the curated group deck without modifying the owner's choices or filtering recipe libraries. Cached decks receive the same category filtering locally.
- Nutrition week history is a separate read-only endpoint. Missing historical weeks are not created, and opening history does not run current-week rollover. Selected meal names and timing are snapshotted. The migration can only backfill metadata still present in the database, not reconstruct previously deleted selections.
- Premium users can describe a meal, review food matches and serving sizes, and continue into the existing calculator. No entry or recipe is saved before confirmation. Missing amounts are never filled automatically. Weight conversions use an explicit metric serving; volume-to-weight guesses are prohibited.
- Voice capture is web-first. Android supports typed descriptions until a separately tested Expo recording upgrade. The API accepts bounded completed recordings, not URLs or live audio streams.
- Workouts use separate tables, plans, proposals, queues, snapshots, settings, and analytics. The mode and weight unit persist per account. Grocery is hidden only in workout mode; Macros retains its existing Premium gate. Workout scheduling and performance are available with Basic access.
- Group owners select shared workout Discover choices. Members propose workouts; only owners schedule them. Personal performance records are never a shared group feed. Photos use the existing normalized private upload pipeline, with no visible URL field.
- Manual workout reset carries eligible selections to the new week's dates. Automatic workout reset uses its own cursor and the existing worker. Android reminders have distinct workout identifiers and are cancelled on logout. Web notification controls are omitted.
- Performance sets and exercise notes/completion are structured data. Logs from scheduled workouts use the frozen plan snapshot. Unscheduled group logs use that selected group's frozen shared copy, not another group's copy or the owner's newer private routine. Revision checks reject stale unscheduled routines rather than attributing sets to an edited exercise. Corrections preserve the original logged routine.
- Reminder batches and cleanup run serially as complete operations, preventing a sync already in progress from recreating reminders after logout. An authoritative disabled/denied workout status cancels only workout reminders; transient connectivity failures do not cancel saved reminders.

## Provider And Upload Boundaries

FatSecret response labels, servings, and nutrition stay temporary. PostgreSQL stores permitted identifiers, user-derived food descriptions and portions, not copied provider macros or response bodies. The mobile app never calls FatSecret directly. The existing FatSecret global and account budgets remain unchanged.

Meal drafts retain only account-scoped metadata; their API views expire after one hour. UI provider views expire after 15 minutes and clear on close/background. Audio is normalized in `/tmp` (tmpfs in the API container), removed after decoding, and sent to the configured transcription provider. Transcripts are RAM-only, bounded to 100 entries, and expire after five minutes. Audio, transcript text, and provider payloads are not logged or written to application tables.

Voice limits: 60 seconds, 6 MiB per clip, two simultaneous upload/transcription requests per API process, one decoder, fixed allowed demuxers/protocols, CPU/address-space/stack/file limits, and a decoding deadline. Excess work is rejected, not queued indefinitely. Transcription and text extraction share the existing AI global/user dispatch limits. A separate decoder budget limits local processing.

Stored workout photo references are canonical owned media-object URLs. Responses use short-lived signed links. Group membership is checked again when links are renewed/read; private logs alone do not restore another owner's photo rights after membership is revoked. Cleanup retains assets referenced by frozen workout snapshots.

Offline workout performance is account-scoped and bounded to 100 queued records and 500 KB. Authentication grace and downloaded-read retention follow the existing 72-hour rules. Scheduling and group changes require connectivity. Explicit denials purge affected caches; account changes clear the old queue. Retries keep request UUIDs, and corrections arriving during sync are not removed by an older acknowledgement.

## Feature Flags

New paid-provider and workout features default to disabled:

```dotenv
NUTRITION_AI_ENABLED=false
NUTRITION_VOICE_ENABLED=false
NUTRITION_TRANSCRIPTION_MODEL=gpt-transcribe
NUTRITION_AI_DAILY_DRAFTS=20
WORKOUTS_ENABLED=false
```

Typed meal assistance also needs existing server-side OpenAI/FatSecret credentials, Premium access, and current FatSecret consent. Voice additionally needs FFmpeg/prlimit from the API image. Never add provider credentials to Expo public variables or the repository. Enable each flag only after release checks and acceptance testing.

The transcription request uses completed-file `/v1/audio/transcriptions` with the server-configured model, following the [official OpenAI file-transcription documentation](https://developers.openai.com/api/docs/guides/speech-to-text).

## Release And Rollback

1. Take and verify Dinner Swipe's own PostgreSQL/media backups and record the previous API/web image IDs. Do not touch unrelated VPS applications or databases.
2. Run the additive migrations with the migration-owner connection, not the runtime role: `f431d986a201` adds meal-history snapshots; `c7e40b9d2a61` creates isolated workout tables. Confirm runtime-role default privileges cover the new tables.
3. Deploy the API/worker before clients, initially with new feature flags disabled. Verify auth, existing planning, groceries, imports, calculator, private media, and account export.
4. Deploy web/build Android from the same tested source. Enable typed assistance and workouts separately after acceptance checks; enable web voice only after upload/provider checks.
5. For application rollback, disable flags and restore previous images while retaining additive schema and new user data. Do not downgrade/drop workout tables after users have written records. Database restoration requires a reviewed recovery plan and explicit authorization.

Account export includes the caller's workout templates, personal weeks, and private performance, without other members' private account identifiers. Account deletion remains the existing manual-review request workflow; that review must include all workout tables and retained media references.

## Verification

`infrastructure/scripts/verify-expansion-migrations.py` creates a private disposable PostgreSQL container, migrates synthetic existing data, checks snapshot backfill, and tests rollback. It never connects to the live Dinner Swipe database.

Run backend Ruff/mypy/pytest, mobile ESLint/typecheck/Jest, web export, and browser flows at 320 px, 390 px, and desktop widths. Test Basic/Premium gating, cross-account/group denials, historical immutability, photo revocation, stale-routine handling, offline correction/retry, and quota failures with mocked providers. Existing opt-in PostgreSQL concurrency suites require their explicitly disposable database configuration.

The web app is the Expo/React Native Web export served by Nginx behind the VPS proxy. Core API-backed functionality can be tested there without spending an EAS cloud build, but native biometrics, notifications, and future native recording require device verification.

### Local Results, 2026-10-14

- Backend: 431 standard tests passed. The six existing opt-in PostgreSQL checks and the new workout concurrency check were run separately and all seven passed against newly created disposable databases. No production database was used.
- Mobile: 439 tests passed across 51 suites with a cold Jest transform cache, including reminder/logout races and owner-scoped offline performance retries.
- Static checks: backend Ruff and strict mypy (130 sources), mobile ESLint and TypeScript, and `git diff --check` passed.
- Disposable PostgreSQL migration verification: upgrade from the previous schema, existing data preservation, history-snapshot backfill, and downgrade passed.
- Browser checks: 320 x 720, 390 x 844, and 1280 x 900 passed for Discover filtering, settings, read-only meal history, reviewed meal assistance/calculator, mode switching, title-only workouts, actual performance sets, private sessions/progress, and reset settings. No page errors or horizontal overflow were observed.
- Builds: web export and the isolated API Docker image passed. The restricted non-root, read-only container normalized WAV/WebM/MP4 and rejected overlong/concurrent decoding, with temporary-file cleanup verified.

Provider calls were mocked for these tests; live provider acceptance testing remains a release check. Android notification delivery and native hardware features have not been verified on a device in this implementation pass. Native voice remains deferred. The production API/web/worker, PostgreSQL data, provider configuration, and APK were not changed. No source changes were committed or pushed.
