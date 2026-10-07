# Group Planning And Balanced UI Release 23

Status: release preparation on 2026-10-07. Deployment and APK verification
results will be recorded below after completion.

Final release checks passed: 173 API tests, 222 mobile tests across 33 suites,
API Ruff/mypy and frontend lint/TypeScript, plus both opt-in PostgreSQL tests.
A fresh migration rehearsal preserved all 1,494 legacy rows across 40 tables.
The environment-secret scan and whitespace checks passed.

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
