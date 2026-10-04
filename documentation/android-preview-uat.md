# Android Preview UAT

Updated 2026-10-04 for Android preview build 15.

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
