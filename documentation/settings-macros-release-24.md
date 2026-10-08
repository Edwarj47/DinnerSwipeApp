# Settings and Macros release 24

Android preview build 24 includes the fixed header settings menu, User settings
and Group settings, the Premium-only Macros tab, existing macro tracking, and
new Analytics. It also includes the previously tested macro calculator,
temporary nutrition lookup, empty-group state, and persistent default group.

## Release boundary

- FatSecret remains server-side. Only permitted IDs and user portions persist
  for provider calculations; provider nutrition is refreshed and not archived.
- The existing daily usage-driven refresh remains enabled. Catalog discovery
  remains disabled; provider budgets and credentials are unchanged.
- Migration `c76219a8410b` adds `nutrition_calculations` to the already deployed
  `b981fc2a7610` schema. No customer plan or recipe reset is intended.
- Only Dinner Swipe API, worker, web, and its nutrition job image are updated.
  Existing PostgreSQL, reverse proxy, n8n, and unrelated applications remain
  untouched.

## Rollback

Before deployment, retain private database/media/environment backups and the
three current application images tagged `before-preview24`. Rehearse the
additive migration against an isolated restored database and verify existing
rows before applying it live. On failure restore application images and retain
the additive schema; do not downgrade or overwrite newer customer activity.

Build, CI, live deployment, and APK verification results will be recorded after
they complete. Native biometric, camera, and notification checks still require
physical-device acceptance testing.
