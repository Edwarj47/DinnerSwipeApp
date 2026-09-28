# Android Preview UAT

Updated 2026-09-28 for Android preview build 7.

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
  rises from 6 to 7. A reported phone installation failure still needs the exact
  Android error; artifact checks are not a physical-device installation test.
- SHA-256: `3ec058c27ed0cf959a462d403ff8e57ab92cce57753b6e183339f1fb4ff3679e`.
- Backend rollout is pending owner approval. The new day-specific add and group
  endpoints are not live yet. Do not treat this artifact as end-to-end deployed.
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
