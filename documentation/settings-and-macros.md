# Settings and Macros navigation

The five signed-in pages have a fixed, circular person button in their header.
It opens settings without changing the current page or selected kitchen.

- User settings: collapsed Account and Meals sections. Account contains
  subscription/coupons, identity, data/legal controls, planning, measurements,
  and device security. Meals retains food and shopping preferences.
- Group settings: existing memberships, default group selection, invitations,
  shared recipes, Discover choices, proposals, and group safety controls.
- Macros: the former Profile navigation slot, now a speedometer icon. Existing
  macro tracking and calculator controls are unchanged. Analytics adds calorie
  and protein charts, logged-day averages, and daily-target comparisons.

Basic users receive a Premium invitation when pressing Macros; the current
page stays selected. Direct links fail closed and cannot mount macro controls.
Subscription verification errors offer retry. Premium users do not see the
invitation. View Premium opens settings; it never initiates a charge itself.

Analytics uses the existing authenticated `/api/v1/macros/analytics` endpoint.
The configurable period is 1-366 days, matching that endpoint's limit, and is
saved as `notification_preferences.macro_analytics_days`. Charts average
calendar days within each displayed period, including empty days; the separate
daily-average statistics use logged days, following the existing API contract.
Pending provider nutrition is flagged, not plotted as a known total.

The `/profile` route is retained for old links, password resets, and the tour.
Legacy requests are handled once so returning to Macros does not reopen the
popup. Guided settings steps open the corresponding section over Discover,
without taking Basic users into Macros, and retain in-place tour controls.

No database migration or provider configuration change is required for this
navigation update. Tests use synthetic accounts and an isolated preview API;
they must not write to production or start Stripe checkout.

## Validation on 2026-10-08

- TypeScript, ESLint, and all 244 mobile tests passed (36 suites).
- Playwright passed at 320x720, 390x844, and 1280x900: fixed headers,
  settings forms, group switching, analytics, persisted periods, and calculator.
- Basic tab/deep-link restrictions and Premium subscription invitation passed.
- Legacy settings links, Replay Tour, Meals, Groups, Planning, and completion
  passed in the browser against an isolated synthetic-account API.
- Expo Android/Hermes bundle export passed. This is not a signed APK build or
  physical-device biometric verification.
- This implementation validation preceded release. Deployment and signed APK
  evidence is tracked in `settings-macros-release-24.md`.
