# Scrolling, Photos, Biometrics, and Custom Summary UAT

## Scope

- This Week has one bounded scroll owner, with mouse-wheel scrolling and the
  existing drag, auto-scroll, day assignment, and same-day ordering behaviors.
  Other main pages retain their screen scroll area; Discover is scrollable on web.
- Saved recipes without a photo, including imports, use the bundled Dinner Swipe
  logo as the image source. Failed photo URLs also fall back to that logo. No recipe
  data is changed and the placeholder does not claim to be a real food photo.
- Discover/Plan It additions are unscheduled even when reusing an empty dated slot
  left by a day reset. Existing scheduled meals are not moved automatically.
- The macro summary accepts a whole number from 1 to 3,650 days, remembers the
  selection in the user's profile, and queries the summary endpoint through today
  in the device's local calendar. Editing the field does not send queries until
  Apply. Invalid values do not query or overwrite preferences.
- Calendar/Trends retain their existing ranges and all-time export; the wider
  summary range does not expand their bounded daily-series payloads.
- Biometric prompts wait for active foreground state. Cancellation stays locked
  for a manual retry instead of looping on a delayed foreground event. Successful
  native prompt transitions do not immediately re-lock the app. Password fallback
  clears the saved login but preserves the biometric preference and timeout.

React Native requires bounded scroll heights and can report an initially unknown
app state. These behaviors guided the regression tests:
[ScrollView](https://reactnative.dev/docs/scrollview),
[AppState](https://reactnative.dev/docs/appstate).

## Acceptance Checks

1. On desktop, wheel-scroll every main page with overflowing content, including
   over meal rows in This Week. Verify the final day and unscheduled area remain
   reachable. On mobile, check touch scrolling and the weekly header layout.
2. Drag the lower meal above another meal on the same day. Verify saved ordering
   and that releasing the drag does not open another picker. Drag across days and
   test edge auto-scroll as before.
3. Open imported recipes without photos in the library, picker, week, detail,
   group sharing, and macro logging. Verify the logo. Test a missing remote image
   and then add a real photo; the new photo must replace the fallback.
4. Move a planned meal to Sunday, reset Sunday, and swipe a new meal on Discover.
   The new meal must be under Unscheduled while other dated meals remain unchanged.
5. Choose 21 or 501 summary days, Apply, switch tabs, and reopen the app. Verify
   dates/totals and persistence without changing reset-warning or other settings.
   Blank, zero, fractional, negative, and excessively large values must not save.
6. On a physical Android device, cold-launch with biometrics enabled, cancel and
   retry, and use password fallback. Confirm biometrics remain enabled afterward.
   Also test the configured background grace period and a slow native prompt.

## Capacity Snapshot

Inspected on October 4, 2026 without production load testing:

- VPS allocation: 2 vCPUs and 7.8 GiB RAM, shared with n8n, other apps, databases,
  and Ollama. Approximately 4.9 GiB was available at the sampled idle state.
- Dinner Swipe API: one Uvicorn process, roughly 128 MiB resident memory at idle.
- SQLAlchemy pool: 5 base connections plus 10 overflow, with a 30-second pool
  timeout. Dinner Swipe PostgreSQL permits 100 connections; 6 were open when sampled.
  Pool limits control simultaneous database work, not signed-in or active users.
  See [SQLAlchemy pooling](https://docs.sqlalchemy.org/en/20/core/pooling.html).
- Password login uses bcrypt, so login bursts are materially different from
  recipe reads. AI/photo imports also involve provider latency and quotas.
- No defensible maximum concurrent-user count has been measured. A conservative
  pilot target is 25-50 active UAT users, not a claimed capacity ceiling. Thousands
  of idle accounts do not equal thousands of simultaneous requests.

Before a broader rollout, benchmark representative reads, swipe/grocery writes,
login bursts, and AI imports separately on isolated staging. Test 25/50/100 active
users with realistic pauses, database sizes, and other-VPS-service contention.
Track p95 latency, error rates, CPU, DB pool wait, and sustained memory use. Do not
increase worker counts blindly: the current auth rate limiter is process-local.

## Local Verification

- API: 137 tests passed, one existing PostgreSQL-specific skip; Ruff and mypy
  passed. Custom ranges are inclusive and user-scoped, with date-underflow guards.
- Mobile: 152 tests passed across 27 suites; lint and typechecking passed.
- Web export passed after excluding private release backups from Metro's source
  scan. Backup ownership and strict permissions were not relaxed.
- Isolated Playwright checks at 320x720, 390x844, and 1280x720 passed bounded weekly
  scrolling, no horizontal overflow, missing/broken-image logo loading, custom-day
  persistence after reload, and desktop drag ordering. Wheel scrolling was checked
  on all five main desktop pages with overflowing content. Screenshots were inspected.
- API state and biometric lifecycle cases use automated fixtures. Physical-phone
  biometric UAT and a representative concurrency/load test remain pending. No live
  customer recipe, plan, macro, or billing writes were made by these checks.

## Release Boundary

These are local source changes until released. The installed production web app
is on an older frontend than Android preview 17, explaining why the previous web
scroll work was not available there. Web/API deployment needs a fresh Dinner
Swipe-only backup and retained images; no schema migration is required. Native
biometric fixes need a new APK and physical-phone acceptance testing. No live
recipes, billing/provider resources, or unrelated services are changed by these
local checks.
