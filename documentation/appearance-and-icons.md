# Personal Appearance and DS Icons

## Behavior

User settings contains an Appearance section for both Basic and Premium accounts. Six labeled swatches select red (default), blue, green, teal, purple or orange. Selection immediately previews the theme and saves automatically; Reset to default selects red.

Accent controls, navigation, selection tints, switches, chart accents, in-app DS logos and DS placeholder artwork follow the setting. Existing backgrounds, layouts, semantic error/success colors and uploaded photos are unchanged. Native launch screens, notification icons and store listing artwork remain the default branding.

## Preference Contract

- `GET /api/v1/profile` returns `appearance_preferences: { "accent": "red" }` (or another allowed preset).
- `PATCH /api/v1/profile/appearance` accepts exactly `{ "accent": "red|blue|green|teal|purple|orange" }`; authentication is required and only the current account is updated. This notation lists allowed values, not a literal pipe-separated value.
- The dedicated update merges the existing profile JSON under a row lock. General profile PUTs preserve the server-owned appearance key, including requests from older APKs. No schema migration is required.
- Account-scoped device caching restores the saved choice. The downloaded profile cache is also updated after saves. Offline changes are not queued; cached colors remain available offline.
- Failed saves restore the prior color. A failed native icon change does not undo a successful preference save; it has a separate retry. Logout resets the visible theme and native icon to red. Stale responses cannot apply another account's preference.

The palette is defined in `apps/mobile/services/appearancePresets.json`. The theme hooks subscribe to a pure presentation store; networking and native effects are coordinated separately. Existing form components are not remounted for color changes.

## Native Icons

The local Expo module in `apps/mobile/modules/app-icons` is discovered by the existing SDK 51 autolinker. The configuration plugin registers icon resources during prebuild. No new runtime permissions or SDK upgrade is required for this integration.

- Android registers six launcher aliases targeting the existing MainActivity. Only aliases are toggled; the real activity and its deep-link filters remain enabled. API 33+ uses an atomic component update. Older Android versions enable the desired alias before disabling the others. Launcher refresh timing, pinned-icon behavior and system themed icons remain device-controlled.
- iPhone uses alternate asset catalogs and Xcode alternate-icon build settings, then UIKit's public alternate-icon API while the app is active. Red uses the primary icon. The OS owns the icon-change notice; no private API or notice suppression is used.
- A supported native build applies the saved preset after a successful save and reconciles it on foreground/profile refresh. An app that is closed cannot immediately receive a different account preference from the server.
- Web changes the on-screen artwork and favicon. Existing browser-installed home-screen shortcuts are not guaranteed to recolor automatically. This feature does not introduce a PWA installer or personalized manifest.

The default red artwork is retained byte-for-byte. Other variants are rasterized from the existing editable `brand-logo.svg`; the design and white regions are preserved. Generated alternate PNGs are opaque RGB. Regenerate with `PLAYWRIGHT_MODULE=/path/to/playwright node infrastructure/scripts/generate-accent-icons.cjs` when changing the canonical palette/artwork. This is a deterministic SVG asset build, not an AI-generated replacement logo.

## Verification and Release

Run mobile lint/typecheck/Jest, `npm run test:icons -w apps/mobile`, backend Ruff/mypy/pytest and the web export. CI includes the icon configuration/resource tests. Native prebuild should be checked in an isolated copy, not against production files or account data.

Before releasing native builds, verify Samsung/Pixel launcher behavior, existing pinned shortcuts, deep links, app upgrades, default reset and foreground reconciliation. Verify iPhone alternate icons, the system notice, failure handling and relaunch behavior on a signed native build. Do not claim prebuild/configuration checks are native device tests.

Deploy the additive backend before the web client. Newly installed Android/iPhone builds are required for launcher icon switching. Signing, paid enrollment, EAS builds, billing changes and store submission require separate authorization; they are not part of the source implementation.
