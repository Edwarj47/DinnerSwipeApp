# Group Planning And Balanced UI Release 23

Status: source pushed and API/worker/web deployed on 2026-10-07. Android preview
build 23 is queued; APK verification is pending, not complete.

Final release checks passed: 173 API tests, 222 mobile tests across 33 suites,
API Ruff/mypy and frontend lint/TypeScript, plus both opt-in PostgreSQL tests.
A fresh migration rehearsal preserved all 1,494 legacy rows across 40 tables.
The environment-secret scan and whitespace checks passed.

## Deployment Evidence

- Source commit `dd5b288` is pushed. [CI 37635907204](https://github.com/Edwarj47/DinnerSwipeApp/actions/runs/37635907204)
  passed backend, frontend and Docker jobs.
- Live database revision is `a8f97b321c40`. During the brief API/worker pause,
  a fresh quiescent backup was taken; the live migration preserved all 1,494
  legacy rows across 40 tables. New group tables remained empty. No private
  plans were copied into groups or enabled as group Discover choices.
- API/worker image `1f9dedd52789` and web image `bb2761415865` are live at
  `https://dinner.dcss.dev`. Public health, group and legacy route contracts,
  anonymous route protection and served-asset/image matching passed.
- Candidate and live browser checks passed at 320, 390 and 1280 pixel widths,
  plus 200% text. Group curation/retry, explicit approval, kitchen switching,
  member permissions, personal portions, scoped groceries, dialogs, labels,
  navigation and mouse scrolling passed with intercepted fixture APIs.
- Read-only customer snapshots confirmed all 10 personal planned meals,
  portions, ordering, locks, nutrition and swipe history unchanged.
- Dinner Swipe Postgres and all unrelated container IDs/images/start times
  remained unchanged. Environment values, billing/provider settings and live
  reverse-proxy configuration were not changed.
- Private rollback archive: `backups/releases/20261007T142042Z_preview23`.
  Database/media/environment backups are mode 0600 and Git-ignored. Retained
  image tags are `dinner-swipe-{api,worker,web}:before-preview23`.

Release checks, preflight and deployment logs are retained in that archive.
Browser fixtures did not make authenticated writes to customer accounts.

## Follow-Up Checks

- A documentation-only CI run failed once in the mobile test step. Its restricted
  logs were not available here, and the cause was not confirmed. The source CI
  and subsequent diagnostic CI passed, as did five additional full cold-cache
  runs (222 tests each). CI now emits bounded structured failure annotations
  without requiring job-log access. No tests were skipped or retried to hide a
  failure.
- Direct footer clicks navigated correctly. A follow-up found that web links
  lacked a current-page accessibility marker. The web branch now exposes a
  navigation landmark and `aria-current="page"`; native tab roles, selection,
  navigation events and layout are unchanged. All 222 tests and candidate
  browser checks passed, including every footer link at 320, 390 and 1280 pixel
  widths and enlarged text. The web-only deployment is being prepared.
- The Android build remains based on `dd5b288`. Later CI diagnostics and the
  web-only accessibility metadata do not change Android runtime behavior.

## Scope

This release combines the explicit group Discover choices, proposals, shared
calendar and grocery/pantry isolation with the balanced mobile layout changes.
Personal plans and nutrition history remain separate from group activity.
Older clients retain their personal planning endpoints.

Implementation and local test evidence:
[Group planning](group-planning-uat.md) and
[Balanced UI polish](balanced-ui-polish-uat.md).

## Rollback

Before migration, take a fresh Dinner Swipe-only database/media backup and retain
the currently running API, worker and web images. Rehearse the additive migration
against a restored copy and verify existing rows. Deploy only those three Dinner
Swipe application services; leave Postgres and unrelated services/routes alone.

Rollback restores the prior application images with the additive schema intact.
Do not downgrade or restore an older database over new customer activity.

## Android Checks

Build 23 must use the standalone preview profile, package
`dev.dcss.dinnerswipe`, version `0.1.0` and the existing signing certificate.
Verify the downloaded APK, embedded configuration, production API URL and group
UI markers. Install over the previous build, without uninstalling.

Physical Android large-text, keyboard, safe-area, gestures, group permissions,
notification delivery and biometrics remain device UAT; browser and mocked
native checks do not establish physical-phone behavior.
