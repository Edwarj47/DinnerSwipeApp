# Android Preview UAT

Updated 2026-10-06 for Android preview build 21.

## Build 21 Update

- Source `cc41224` pushed. [CI 37395246990](https://github.com/Edwarj47/DinnerSwipeApp/actions/runs/37395246990)
  passed backend, frontend, and Docker jobs.
- All five tabs have tighter spacing, restrained headings, full-size touch
  targets, and centered desktop content. Empty weekdays remain visible.
- Collapsed weekly meals retain just Edit. Duplicate appears only beside the
  serving controls in the expanded editor, with weekdays and Unscheduled as
  destinations. Copies preserve portions and do not copy consumption or locks.
- The unused meal-type selector and Keep controls are gone. Existing legacy
  values are preserved. Ate/Skipped/Remove collapse after successful saving;
  success feedback lasts five seconds, while errors remain for retry.
- API add-slot accepts optional servings from 1 through 30. Older clients that
  omit the field retain their existing default. No migration is required.
- Local checks passed: 153 backend tests with one existing skip, 194 mobile
  tests in 31 suites with a cold transform cache, lint, mypy, TypeScript, web
  export, whitespace checks, and a private-environment secret scan.
- A fresh backup was restored into isolated PostgreSQL. All 1,469 original
  rows across 41 tables remained unchanged during fixture tests of duplication,
  grocery scaling, invalid requests, old clients, and meal-log preservation.
- Candidate and live browser checks passed at 320x720, 390x844, 768x1024,
  1280x800, and enlarged phone text. Checks covered all tabs, recipes, pantry,
  invites, tour callouts, drag/reordering, duplication, feedback, and scrolling.
  API calls were intercepted; no customer fixture writes were made.
- API/worker image `110ea3873a8f` and web image `8ff9892fa777` are live at
  `https://dinner.dcss.dev`. Served assets match the image; health, anonymous
  route protection, and the live optional-servings contract passed.
- Read-only account snapshots verified the weekly plan, portions, order, locks,
  nutrition, and swipe history unchanged. Postgres, environment, and unrelated
  containers stayed unchanged; no billing or provider configuration changed.
- Private rollback archive: `backups/releases/20261006T004045Z_preview21`.
  Database/media checksum checks passed. Prior image tags retained:
  `dinner-swipe-api:before-preview21`, `dinner-swipe-worker:before-preview21`,
  and `dinner-swipe-web:before-preview21`. Application rollback restores only
  these images, not the database over new customer writes.
- EAS build `628c2747-ecae-4b41-91d1-00528fef6f83` finished October 6 at
  00:51 UTC from `cc41224`. Standalone preview version `0.1.0`, package
  `dev.dcss.dinnerswipe`, Android version code `21`; no Metro server is needed.
- Download length, ZIP integrity, embedded configuration, production API URL,
  and bundled feature checks passed. Certificate matches build 20.
  Size 79,669,479 bytes; SHA-256:
  `e2292ac59510a04eb7c2afdda42ce56b899fbc927216082085ccb9fdb3ab812f`.
  Direct link shared privately. Install over build 20 to retain the local session.
  Physical-phone installation and native gesture UAT remain pending.

Phone checklist and detailed release evidence: [UI cleanup UAT](ui-cleanup-uat.md).

## Build 20 Update

- Source `fa4629f` pushed. [CI 37258571275](https://github.com/Edwarj47/DinnerSwipeApp/actions/runs/37258571275)
  passed backend, frontend, and Docker jobs.
- Profile > Account > Account Settings > Planning now includes Weekly reset.
  Manual only is the default and carries meals into new weeks. Automatic mode
  lets the user choose a reset weekday and optional 9 AM phone reminder.
- The Monday-Sunday layout stays unchanged. Reset uses midnight in the saved
  account time zone; phone reminders use 9 AM in the phone's local time zone.
  Enabling or changing the schedule never immediately clears existing meals.
- Time zone initialization was verified from fresh browser entries on Profile,
  Grocery, This Week and Discover. General profile updates cannot overwrite the
  server reset cursor. Logged nutrition and swipe analytics are retained.
- Local checks passed: 148 backend tests, one existing skip; 174 mobile tests
  in 30 suites; Python/mobile lint, mypy, TypeScript, and web export.
- A fresh Dinner Swipe backup was restored into isolated PostgreSQL. All
  1,466 original rows across 41 tables stayed unchanged during fixture tests.
  Twenty-four concurrent requests verified one rollover and one scheduled reset,
  with portions, locks, grocery recalculation and logged nutrition preserved.
- Candidate and live browser checks passed at 320x720, 390x844 and 1280x720:
  setting persistence, transient notices, custom macro summaries, recipe logos,
  drag behavior and mouse scrolling. Independent weight-unit and pantry
  regression checks also passed on the candidate. API calls were intercepted
  by fixtures; browser tests did not modify customer data.
- API/worker image `efab2d7b04bb` and web image `ad7348c1ad63` are live at
  `https://dinner.dcss.dev`. Served web assets match the image. Public health and
  anonymous route protection checks passed. Only Dinner Swipe API, worker and
  web were recreated; Postgres, environment and all unrelated containers stayed
  unchanged. No schema migration, billing or provider changes were made.
- Live read-only before/after checks confirmed the customer's 10 recovered
  meals, portions, order, locks, logged nutrition and swipe history unchanged.
- Private rollback archive: `backups/releases/20261005T031351Z_preview20`.
  Database, media, environment, image tags and verification records retained.
  Rollback tags: `dinner-swipe-api:before-preview20`,
  `dinner-swipe-worker:before-preview20`, `dinner-swipe-web:before-preview20`.
- EAS build `f51ee43f-9d40-4f8a-b94f-38168942968a` finished on October 5
  at 03:24 UTC from `fa4629f`. Standalone preview version `0.1.0`, package
  `dev.dcss.dinnerswipe`, Android version code `20`; no Metro server is required.
- Download length, ZIP integrity, embedded package/version, production API URL,
  and bundled settings/reminder checks passed. The signing certificate matches
  build 19. SHA-256:
  `906bc9aab4d587254d9efca226530f7c20d4d22e586312c71c62961d0849ae3e`.
  The direct download link is shared privately. Install over build 19 to retain
  the local session. Physical-phone installation and notification delivery UAT
  remain pending; native scheduling/cancellation paths passed mocked tests.

### Build 20 Phone Checks

1. Install over build 19 and confirm the restored meals remain present.
2. In Planning settings, verify Manual only carries meals without a reminder.
3. Choose Automatic, a weekday and a phone reminder; grant OS notification
   permission. Saving must not clear meals until the next selected reset day.
4. Verify the local weekly reminder and that tapping it opens This Week.
   Android battery/notification controls can delay or suppress delivery.
5. Disable the reminder or select Manual only and save; verify cancellation.
   Repeat after signing out and signing into a different account.
6. Verify local midnight rollover and no repeat reset after adding new meals.

Detailed behavior and edge cases: [Weekly reset UAT](weekly-reset-uat.md).

## Build 19 Update

- Source `7e33e49` pushed. [CI 37252009584](https://github.com/Edwarj47/DinnerSwipeApp/actions/runs/37252009584)
  passed backend, frontend, and Docker jobs.
- Normal grocery sync is silent. An unresolved offline/outbox state shows a
  notice after 10 seconds; conflicts and storage errors remain immediate.
- Profile > Account > Account Settings > Measurement units saves independent
  g/oz choices for protein, carbs, fat, fiber, and ingredient weights to the
  account. Forms and displays follow these choices automatically; nutrition
  payloads and exports remain in grams. The inline "As added" selector is gone.
- Weight conversions preserve original grocery/pantry storage units. Counts,
  cups, fluid ounces, and other volume units are not converted by guessing density.
- Summary help reads: "Choose how many days to show, including today. Enter 1
  for today only." Existing summary persistence and range limits are unchanged.
- Local checks passed: 168 mobile tests in 29 suites, lint, TypeScript, and web
  export. Candidate and deployed browser checks passed at 320x720, 390x844, and
  1280x720, covering unit persistence, connection-failure retry, canonical
  payloads, pantry keyboard-height scrolling, and existing scrolling/drag flows.
- Web image `eefd1105538a` is live at `https://dinner.dcss.dev`. Public HTML and
  JavaScript match the deployed image; health and anonymous route protection
  checks passed. Browser fixtures intercepted all API calls; no customer writes
  or billing tests were made.
- Rollback archive: `backups/releases/20261005T013936Z_preview19`, including the
  previous static site, source commit, environment fingerprint, and container
  records. Retained image: `dinner-swipe-web:before-preview19` (`594de2568cc3`).
- Only the web container changed. Dinner Swipe API/worker/Postgres, environment,
  and all unrelated containers were verified unchanged. No migration or backend
  deployment was necessary. The first candidate's restrictive asset permissions
  were corrected before deployment; backups remain private.
- EAS build `e38c9965-5b64-4eca-8cc1-8ffd3c8f2749` finished on October 5 at
  01:45 UTC from `7e33e49`. Standalone preview version `0.1.0`, package
  `dev.dcss.dinnerswipe`, Android version code `19`; no Metro server is required.
- Download length, ZIP integrity, embedded package/version, production API URL,
  and bundled feature checks passed. The signing certificate matches build 18.
  Size 79,606,238 bytes; SHA-256:
  `05a446498a694569323a8cf644c7e0511847d052331b3f8be716ba1961f57134`.
  The direct download link is shared privately. Install over build 18 to preserve
  local session data. Physical-phone installation and UAT remain pending.

### Build 19 Phone Checks

1. Install over build 18 without uninstalling; confirm the saved session remains.
2. Check groceries on a normal connection: no sync banner should flash. Hold an
   unsynced edit for more than 10 seconds, reconnect, and verify notice recovery.
3. Set protein to oz and carbs to g in Account Settings. Check recipe creation,
   recipe-based logging, targets, and macro displays. Calories should not change.
4. Enter partial pantry stock in oz for a gram-based item. Check the remainder;
   counted items and cups should remain unchanged. Reopen to verify preferences.
5. Open summary days with the Android keyboard visible and check the helper,
   validation, and Apply button. Recheck biometrics and weekly drag ordering.

### Build 19 Web Rollback

No database restore is needed. Do not replace current customer data or restart
API/worker/Postgres for a web rollback.

```bash
docker tag dinner-swipe-web:before-preview19 dinner-swipe-dinner-swipe-web
docker compose --profile production up -d --no-deps --no-build --wait dinner-swipe-web
```

## Build 18 Update

- Source `9767b41` pushed. [CI 37242832541](https://github.com/Edwarj47/DinnerSwipeApp/actions/runs/37242832541)
  passed backend, frontend, and Docker jobs.
- Desktop mouse-wheel scrolling works across the main pages. This Week uses one
  bounded scroll area and retains drag ordering and cross-day assignment.
- Missing or broken recipe photos use the bundled Dinner Swipe logo across the
  library, pickers, meal cards, details, sharing, and macro logging.
- New Discover/Plan It meals are Unscheduled, including when reusing a dated empty
  slot left after a reset. Existing scheduled meals are not moved.
- Macro summary accepts 1-3,650 whole days and remembers the user's selection.
  Apply queries the lightweight summary endpoint; Calendar/Trends ranges and
  all-time export remain unchanged.
- Biometric prompts wait for the foreground and do not loop after cancellation
  or immediately re-lock after a slow native prompt. Password fallback preserves
  the biometric preference. Physical-phone biometric UAT remains required.
- Local verification: 137 API tests passed with one existing skip; 152 mobile
  tests across 27 suites, Ruff/mypy, lint/types, and web export passed. Isolated
  browser checks passed at 320/390/1280 pixels.
- EAS build `43bc1588-a00b-4846-875c-6fa1b179d1f9` finished October 4 at 7:24 PM EDT
  from `9767b41`. Package `dev.dcss.dinnerswipe`, version `0.1.0`, version code `18`.
  Standalone preview APK; no Metro server is needed. The direct download link is
  shared privately. Install over build 17 to preserve local session data.
- Download length, ZIP integrity, embedded package/version, production API URL,
  and bundled feature checks passed. The signing certificate matches build 17.
  Size 79,602,897 bytes; SHA-256:
  `56d3d3bf50ad9399ea2a4c332feb8313758e7023fd69998de67e4e6e4922b769`.
- With explicit approval, API image `234f1fc386b4` and web image `594de2568cc3`
  were deployed to `https://dinner.dcss.dev`. No migration was required; schema
  remains `f20b84e901ac`. No billing/provider configuration was changed.
- Fresh private backup: `backups/releases/20261004T232139Z_preview18`, including
  database/media/environment, restored-data fingerprints, and container records.
  Isolated restore covered 41 tables and 1,391 rows. PostgreSQL smoke tests passed
  custom summary inclusion/limits and Sunday reset followed by an Unscheduled swipe.
- Live read-only authenticated summaries for 501/3,650 days matched stored totals.
  Invalid ranges, anonymous route protection, public health, and deployed browser
  checks passed. Public HTML/JavaScript bytes match the deployed web image.
  No customer recipe, plan, macro, or billing writes were made by release tests.
- Only API/web containers changed. Environment, Dinner Swipe worker/Postgres,
  and all unrelated container IDs/images/start times were verified unchanged.
- The first switch was rolled back because an artifact verification script
  assumed an `entry-` bundle name instead of this build's `index-` name. The
  corrected check was tested on the candidate image before the successful switch.

### Build 18 Phone Checks

1. Install over the existing app without uninstalling; confirm the saved session.
2. Cold-launch with biometrics enabled; cancel, retry, and use password fallback.
   Confirm the preference remains enabled and the background grace period works.
3. Check imported/missing/broken photo fallbacks, then add a real recipe photo.
4. Reset Sunday and Plan It on a new recipe; it should be Unscheduled. Existing
   scheduled meals should remain on their assigned days.
5. Set summary days to 21 or 501, Apply, and reopen the app; verify persistence.
   Reload the installed web app and check wheel scrolling across all main pages.

### Build 18 Rollback

Retained images: `dinner-swipe-api:before-preview18` and
`dinner-swipe-web:before-preview18`. No database rollback is needed for this release.
Keep the schema and subsequent customer writes; do not restore a whole database
over new data. Worker/Postgres do not need restarting.

```bash
docker tag dinner-swipe-api:before-preview18 dinner-swipe-dinner-swipe-api
docker tag dinner-swipe-web:before-preview18 dinner-swipe-dinner-swipe-web
docker compose --profile production up -d --no-deps --no-build --wait dinner-swipe-api dinner-swipe-web
```

## Build 17 Update

- Source `ef1630c` pushed. [CI 37234549874](https://github.com/Edwarj47/DinnerSwipeApp/actions/runs/37234549874)
  passed backend, frontend, and Docker jobs.
- Profile > Group > select a shared group > Share recipes supports search,
  individual/multiple selections, Select all across unloaded pages, and exceptions.
  Sharing grants group access without moving or duplicating private originals.
- Beverages is available in recipe creation, editing, web/AI review, display
  labels, daily macros, and recipe-based logging, including fractional portions.
- Local verification: 136 API tests passed with one existing skip; 125 mobile
  tests, Ruff/mypy, lint/types, and web export passed. Isolated browser checks
  passed at 320/390/1280 pixels. Real PostgreSQL checks passed concurrent share
  retries, membership restrictions, beverage portions, and analytics export.
- EAS build `1d824ec8-609c-4940-a788-5d9bd977b00f` finished October 4 at 21:14 UTC
  from `ef1630c`. Package `dev.dcss.dinnerswipe`, version `0.1.0`, version code `17`.
  Standalone preview APK; no Metro server is needed. The direct download link
  is shared privately. Physical-phone installation and UAT remain pending.
- Download length, ZIP integrity, embedded package/version, API URL, and bundled
  feature checks passed. The signing certificate matches build 16. Size
  79,601,382 bytes; SHA-256:
  `2a9ce466fc26ffc7a2ab4e0eebfb88a4e2760eb1e2adea8c2bd6f5c3c6981f53`.
- With explicit approval, API/worker image `d0b8227fbce2` was deployed, and the
  pending additive migrations advanced the schema from `d8126c4ab391` to
  `f20b84e901ac`. Offline receipts and hybrid pantry coverage are now supported
  by the API. No billing/provider configuration was changed.
- Fresh private backup and restore/migration checks:
  `backups/releases/20261004T211732Z_preview17`. Includes database/media/environment,
  a final quiescent snapshot, data fingerprints, and before/after container records.
  Upgrade/downgrade/re-upgrade on a disposable restored database preserved all
  original data. Live migration preserved every original value across 39 tables
  and 1,385 rows before accepting requests again.
- Live health, read-only authenticated picker pagination, route protection, beverage
  validation/AI schema, and offline capability checks passed. No recipes were
  shared or macro entries written to live customer accounts by release tests.
- Only Dinner Swipe API and worker containers were recreated. The environment file,
  Dinner Swipe web/Postgres, and all unrelated container IDs/images/start times
  remained unchanged. The web frontend was not republished in this release.

### Build 17 Phone Checks

1. Install over build 16 without uninstalling; confirm the saved session remains.
2. In Profile > Group, select a shared group. Share a few owned recipes, then use
   search and Select all with an exception. Verify access from a second group member.
3. Retry after a sharing or pagination connection failure. Selections should stay;
   success feedback should clear after five seconds. Switch groups and verify reset.
4. Create/edit a beverage, review an AI/web beverage draft, log 1.5 servings, and
   edit the entry without changing its category. Check totals and exported data.
5. Recheck bounded offline grocery/macros and hybrid pantry after an online refresh.
   These use the newly deployed API capabilities; physical-device UAT is still needed.

### Build 17 Rollback

Retained images: `dinner-swipe-api:before-preview17` and
`dinner-swipe-worker:before-preview17`. Keep the additive database schema and
offline receipts during an application rollback. Do not downgrade after serving
offline-capable clients or restore a whole database over subsequent user writes.

```bash
docker tag dinner-swipe-api:before-preview17 dinner-swipe-dinner-swipe-api
docker tag dinner-swipe-worker:before-preview17 dinner-swipe-dinner-swipe-worker
docker compose --profile production up -d --no-deps --no-build --wait dinner-swipe-api dinner-swipe-worker
```

The worker is currently an idle placeholder. Its old PID 1 ignored SIGTERM during
this release; it was confirmed idle before being stopped. No active worker job
was interrupted. Revisit graceful shutdown before adding real worker jobs.

## Build 15 Update

- Source `85768b0` pushed. [CI 37168022545](https://github.com/Edwarj47/DinnerSwipeApp/actions/runs/37168022545)
  passed frontend, backend, and Docker jobs.
- The expanded weekly meal editor uses a Day selection dropdown with Any day and
  all seven dated days. Choosing a day saves the assignment; canceling or selecting
  the current day makes no change. Failed saves preserve the previous assignment.
- Replace is removed from the weekly editor. Adding, removing, and assigning meals
  and existing drag controls remain available.
- Servings and grocery quantity controls show one plus/minus icon with descriptive
  accessibility labels and 44-pixel touch targets. Controls disable during saves
  and respect the existing serving and quantity limits.
- Local verification: 82 mobile tests, lint, TypeScript, web export, and mocked-API
  browser checks at 320/390/1280 pixels. No customer data was written by these checks.
- Android preview 15 finished October 4 at 01:38 UTC from `85768b0`, EAS build
  `4c8b5f45-b2a7-4bde-8155-6ee14783f718`. The standalone APK does not need Metro.
- Download, ZIP integrity, embedded package/version, production API URL, and new
  feature bundle checks passed. Package `dev.dcss.dinnerswipe`, version code `15`;
  signing certificate matches build 14. Size 79,584,905 bytes; SHA-256:
  `e851434e265ebcc2f00c564a22b10ca873c859b8f60bcf0b7a5a112c0678beaf`.
  The verified download link is shared privately. Physical-phone UAT remains pending.
- This release contains client UI changes. The pending offline API rollout remains
  described in [Offline support](offline-support.md).

### Build 15 Phone Checks

1. Install over build 14; confirm the saved session remains available.
2. Edit a planned meal, open Day selection, choose another day, and reopen the app.
   Confirm the saved day persists. Any day should move the meal to Unscheduled.
3. Cancel the day menu and confirm the assignment stays unchanged. Confirm Replace
   is absent and existing Add meal, Remove, and drag controls still work.
4. Change meal servings and grocery quantity; each button should show one symbol,
   save the change, and disable at the applicable minimum or maximum.

## Build 14 Update

- Source `bbe2e76` pushed. [CI 37115832445](https://github.com/Edwarj47/DinnerSwipeApp/actions/runs/37115832445)
  passed backend, frontend (including cold-cache tests), and Docker jobs.
- Connection failures preserve sign-in credentials. Downloaded data, durable grocery
  check-offs/quantity changes and personal macro edits add bounded offline support.
- Queued changes keep stable operation IDs, survive restarts, and stop for review if
  another device changed the same item. Recipe macro logs preserve reviewed totals.
- Local verification: 72 mobile tests, 109 API tests, lint/types, Ruff/mypy and web export.
  A separate disposable PostgreSQL test passed concurrent retries and migration rollback.
  Mocked-API browser checks passed at 320/390/1280 pixels.
- Android preview 14 finished October 3 at 10:27 UTC from `bbe2e76`, EAS build
  `3694f29e-1eae-408f-bec5-a58979a19056`. The standalone APK does not need Metro.
- Download, ZIP integrity, embedded package/version, production API URL and offline
  feature bundle checks passed. Package `dev.dcss.dinnerswipe`, version code `14`;
  signing certificate matches build 13. Size 79,584,098 bytes; SHA-256:
  `b741bcfa2a6a05c39aa034b1d906c1cf2f125b505930c17991656ef540c55aa1`.
  The verified download link is shared privately. Physical-phone UAT remains pending.
- API/database and web deployment are **not part of this push/build request**.
  The existing API does not advertise offline support. A new APK alone does not
  activate cached offline access or queued writes. API migration `e19a71c042bf`
  and deployment need separate approval, backup and rollback preparation.
- Full behavior, storage limits, rollout order and phone acceptance steps are in
  [Offline support](offline-support.md). No fully offline PWA shell is included.

### Build 14 Phone Checks

1. Install over build 13 without uninstalling; confirm the saved session remains available.
2. After the API update, sign in online and allow downloads to finish. Open the
   groceries and Macro Tracker Day screens before enabling airplane mode.
3. Restart the app, check a grocery item and add a macro entry. Restart again;
   both edits and the pending-sync count must remain. Reconnect and verify no duplicates.
4. Exercise a same-item conflict using a second device. Review the saved local
   values before discarding or re-entering them against refreshed server data.
5. Test biometric unlock, offline access expiry, sign-out/account isolation, and
   reconnect. First login, billing, AI and shared-plan changes remain online-only.

## Build 13 Update

- AI drafts extract printed calories, protein, carbs, fat and fiber into editable
  nutrition fields, preserving serving basis, missing values and explicit zeros.
- Packaged-food labels no longer need invented cooking instructions or time estimates.
- Saved recipe owners can Add photo / Change photo from details using camera or library.
  Failed uploads preserve the previous image. Portrait photos are shown without cropping.
- AI processing disclosure moves from the form to Privacy and Terms. The short review
  reminder remains. Existing model fallback, quotas and user acceptance history are unchanged.
- API/web are live from `394ceab`; all GitHub CI jobs passed. Local checks passed:
  104 API tests, 54 mobile tests, lint, types and web export. Deployed browser checks
  passed at 320/390/1280 pixels with mocked accounts, without customer-data writes.
- Backup restore, rollback images, live checks and release evidence are in
  [AI label and recipe photo UAT](ai-labels-recipe-photos-uat.md#deployment-record).
- Android preview 13 finished October 1 at 19:37 UTC from `394ceab`, EAS build
  `78059c0e-b313-4ded-9f30-417a60714502`. The standalone APK does not require Metro.
- Download, ZIP integrity, embedded package/version, production API URL and feature bundle
  checks passed. Package `dev.dcss.dinnerswipe`, version code `13`; signing certificate
  matches build 12. Size 79,540,743 bytes; SHA-256:
  `738badb7a820ad44a87a5b40757e7f8d5835fe076afdaa26ec407ac0f83fba12`.
  The verified link is shared privately. Physical-phone installation/UAT is still pending.

### Build 13 Phone Checks

1. Install over build 12 without uninstalling; confirm the saved session remains available.
2. Create an AI draft from a clear nutrition label. Check values and serving basis in review,
   adjust as needed, save, and log a fractional portion in Macro Tracker.
3. Open an existing owned recipe, choose Add photo / Change photo, and try camera and library.
   Test permission denial, cancellation, a failed upload and retry, then reopen the recipe.
4. Confirm full portrait photos remain visible and Photo updated disappears after a few seconds.
5. Check Privacy and Terms include AI processing information and the AI form has no repeated
   provider disclosure paragraph. Physical-phone installation and camera UAT remain pending.

## Build 12 Update

- Coupon code replaces Testing access code in the paywall and Account. Access grants
  and Stripe invoice discounts use the same entry point but have different billing effects.
- Manual recipes and AI draft review support editable nutrition per serving or whole recipe.
  Premium users can log a saved recipe with fractional portions and edit the resulting totals.
- Library, Hidden Recipes, and Archived Recipes expand independently, with Unhide/Restore.
- Live billing handles confirmed payments, portal upgrades, failed invoices, duplicate and
  out-of-order events, card-required trials, and retry-safe checkout. Returning subscribers
  do not receive another trial. Existing development access is unchanged.
- Source `f06a087` is pushed. [CI 36799063096](https://github.com/Edwarj47/DinnerSwipeApp/actions/runs/36799063096)
  passed backend, frontend, and Docker jobs. Local checks: 97 API tests, 49 mobile tests,
  Ruff, mypy, ESLint, TypeScript, and web export.
- Production web passed mocked-account browser tests at 320/390/1280 pixels for nutrition,
  portion logging, coupons, and restoring recipes. No customer data was written.
- API/web are deployed. Live Stripe Checkout creation was checked for both prices and the
  Basic card requirement, then sessions were expired without entering a card or charging.
  Signature rejection, unpaid-event rejection, protected routes, and account reads passed.
- Backup: `backups/releases/20261001T005549Z_preview12`, private files, full isolated restore
  verified. No migration. Current API image `2456868e5769`, web `3c2180921971`; rollback tags
  `dinner-swipe-api:before-preview12` and `dinner-swipe-web:before-preview12`. Environment,
  webhook, and portal configuration snapshots are in the same private release directory.
- Only API/web containers changed. Worker, database, and all unrelated container identities,
  image IDs, and start times were compared and are unchanged.
- Android preview 12 completed October 1 at 01:10 UTC, EAS build
  `81f33dee-a6ac-4d35-b50b-d6bd3be4f29d`, source `f06a087`. This standalone APK
  embeds JavaScript and does not require Metro. The verified link is shared privately.
- Download, ZIP integrity, embedded package/version, production API URL, and new feature
  bundle checks passed. Package `dev.dcss.dinnerswipe`, version code `12`, signing certificate
  matches build 11. Size 79,539,197 bytes; SHA-256:
  `46b98ef87dd4a7f95e717ec24848276bf3bff66ed110162a07d56404c74040cd`.
- Physical-phone installation/UAT remains to be confirmed by the tester. No real card was
  charged during this release. A completed payment and renewal exercise remains outstanding.

### Build 12 Phone Checks

1. Install over build 11; confirm the saved account/session remains available.
2. Add nutrition to a recipe, switch between per-serving and whole-recipe entry, and save.
3. Log 1.5 servings from the recipe, adjust a nutrient manually, and verify daily totals/export.
4. Hide and archive separate recipes, expand their sections, search, and restore each.
5. Confirm Coupon code appears at signup and in Account. Development access still bypasses
   billing. Normal checkout uses live payments; do not enter a real card just to test a button.
6. Complete a separately authorized payment/UAT exercise before public rollout. See
   [production billing readiness](production-billing-readiness.md) for remaining store,
   payment lifecycle, tax, and support-policy requirements.

## Build 11 Update

- Interactive onboarding visits the actual app screens, with section selection,
  live controls, per-section skipping, and a full-tour exit. Replay uses the
  same flow. See [guided tour checks](guided-tour-uat.md).
- Subscription and testing access move to Profile > Account. Account Settings
  groups Planning and Device security. Macro Tracker is Premium-only.
- Manual recipes remove sample shortcuts and add camera capture. AI replaces
  the CSV tab, with description/photo input, editable review, and saved drafts.
  Basic receives three successful drafts per UTC calendar month; discarding
  does not refund a use. Premium has no monthly draft count limit.
- AI requests fall back from an unavailable model to the configured backup,
  default `gpt-4.1-mini`. The fallback also covers web-import normalization.
  Live synthetic text and image requests both recovered from a deliberately
  unavailable primary model. See [AI contract and limits](profile-ai-recipes-uat.md).
- Recycled web drafts enforce the 15-day restore boundary, including legacy
  timestamps; expired items are hidden and cannot be restored. Expired database
  records are not purged by this release.
- Source `1bf8961` is pushed; backend, frontend, and Docker CI jobs passed.
  Local checks passed: 75 API tests, 46 mobile tests, lint, types, and web export.
- Android build 11 finished September 30 at 13:28 UTC from source `1bf8961`.
  This standalone preview embeds JavaScript and does not require Metro.
- Download, ZIP integrity, embedded package/version, production API URL, and
  new-feature bundle checks passed. Package is `dev.dcss.dinnerswipe`, version
  code `11`; the signing certificate matches build 10. The 79,530,761-byte APK
  download link is shared privately. SHA-256:
  `aa4251b389f61643b07d01b3bf8b02c55b7af31f9ad527e5ffdcb4f143879ee5`.
- Physical-device installation and camera permission UAT remain required.
- API and web deployed September 30 at 17:58 UTC with owner approval. AI recipe
  generation is enabled and the server-side recycle-bin fix is live. APK 11
  already includes the matching client; no further phone build is needed.
- The fresh backup passed a full restore into an isolated temporary database.
  Public health, protected-route rejection, a live synthetic AI request, and
  read-only usage/expiry checks passed. The expired draft is hidden and restore
  returns 410. Production web passed browser checks at 320/390/1280px with
  mocked accounts, without writing customer data.
- Only API and web containers changed. The worker, database container, schema,
  and unrelated services were unchanged. Recovery details are in
  [Profile and AI Recipe UAT](profile-ai-recipes-uat.md#deployment-record).

### Build 11 Phone Checks

1. Install over the existing Dinner Swipe app without uninstalling.
2. Replay the tour, try real controls, skip a section, and exit the full tour.
   Completed/dismissed tours must not appear on every launch.
3. Check Subscription at the top of Account and Planning/Device security under
   Account Settings. Basic should see Macro Tracker locked; Premium can open it.
4. Add a manual recipe photo: grant, deny, and cancel camera/library permission.
   Verify rotation and large-photo errors on a real device.
5. Generate from text and a photo, edit the draft,
   save it, and discard a second draft. Basic's remaining allowance must reflect
   successful generations, including discarded drafts; failed calls are free.
6. Check recycled drafts near the 15-day boundary. Long names and restore dates
   must remain readable; expired drafts must not be restorable.

## Build 10 Update

- Macro meal choices wrap into complete buttons on narrow phones; Breakfast
  no longer splits. Day navigation includes a popup month calendar and keeps
  direct ISO date input. Invalid/partial dates do not trigger requests.
- Macro success notices expire after 3.5 seconds or a view change. Errors remain
  visible so failures are not confused with a successful save.
- Calendar rows label calories and support date/calorie sorting, all/logged-day
  filtering, 14/30/90/365-day periods, and tapping a date to edit its entries.
- Trends and exports share a 7/30/90/365-day or all-time range. Period totals
  and daily targets are separate; averages are per logged day.
- The top summary is explicitly Last 7 days, including consumed manual entries
  and confirmed meals. The UAT code box is unchanged pending product discussion.
- New API parameters enable exact historical day lookups and complete all-time
  analytics/exports. Premium authorization and user scoping remain enforced.
  All-time daily totals omit empty dates to avoid allocating years of empty rows;
  `includes_empty_days` documents that behavior. No database migration is needed.
- API deployed September 29 with owner approval. Public health, live route
  parameters, anonymous-export rejection, and read-only account-scoped
  analytics/export checks passed. Only the API container was recreated;
  production web, worker, database schema, and unrelated services are unchanged.
- Android build 10 finished September 29 at 01:22 UTC from source `c8b3e35`.
  Source is pushed; backend, frontend, and Docker CI jobs passed. The standalone
  preview embeds JavaScript and does not require Metro. Its download link was
  shared privately; build 9 does not contain these new macro screens.
- Download/ZIP/config/bundle checks passed. Package is `dev.dcss.dinnerswipe`,
  version code `10`, and the signing certificate matches build 9. The APK is
  79,523,823 bytes. SHA-256:
  `ad6752911f03fc5682c64a1cd35fddaacc6201a41f56eca9bed020fa8424c709`.
- Local checks: 54 API tests, 36 mobile tests (including cold-cache run), lint,
  TypeScript, and mypy pass. Real-phone calendar/biometric UAT is still required.

### Build 10 Phone Checks

1. Install over build 9 without uninstalling; confirm the saved session remains.
2. In Premium macros, check that Breakfast stays intact and success notices
   disappear after adding or editing an entry. Failed saves must remain visible.
3. Open the date calendar, move between months, and select a historical date.
   Confirm its entries load; direct date entry and Today must still work.
4. Check the Cal column, logged-day filter, calorie/date sorting, and date taps.
5. Select each Trends period, including all time. Export and check its date
   range and totals match the selected view. The top summary remains seven days.

### API Deployment Recovery

- Fresh Dinner Swipe-only custom-format backup:
  `backups/postgres/dinner_swipe_20260929T001436Z_macro_ranges.dump` (mode 0600).
  Archive listing validated; a full restore was not needed or performed.
- Active image: `dinner-swipe-api:macro-ranges`, SHA prefix `947d1e333d33`.
- Retained rollback image: `dinner-swipe-api:before-macro-ranges-20260929`.
  No database restore or migration is needed for an API rollback. From the
  repository root, retag the retained image and recreate only the API:

```bash
docker tag dinner-swipe-api:before-macro-ranges-20260929 dinner-swipe-dinner-swipe-api
docker compose --profile production up -d --no-deps --no-build dinner-swipe-api
```

## Build 9 Update

- Removes the weekly meal target input, goal bar, and Discover's target-based
  stop. The existing API field remains for older clients; it is not a meal cap.
- Keeps default servings, optional maximum cook time, grocery store, allergens,
  and dislikes under Food and shopping.
- Profile > Account > Planning has a persistent "Confirm day and week resets"
  switch, enabled by default. It uses the existing profile notification JSON;
  neither a database migration nor an API deployment is needed. Failed/missing
  preference reads retain confirmation. Other profile settings are preserved.
- Biometrics default to five minutes away before locking. Profile > Account >
  Device security offers Immediately, 1 min, 5 min, or 15 min. The choice stays
  on this device; a fresh process launch with a saved session still locks.
  Canceled prompts and secure-storage failures do not grant access.
- Android version code is `9`; standalone preview still embeds JavaScript.
- 31 mobile tests pass with a cold transform cache, alongside lint and
  TypeScript. Browser checks at 1280x900, 390x844, and 320x640 cover persisted
  confirmation on/off, day/week scopes, cancellation, profile preservation,
  and Discover beyond the legacy target. Native biometric behavior is tested
  with mocked device events; physical-phone testing is still required.
- Source `fc2d82a` is pushed; all three GitHub CI jobs passed. EAS finished
  September 28 at 20:23 UTC. Download/ZIP/config/bundle checks passed and the
  signing certificate matches build 8. The 79,300,350-byte APK was shared
  privately. SHA-256: `e6ac6487dfb2ebf590ac4b16cd0e998c4395c496bc59b95642690ab6c4cadfbf`.
  Production web is unchanged.

### Build 9 Phone Checks

1. Install over build 8 without uninstalling; confirm the session is retained.
2. Enable Biometrics. Open a grocery link and return within five minutes: no
   extra prompt. Leave for five minutes or more: unlock is required.
3. Force-close and reopen: unlock is required even within those five minutes.
4. Select Immediately, 1 min, or 15 min and verify the chosen timeout. Cancel
   a prompt and check that private screens remain locked; retry should work.
5. Turn reset confirmation off, restart, and reset one day. Only that day is
   cleared. Whole-week Reset clears the week. Turn confirmation back on and
   confirm Cancel makes no changes.
6. Plan more than five meals; Discover must continue offering remaining meals.

## Build 8 Update

- Includes the weekly picks/all recipes picker, weekly Discover rollover, and
  exact-slot Plan undo. Swipe counts remain stored when a plan is undone/reset.
- Package remains `dev.dcss.dinnerswipe`, version `0.1.0`, Android version code
  `8`. The standalone preview embeds JavaScript and does not require Metro.
- Backend and web are already deployed; live database revision is
  `d8126c4ab391`. The Add meal endpoint required by builds 7 and 8 is live.
- Source commit `5ecb1d1` is pushed. EAS completed the APK on September 28 at
  17:23 UTC; its install link is shared privately, not committed to GitHub.
- Download and ZIP checks passed: 79,298,237 bytes. Embedded package/version
  match the release configuration; the JavaScript bundle contains the live API
  URL and the weekly-picks UI. Signing certificate matches build 7.
- SHA-256: `b56fd08d5b769b5592deb1708ccacf342108e3fc081b26ddddc8478adbd3641a`.
- Install over build 7. Artifact verification does not replace physical-phone
  installation and feature UAT.

### Frontend CI Timeout Correction

The initial GitHub run passed lint, TypeScript, backend, and Docker checks but
timed out in the native paywall test at Jest's default five-second deadline.
Running locally with `--no-cache` reproduced it; the warm-cache run had passed.
The first native render includes lazy React Native module transformations.

Only that test now has a 20-second startup budget. Its individual async assertion
deadlines remain unchanged. CI explicitly disables the transform cache, and all
16 mobile tests, lint, and TypeScript checks pass in the cold-cache check. This
test/workflow correction changes no bundled application code, so build 8 remains
the correct APK; no additional cloud build is needed.

## Build 7 Update

- Source commit: `415d210`; package `dev.dcss.dinnerswipe`, version `0.1.0`,
  Android version code `7`, standalone `preview` release APK.
- EAS finished successfully on 2026-09-28 at 00:51 UTC. The install link is shared
  privately, not committed to the repository.
- Downloaded APK: 79,296,783 bytes. ZIP integrity passed; embedded configuration
  matches the package and version code. The 2,502,676-byte JavaScript bundle
  contains the intended `https://dinner.dcss.dev` API URL.
- Signing certificate matches build 6 exactly; install over the existing app.
- Follow-up Android tooling checks passed for both APKs: `apksigner verify`
  validates v1/v2 signatures; `aapt` confirms the same package, minimum SDK 23,
  target SDK 34, and ARM/ARM64/x86/x86_64 architectures. Only the version code
  rises from 6 to 7. The owner subsequently confirmed build 7 installed; Samsung
  Auto Blocker had prevented the download from completing.
- SHA-256: `3ec058c27ed0cf959a462d403ff8e57ab92cce57753b6e183339f1fb4ff3679e`.
- The day-specific add and group endpoints were subsequently deployed on
  September 28 with the weekly-picks update.
- 48 API tests and 14 mobile tests passed; lint/types and desktop/phone-size
  browser checks passed. Physical-device testing remains pending.

### CI Dependency Correction

GitHub's backend job installed SQLAlchemy 2.1.1 while the original local checks
used 2.0.52. SQLAlchemy 2.1 changes `Select`/`Row` generic types; the app currently
uses 2.0 annotations. The backend dependency is now constrained below 2.1, and CI
reports resolved versions and runs `pip check`. A fresh Python 3.12 environment
passed lint, non-incremental mypy and all 48 API tests with the corrected range.
This backend-only correction does not change the APK. Rebuild the prepared API
image from the corrected source before production deployment.

## Previous Build 6

### Build Record

- Profile: `preview`, internal distribution, release APK, development client disabled.
- App: `dev.dcss.dinnerswipe`, version `0.1.0`, Android version code `6`.
- Source commit: `5672554`.
- EAS build ID and install link: shared privately with the tester, not committed.
- Build status: finished successfully on 2026-09-26 at 19:04 UTC.
- Backend: live `https://dinner.dcss.dev`. This is not an isolated staging environment.
- Physical-device checks below remain pending until a tester performs them.

### Artifact Verification

- EAS completed `:app:assembleRelease`, uploaded the APK, and the build command exited 0.
- APK downloaded successfully (HTTP 200), size 79,271,431 bytes; ZIP integrity passed.
- Embedded `assets/app.config` matches package, version, and build number above.
- `assets/index.android.bundle` is present (2,455,072 bytes) and contains the intended HTTPS API URL.
- ARM64 Hermes runtime and the signing certificate are present. EAS selected the same signing-key configuration as the previous Android development build.
- Live API health returned `ok` after the build; no production restart or database change occurred.
- APK SHA-256: `2dcec651b8817c643f554d0101a53f0dba281a9e5e29205489d322589fc48d96`.

These are build/package checks, not proof of successful installation or runtime
behavior on a physical phone. No Android emulator or attached device was used.

Expo Doctor reported 15/16 checks passing, with a warning about custom Metro
`watchFolders` and `disableHierarchicalLookup`. This SDK 51 monorepo still uses
manual resolver configuration. Record and revisit it during the SDK upgrade;
do not describe the diagnostic as entirely clean or remove resolver settings
without retesting native/web bundles. Build-time Metro is distinct from the
running development server that a development client needs. See
[Expo's pre-SDK-52 monorepo guidance](https://docs.expo.dev/guides/monorepos/).

Use the private install link shared with the tester after the build succeeds.
Do not distribute an in-progress build or commit private testing access codes.

## Installation

1. Open the completed EAS install link on Android and download the APK.
2. Allow installation from the browser if Android requests it. This is a direct
   test installation, not a Google Play release.
3. Install as an update to Dinner Swipe. If installation fails, report the
   Android message rather than uninstalling and losing local session data.
4. Open the installed app, not the browser shortcut or an old download. It
   should open Dinner Swipe, not a development-server selection screen.

## First Test Pass

| Area | Expected result |
| --- | --- |
| Cold launch | Force-close and reopen with no Metro server; the app opens normally. |
| Entry | A new installation offers login/account creation. An existing saved session may resume. |
| Access | A signed-in account selects a plan or uses a private test grant before protected tabs open. |
| Account switch | Switching accounts clears the previous account's recipes, plan, and access state. |
| Biometrics | Enabling prompts as expected; resume, cancellation, and retry do not create a login loop. |
| Email verification | Open the verification email in the browser and return; the app remains usable without Metro. |
| Recipe creation | Add one manual recipe and one link import, review, then save. |
| Discover | Swipe in each direction; cards leave the screen and the next card responds. |
| Weekly plan | Drag meals to different days; tap-to-select also works; assignments persist after reopen. |
| Reset | Cancel leaves the plan unchanged; confirmed day reset changes only that day; week reset restores defaults. |
| Grocery | Planned ingredients appear; manual grocery items survive a plan reset. |
| Premium macros | Add/edit manual and meal-linked entries; change day/week and check totals and export. |
| Network interruption | Disable connectivity briefly, restore it, and retry; no Metro connection is required. |

Use private UAT access for Basic/Premium testing. Checkout still uses live Stripe:
do not enter payment details to simulate a purchase. Test recipes and edits are
real writes to the live account. Destructive account tests belong in staging.

For a failure, record build number, phone model, Android version, screen/action,
expected result, actual result, and a screenshot. Do not include passwords,
access codes, tokens, or payment details.

## Release Boundary

Passing these checks does not establish store readiness. The owner confirmed
that neither Google Play nor Apple developer enrollment is complete. No paid
membership or public store submission is part of this preview build.

Developer enrollment will require the owner's identity/business verification
and approval of membership fees. Use the official
[Google Play enrollment instructions](https://support.google.com/googleplay/android-developer/answer/6112435?hl=en)
and [Apple enrollment requirements](https://developer.apple.com/programs/enroll/).

Next engineering work is isolated staging, SDK/toolchain upgrades, compatible
EAS Update channels, and store billing/deletion/privacy readiness. See the
[release roadmap](store-release-and-cicd-roadmap.md).
