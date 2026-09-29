# Android Preview UAT

Updated 2026-09-29 for Android preview build 10.

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
