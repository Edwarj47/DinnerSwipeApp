# November Android Build Readiness

Reviewed November 1, 2026 against source bb26317 plus local recipe component-heading changes. No EAS build, provider/billing change, SDK upgrade, GitHub push or web/API deployment was performed by this review.

## Before Using Another Cloud Build

- Expo remains SDK 51 / React Native 0.74.5. Review and incrementally upgrade the SDK and compatible dependencies before a broadly distributed release. Do not run a force audit fix across native dependencies. Expo recommends one SDK version at a time: https://docs.expo.dev/workflow/upgrading-expo-sdk-walkthrough/.
- Native meal voice remains unimplemented: useMealVoice.ts returns supported=false, while useMealVoice.web.ts implements recording. Typed meal assistance works on native. To include recording, implement a compatible native recorder with microphone consent, cancellation/background cleanup, automatic transcription after stopping and device tests; see https://docs.expo.dev/versions/latest/sdk/audio/.
- Account accent and alternate-icon native code/configuration are included. Icon configuration/resource tests pass, but launcher switching, an upgrade over APK 27, existing pinned shortcuts, deep links and app-state reconciliation still require physical-device verification. Do not replace the signing key or package ID.
- app.json still has Android versionCode 27. Increase it to at least 28 before the next preview APK (after confirming the highest completed EAS build). The preview profile produces a standalone APK; no Metro server is needed.
- EAS Update remains optional and unconfigured. A properly configured compatible-runtime update channel can reduce future JavaScript-only rebuilds, but SDK/native-module changes still require a new binary. This is not a paid-plan upgrade: https://docs.expo.dev/eas-update/getting-started/.

## Dependency Review

The read-only npm audit --omit=dev report flags 77 vulnerable package nodes: 2 critical, 30 high, 42 moderate and 3 low. These counts include inherited build tooling and are not 77 confirmed exploitable app attack paths. The critical package nodes include transitive tar and shell-quote. Review reachability and compatible fixes during the SDK upgrade; no dependency version was changed by this task. Private evidence: /tmp/dinner-apk-readiness-20261101/npm-audit.json.

## Recipe Formatting

The owner account's recipes were reviewed under a private, verified database backup. Logged/log-derived recipes and archived entries were excluded. Quantities, nutrition, calculator references, photos, portions, meal categories and other users' records were preserved. Ingredient sections now have small, theme-consistent headings in RecipeDetailSheet; existing ingredient checkboxes and step numbering remain unchanged. Records without section values retain their prior layout.

Database formatting changes are saved live. The component-heading source changes remain local until a separately authorized push/deployment/build. Private change and exclusion ledger: backups/recipe-formatting-20261101T154300Z/report.md.

## Verification

Mobile lint/typecheck, all 648 mobile tests in 59 suites, targeted recipe tests (17), native icon tests (5), Android JavaScript/Hermes export and web export passed. Browser checks passed at 1440x900, 390x844 and 320x800 using synthetic authenticated APIs and copied recipe content, with no production-account writes. Four recipes at each viewport covered component headings, long labels, checkbox toggles and nonblank/no-horizontal-overflow screenshots. Full mobile regression results are recorded separately under /tmp/dinner-apk-readiness-20261101.

JavaScript exports and prebuild/resource tests do not prove a completed signed APK or native device behavior. No November quota/account state was independently changed or assumed as proof of a build.
