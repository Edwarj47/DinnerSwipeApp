# Recipe And Macro Fixes: October 19

## Implementation

- Logging and editing preserve a recipe's meal category, including Sauce,
  Dessert and bounded custom categories, instead of replacing them with Dinner.
  Beverage aliases retain their existing normalization. No stored entries are
  backfilled or reclassified.
- Ingredient checkboxes apply only to the currently open recipe. They support
  independent checks, duplicate ingredient lines, keyboard Space, explicit web
  accessibility state and 44px targets. Closing or switching recipes resets them;
  groceries, pantry, plans and recipe records are unchanged.
- Explicit provider serving units take precedence over rounded metric equivalents.
  Thus two ounces with a one-ounce serving remains two servings. Converted amounts
  have compact input text while their unchanged calculations retain full precision;
  an explicit user edit takes precedence. Provider save payloads still contain
  references and portions, not copied nutrition or private UI fields.
- Structured API errors retain safe messages, codes and bounded retry delays.
  Search/calculator controls respect cooldowns without automatic retry loops or
  discarding entered text. Raw proxy HTML is not displayed to users.
- Food searches/details no longer share a short-term HTTP limiter with calculation
  reads/previews. Meal workflows deduplicate repeated lookups in request-local RAM
  and stop outbound work after provider-wide failures. Account/global budgets,
  cache retention, pacing and provider cooldowns are unchanged.

## Evidence And Limits

The read-only production ledger had successful calls and no active provider pause
at inspection. This does not establish the historical cause of the screenshot's
429. The pre-change shared HTTP bucket is confirmed from source; there is no basis
to claim a broken database connection or exhausted global quota from that message.

Browser checks use mocked accounts/provider replies and no production writes.
Settled screens passed at 1440x900, 390x844, 360x800 and 320x800, including
checkbox/reset behavior, Sauce logging, exact/converted portions, in-place manual
retry after 429 and visible photo credits. Screenshots and opacity evidence are in
`backups/review-oct19/recipe-meal-ui/`.

Full backend regression: 982 passed and nine opt-in tests skipped. Subsequent
source-only checks: 113 passed and one opt-in live test skipped. The final mobile
run passed all 574 tests in 55 suites with open-handle detection and a normal exit.
Both lint/type checks and the production web export passed. Results are recorded
in `backups/review-oct19/results-final.txt`; earlier in-progress/failed runs are
retained separately and are not the final verdict. Test-only mutation-cache
cleanup and a bounded analytics-refresh assertion prevent teardown/timing flakes.
No APK/native-device test has been performed.

## Operational Status

The validation snapshot above was local work, not a release. Those checks made no
production migration, campaign enrollment, timer activation or user-data changes;
actual release and scheduler state must be checked separately. The daily-additions
source registry has 12 eligible recipes and 52 authored workouts, not 175 of each.
A white-sauce photo was excluded from a tomato-sauce recipe while retaining its
reviewed nutrition. Collect-only daily compilation does not require the entire
future catalog to be ready, and never publishes entries automatically. See
`daily-content-additions.md` for capacity and rollback boundaries.
