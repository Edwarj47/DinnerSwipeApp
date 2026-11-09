# Personal Appearance and DS Icons

## Behavior

User settings contains an Appearance section for both Basic and Premium accounts. Seven labeled swatches select black (default), red, blue, green, teal, purple or orange. Selection immediately previews the theme and saves automatically; Reset to default selects black. Existing explicit choices, including red, are retained; no account-data migration or mass preference rewrite is needed.

Accent controls, navigation, selection tints, switches, chart accents, in-app DS logos and DS placeholder artwork follow the setting. Existing backgrounds, layouts, semantic error/success colors and uploaded photos are unchanged. The native launch screen and primary launcher icon use black branding in new builds; the native launch screen is not personalized per account. Notification icons and store artwork are separate assets.

## Preference Contract

- `GET /api/v1/profile` returns `appearance_preferences: { "accent": "black" }` when no valid preference exists, or the saved allowed preset.
- `PATCH /api/v1/profile/appearance` accepts exactly `{ "accent": "black|red|blue|green|teal|purple|orange" }`; authentication is required and only the current account is updated. This notation lists allowed values, not a literal pipe-separated value.
- The dedicated update merges the existing profile JSON under a row lock. General profile PUTs preserve the server-owned appearance key, including requests from older APKs. No schema migration is required.
- Account-scoped device caching restores the saved choice. A presentation-only bootstrap reads the saved session's cached accent before mounting the biometric gate; it does not set the offline owner, refresh credentials, fetch a profile, unlock content or switch the launcher icon. A neutral loading frame avoids rendering a guessed account palette while the cache is read. The authenticated owner must match before this startup color is retained; logout and account switches reset it. The downloaded profile cache is also updated after saves. Offline changes are not queued; cached colors remain available offline.
- Failed saves restore the prior color. A failed native icon change does not undo a successful preference save; it has a separate retry. Logout resets the visible theme and native icon to black. Stale responses cannot apply another account's preference.

The palette is defined in `apps/mobile/services/appearancePresets.json`. The theme hooks subscribe to a pure presentation store; networking and native effects are coordinated separately. Existing form components are not remounted for color changes.

## Native Icons

The local Expo module in `apps/mobile/modules/app-icons` is discovered by the existing SDK 58 autolinker. The configuration plugin registers icon resources during prebuild. No new runtime permissions or SDK upgrade is required for this change.

- Android registers seven launcher aliases targeting the existing MainActivity. Black is the only default-enabled appearance. Its component deliberately retains the old `DSIconRed` name; the selectable red appearance uses `DSIconRedSelected`. Reusing the old default component prevents retained installed alias overrides from adding a second enabled default on upgrade. Other color alias names are preserved. Only aliases are toggled; the real activity and its deep-link filters remain enabled. API 33+ uses an atomic component update. Older Android versions enable the desired alias before disabling the others. Launcher refresh timing, pinned-icon behavior and system themed icons remain device-controlled.
- iPhone uses alternate asset catalogs and Xcode alternate-icon build settings, then UIKit's public alternate-icon API while the app is active. Black uses the primary icon; red is now an alternate. Alternate images, including the retained red design, are flattened to opaque RGB for native catalogs. The OS owns the icon-change notice; no private API or notice suppression is used.
- A supported native build applies the saved preset after a successful save and reconciles it on foreground/profile refresh. An app that is closed cannot immediately receive a different account preference from the server.
- Web changes the on-screen artwork and favicon. Existing browser-installed home-screen shortcuts are not guaranteed to recolor automatically. This feature does not introduce a PWA installer or personalized manifest.

The original red artwork is retained byte-for-byte as the red preset. Other variants are rasterized from the existing editable `brand-logo.svg`; the design and white regions are preserved. Generated alternate PNGs are opaque RGB. Regenerate all variants with `PLAYWRIGHT_MODULE=/path/to/playwright node infrastructure/scripts/generate-accent-icons.cjs`, or append a preset such as `black` to build only that variant. This is a deterministic SVG asset build, not an AI-generated replacement logo.

## Verification and Release

Run mobile lint/typecheck/Jest, `npm run test:icons -w apps/mobile`, backend Ruff/mypy/pytest and the web export. CI includes the icon configuration/resource tests. Native prebuild should be checked in an isolated copy, not against production files or account data.

Before releasing native builds, verify Samsung/Pixel launcher behavior, existing pinned shortcuts, deep links, app upgrades, default reset and foreground reconciliation. Verify iPhone alternate icons, the system notice, failure handling and relaunch behavior on a signed native build. Do not claim prebuild/configuration checks are native device tests.

Specifically test APK 28 to 29 with red and blue selected, pinned shortcuts,
biometric lock and deep links before/after first launch. Tests simulate prior
component overrides for all six old colors and assert one enabled entry. Signed
device/OEM behavior is still unverified. The dark authentication overlay requests
light status-bar icons and releases that override after sign-in.

Deploy the additive backend before the web client. Newly installed Android/iPhone builds are required for launcher icon switching. Signing, paid enrollment, EAS builds, billing changes and store submission require separate authorization; they are not part of the source implementation.

The black default changes native palette/module/assets and therefore targets
runtime `0.2.1`, Android versionCode 29. Do not publish this source as an OTA to
runtime `0.2.0` / APK 28. Keep existing `0.2.0` receipts and update history intact;
the new runtime needs its own verified completed build receipt before OTA use.
Old clients keep their existing supported colors and may display their red
fallback for the new black default until upgraded. This source work alone does
not create an APK, change the live backend, or publish an update.

### Black Default Verification

November 8, 2026 local checks passed: 731 mobile tests/66 suites; 20 focused
appearance/auth API tests; mobile/API lint and type checks; seven icon tests;
runtime/release guards; web export; isolated Android/iOS prebuild and generated
manifest/resource/catalog checks. Browser checks covered Basic and Premium at
1440x900, 390x844 and 320x800, including black defaults, retained red/green,
reset, reload, artwork/favicon pixels, contrast and no horizontal overflow.
A real isolated local API/browser flow also verified sign-in, black defaults,
saved red, reset to black and reload. External providers were disabled. No
production account preferences were rewritten. Native compilation and signed
device acceptance have not been performed, and no APK was built or published.
