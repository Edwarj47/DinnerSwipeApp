# Hybrid pantry, summary period, swipe preview and desktop scrolling

## Behavior

- In Pantry offers enough for this week's requirements or a precise quantity.
  Shared quantities are allocated once; units must match or be known aliases.
  Planning does not deplete stock. New weeks or changed recipe requirements
  invalidate enough coverage. Old-client pantry requests retain legacy behavior.
- Macro Tracker summary period offers Today, Last 7 days, Last 14 days and
  Last 365 days. The choice persists per account without replacing other profile
  settings. Ranges include the user's local current date and use the existing
  date-range analytics endpoint, including on an older deployed API.
- Discover shows only the dominant-axis preview badge. Ties use the horizontal
  action, consistently with release. Preview does not submit; release below the
  existing 90-point threshold cancels, and release above it retains the action.
- Web screens have bounded, flexible scroll containers and visible scrollbars.
  Discover supports mouse-wheel scrolling outside the swipe card. Native page
  scrolling and native Discover gesture behavior remain unchanged.

## Verification

- Unit/API tests cover partial shared stock, repeat regeneration, restoration,
  current-week coverage, changed requirements, mismatched units, unknown amounts,
  persistent summary selection, preserved profile fields, dominant gesture axes,
  old-server capability gating, recipe editing and transient success notices.
- Disposable PostgreSQL checks cover pending migrations from the deployed
  revision, concurrent offline retries, atomic rollback, legacy pantry defaults,
  grocery quantity backfill, downgrade and re-upgrade. No customer database used.
- Fixture-only Playwright checks cover 320x720, 390x844 and 1280x900. Actual pointer
  drags test same-day ordering and Discover previews; wheel checks test desktop
  overflow. Customer writes are intercepted, not sent to the live API.
- Final checks on 2026-10-04: mobile lint, TypeScript, 109 tests with cold cache,
  and web export passed. API Ruff, mypy and 122 tests passed (one opt-in Postgres
  test skipped in the ordinary suite, then run successfully against disposable
  PostgreSQL). Browser screenshots were visually inspected.

## Release Boundary

Android version code 16 is a standalone preview APK, not a Metro development
client. Its API URL remains `https://dinner.dcss.dev`. GitHub push and APK build
do not deploy the API/database or web container. Deployment requires a fresh
Dinner Swipe-only backup and retained API/worker/web images for rollback. Pantry
changes remain disabled against an API without the new capability. Desktop web
changes require deployment and a refresh of the installed PWA.

On 2026-10-04, the explicitly approved
[preview 17 API deployment](android-preview-uat.md#build-17-update) applied
`f20b84e901ac`. The live API now advertises hybrid pantry coverage. Existing pantry
entries retain legacy behavior until changed by a compatible client. The web
frontend remains on its prior build; native phone UAT is still pending.
