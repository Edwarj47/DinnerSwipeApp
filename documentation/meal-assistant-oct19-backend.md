# Meal Assistant Backend: October 19

## Scope

Backend-only working-tree changes. No deployment, production writes, migrations,
provider requests, budget changes, or changes to serving arithmetic. Frontend
serving precision and API error rendering are owned by the main task.

## Rate Limits

- Food search and details retain their shared per-user 20 requests/minute limit.
- Preview and saved-calculation reads use a separate shared per-user 20/minute
  calculation bucket, so manual calculations cannot exhaust food search/details.
- Draft reads use their own per-user 20/minute bucket.
- These are bounded HTTP request buckets, not provider-call ledger quotas.
  Provider-backed calculations and draft reads can still fetch details on a RAM
  cache miss; all outbound calls remain subject to the existing provider ledger,
  account/global daily budgets, pacing, and cooldown.
- Search, details, and OAuth already carry the authenticated account through
  `get_current_user()` -> `RequestActor` -> `FatSecretClient._reserve()` ->
  `NutritionBudget.reserve(user_id=actor.user_id)`. Route-level regressions verify
  this identity propagation and rejection of account call 101 with a 100-call
  allowance, while cache hits stay free and the global allowance stays 1,000.
- Local limiter responses are HTTP 429 with `detail.code = rate_limit`, a
  descriptive `detail.message`, `detail.retry_after_seconds`, `Retry-After`, and
  `Cache-Control: no-store`. Retry time rounds up to the bucket boundary.
- Provider-budget failures retain their distinct codes and HTTP 429 status.
  Provider-pause failures retain HTTP 503 and their original cooldown durations.
- Whitespace-only invalid searches no longer spend a lookup request allowance.

## Lookup Workflow

One meal workflow deduplicates identical search parameters (case/whitespace
normalized) and detail IDs in request-local RAM, including failed requests.
Mentions remain separate with their original quantities and units. Provider-wide
failures stop remaining outbound work for that workflow; food-specific failures
do not prevent unrelated foods from matching. No provider response content is
added to persistent storage. The existing client cache/lock already deduplicates
concurrent identical provider requests; its lifetime and budget logic are unchanged.

## Diagnostics And Verification

The shared pre-change lookup bucket is verified from source. The operator's
read-only ledger summary showed successful provider calls and no current pause,
but does not by itself establish the historical source of a reported 429.
Production-log diagnosis remains with the main task.

Regression runs use SQLite fixtures, mocked HTTP transports, and a network
namespace with no outbound access. Final run output and JUnit results:

- Expanded regressions: 331 passed.
- Additional authenticated-account quota regressions: 3 passed.

- `/tmp/codex-dinner-nutrition-final.log`
- `/tmp/codex-dinner-nutrition-final.xml`
- `/tmp/codex-dinner-nutrition-account.log`
- `/tmp/codex-dinner-nutrition-account.xml`

No opt-in PostgreSQL concurrency tests or production checks are run here.
