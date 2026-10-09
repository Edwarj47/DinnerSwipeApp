# Macro Entry Actions And Nutrition Refresh

## Changes

- Add (Update while editing), Clear, and Calculator occupy three equal-width action slots with 44px minimum touch targets. Save as recipe spans the next row. Manual-entry Delete remains available below it while editing.
- Incomplete nutrition uses a neutral, explicit food-nutrition notice with an accessible refresh control. It stays visible until the API returns complete values; it is not dismissed by a timer. Refresh is disabled during a request or while offline.
- Accepting nutrition consent invalidates cached macro views so values previously unavailable because consent was missing can be resolved. It does not repeat the consent prompt or change retention rules.

## Diagnosis

The former "Some database nutrition is pending" message is driven by `nutrition_unavailable_count`, not a PostgreSQL connection error. API hydration sets this flag when a saved FatSecret reference cannot be resolved, including the eight-second lookup deadline or provider errors. The client also clears temporary values after 15 minutes and strips them from persistent offline snapshots, then marks those totals incomplete until refreshed.

A read-only production check on 2026-10-09 found successful recorded provider calls in the preceding 24 hours and no active provider pause. Those records cannot establish which condition triggered the earlier screenshot; authorization failures, lookup deadlines, and offline fallback are not recorded as provider calls. No production rows, migrations, credentials, API budgets, or cache lifetimes were changed.

## Verification

- Mobile regression tests cover incomplete-to-complete refresh, offline/ongoing-request refresh guards, consent cache invalidation, existing saves, and manual-entry deletion.
- Browser checks exercise 320px, 390px, and 1280px widths, equal action geometry, label/icon containment, full-width recipe save, calculator opening, edit/delete availability, and warning removal after a complete response.
- All 40 mobile suites / 268 tests, lint, and type checking passed before release preparation. All three browser viewports passed.

## Release 27

Android uses version code 27 with the existing package and signing identity. The release includes only mobile/web changes; no API rebuild, database migration, credential change, or provider request is needed for deployment.

Before replacing only the Dinner Swipe web container, save its image and static assets, a verified database dump, and a selected container inventory in the ignored private release backup directory. Roll back by restoring the saved web image and recreating only `dinner-swipe-web`; do not restore the database over newer user activity. Verify GitHub CI, the live static bundle and public health endpoint, and the APK's package, version, source, signing identity, and integrity. Physical-device testing remains separate.

## Local APK Distribution

Expo rejected the cloud build because the monthly Android allowance was exhausted. No billing or credentials were changed. The alternative uses the [supported EAS local build](https://docs.expo.dev/build-reference/local-builds/) with the existing preview profile and managed signing credentials, inside a non-root isolated container capped at 1.5 CPUs and 3328 MiB. The first attempt hit Java's 1024 MiB heap limit; the retry uses a 2048 MiB heap with one Gradle worker and no dependency or ABI changes. Its Android SDK/NDK come from Google's repository; dependencies remain pinned by the existing npm lockfile. Build work and credentials stay in a private, ignored release directory, not the public download directory.

Only verified APKs and their checksum files belong in `backups/android-public/`. Nginx mounts that specific directory read-only at `/downloads/`; it does not expose the rest of `backups/`. Only `dinner-swipe-preview-N.apk` and `.apk.sha256` filenames are served. Directory listing is disabled, other or missing download paths return 404 instead of the SPA, and existing response security headers are inherited. Preserve versioned filenames instead of overwriting prior releases. This mount keeps downloads available through later web image replacements.

The published APK must match the source commit recorded when the local build began. Later distribution-only commits may differ, provided `apps/mobile`, `packages`, and the npm lockfile are unchanged. Check the actual Android manifest, all existing ABIs/permissions, cryptographic signing verification, the previous signing certificate, and ZIP integrity before publication. A successful local build is not an Expo cloud build or a store submission.
