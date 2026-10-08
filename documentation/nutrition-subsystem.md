# Nutrition Subsystem

## Scope And Storage

Dinner Swipe's backend is the only FatSecret client. Expo clients must never
receive provider credentials, OAuth tokens, or call FatSecret directly.

The additive migration `b981fc2a7610` creates six `nutrition_*` tables in Dinner
Swipe's existing PostgreSQL database. It does not modify existing recipes,
plans, grocery, account, or macro rows:

- `nutrition_food_identifiers`: food IDs and Dinner Swipe observation timestamps.
- `nutrition_serving_identifiers`: food/serving ID pairs, including derived
  serving ID zero without assuming it is globally unique.
- `nutrition_food_usage`: account-scoped selections, user-specified portions,
  usage timestamps, and retry-safe request IDs. No provider nutrition snapshots.
- `nutrition_provider_state`: shared pacing/cooldown lock.
- `nutrition_api_calls`: committed reservations and sanitized outcomes.
- `nutrition_refresh_runs`: daily leases, completion counts, and error codes.

Only `food_id` and `serving_id` from food responses are kept indefinitely.
Food names, brands, serving descriptions, macros, other nutrition values, and
provider response bodies are not stored in SQL or copied into recipe/macro
history. Existing independently entered recipe nutrition remains unchanged.
Additional provider fields require an explicit review of their storage rights.

The temporary response cache is process-local RAM, limited to 128 entries and
8 MiB. Responses expire after at most 23 hours from the start of the request,
are never served stale, and are purged by a 30-second background sweep even when
idle. Both elapsed and wall clocks are checked. Process exit removes the cache;
it is not part of PostgreSQL dumps, files, image layers, or persistent volumes.
Separate API/job processes have independent caches, not a shared warmed cache.
Responses to clients include `Cache-Control: no-store`; future mobile/web UI
must not persist response content in its offline query cache.

Official policy: [Storable data](https://platform.fatsecret.com/docs/guides/storable-data),
[FatSecret terms](https://platform.fatsecret.com/terms).

## Request Limits

Default configuration:

- Total budget: 1,000 outbound attempts in a rolling 24 hours and a UTC day.
- Background allowance: at most 100 within that shared total.
- Pacing: at least one second between globally reserved requests.
- Configuration hard ceiling: 4,000 total attempts, below Basic's published
  5,000-call allowance. There is no alternate key/IP or quota-bypass behavior.

PostgreSQL row locking serializes reservations across API processes and jobs.
Every OAuth token request and every data request is reserved and committed
before transmission. Errors, timeouts, and uncertain outcomes remain charged
locally; unused reservations are not refunded. Cache hits consume no calls.
Quota/ledger/database failures do not permit an unreserved external request.

HTTP 429 and provider JSON errors 11/12 pause all requests for at least 24 hours,
or longer if required by `Retry-After`. Credential, scope, and IP authorization
failures pause requests for one hour; transient
provider/network errors also pause requests. There are no automatic retries of
failed provider calls. Local pacing waits do not consume a call reservation.

All uses of these credentials must pass through this ledger. Calls made by
other applications or manually outside Dinner Swipe cannot be measured here.

Sources: [Basic edition](https://platform.fatsecret.com/api-editions),
[OAuth 2.0](https://platform.fatsecret.com/docs/guides/authentication/oauth2).

## Backend Routes

All routes require an authenticated Dinner Swipe account with Basic access:

- `GET /api/v1/nutrition/foods/search?query=rice&page=0`
- `GET /api/v1/nutrition/foods/{food_id}`
- `POST /api/v1/nutrition/usage` with food ID, serving ID, portions, and a UUID
  request ID. Repeating the same request is idempotent; mismatched reuse fails.
- `GET /api/v1/nutrition/usage`: only the caller's latest 100 selections.
- `GET /api/v1/nutrition/status`: configuration, quotas, and cooldown status,
  never credentials or response content.

Lookup responses carry the attribution and terms links. Any future UI that
displays provider content must display the required FatSecret attribution and
terms link. Verify application terms/acceptance and provider rights before
shipping a consumer-facing lookup or using returned values for saved analytics.
This phase does not add nutrition lookup controls to the existing mobile UI.

Authentication uses OAuth 2.0 Client Credentials with the Basic scope. Search
uses `foods.search` and details use `food.get.v5`; Premier-only features and
scope upgrades are not attempted. The developer account must authorize the
VPS's outbound IP. Although the search documentation lists a Premier scope,
the live operator-requested validation below confirmed that `foods.search` and
`food.get.v5` work with these credentials and a `basic` token after IP
authorization. Failures are surfaced instead of silently changing scope or
subscriptions. An IP authorization failure does not establish that Basic lacks
food search or macro access.

## Daily Task

`dinner-swipe-nutrition-daily.timer` schedules the task at 4:15 AM
America/New_York with up to five minutes of jitter and persistent missed-run
handling. The date lease prevents overlapping/repeated daily scans.

The job refreshes only foods used by Dinner Swipe accounts within the past
30 days whose last detail observation is at least 23 hours old. It prioritizes
recent use and stops at the shared background quota or a ten-minute work limit.
There are no random search seeds, ID-range sweeps, or catalog crawls. With no
recorded selections the job completes without fetching foods.

Automated catalog discovery/indexing is disabled. FatSecret's terms restrict
automated retrieval/indexing independently of the daily rate limit. Written
provider permission and an explicit implementation review are required before
adding a discovery crawler. Staying under 5,000 calls alone is not permission.

## Operations

Credentials live in Git-ignored `.env.fatsecret`, mode 0600. The optional Compose
environment file is loaded only by the API. The dedicated daily task reads the
same file server-side; credentials are not embedded in commands or image layers.
Since credentials were supplied in chat, rotate them through the provider's
dashboard and replace this file when practical. Do not print or commit them.

Run status or authentication checks with:

```bash
bash infrastructure/scripts/run-nutrition-job.sh --status
bash infrastructure/scripts/run-nutrition-job.sh --verify-auth
systemctl status dinner-swipe-nutrition-daily.timer
journalctl -u dinner-swipe-nutrition-daily.service
```

The timer uses `dinner-swipe-api:nutrition`, a tested nutrition-only snapshot of
the previously deployed source plus this subsystem. Pending group UI/default
changes are deliberately excluded. Future releases should refresh the job image
along with the API after testing; never replace it with a development image.

Rollback disables the timer and restores the retained prior API image. Leave
the additive schema intact; do not restore an old database over newer customer
activity or run a destructive downgrade. Private backups and migration evidence
are under `backups/nutrition-*`.

## Activation Evidence

Verified on 2026-10-08 UTC:

- Nutrition-only API image `c01338b3966c` is live and healthy. The daily task
  uses that same image as a non-root, read-only container. The image source
  permission issue found during its first run was corrected and the task rerun
  completed successfully with zero foods refreshed.
- Migration `b981fc2a7610` is applied. Before/after fingerprints confirmed all
  43 pre-existing tables and 1,508 rows were unchanged by the migration.
  A private pre-migration database dump and the prior API image are retained
  under `backups/nutrition-20261008T001021Z` and
  `dinner-swipe-api:before-nutrition`, respectively.
- Ruff and mypy passed. API tests: 186 passed, three opt-in PostgreSQL tests
  skipped. Those PostgreSQL tests were run separately against an isolated
  restored database: three passed, including concurrent global quota enforcement.
- The daily timer is enabled. Its first manual execution completed with no
  recorded food selections and therefore no provider calls.
- One explicitly requested OAuth attempt succeeded. One food search failed
  with the sanitized `credentials_or_scope` outcome; both attempts are charged
  to the ledger. The provider cooldown prevents further attempts for one hour.
  Search entitlement/scope is unresolved, not a verified working integration.
- Food identifiers, serving identifiers, and food usage each contain zero rows.
  There is no populated nutrition catalog yet. No mobile lookup UI, GitHub push,
  or APK release was included in this subsystem activation.

The request to retain values for comparison does not authorize indefinite
storage of FatSecret nutrition snapshots or automated catalog discovery.
Permanent comparison history needs written provider permission or a separately
licensed, independently sourced dataset. Until then, only permitted identifiers
and Dinner Swipe's own usage/operational metadata are durable; returned nutrition
values remain temporary as described above.

## Eggs Lookup Diagnosis

On 2026-10-08 UTC, an operator-requested search for `eggs` obtained an OAuth
token with the `basic` scope, then returned FatSecret JSON error 21: invalid IP
address. No food or nutrition response was returned. The previous generic
credential/scope diagnosis was therefore too broad; this attempt was rejected
by the provider IP allowlist, not by a missing Premier scope.

The Dinner Swipe Docker network's outbound public IPv4 was verified as
`187.77.15.246`. Add that exact address to the application's allowed IP addresses
in the FatSecret developer dashboard. Provider-side changes require account
access; this task did not change the application plan, scopes, or provider
settings. Stop requests until the address is authorized, then perform one
operator-requested search/detail validation through the existing quota ledger.

The diagnostic resumed only Dinner Swipe's local credential-failure pause once;
it did not clear a provider rate-limit pause or alter the request budget. The
two attempts (OAuth and search) remain charged; the ledger now contains four
attempts total. New errors distinguish `ip_not_authorized` from `missing_scope`,
without recording provider messages, tokens, or response bodies.

The diagnostic fix is deployed in nutrition-only image `07c35f3d48df`, replacing
the earlier nutrition image for both the API and daily task. Ruff and mypy
passed; 190 API tests passed and three opt-in PostgreSQL tests were skipped.
No migration was required. The prior healthy image is retained as
`dinner-swipe-api:before-nutrition-diagnostics`; deployment evidence is under
`backups/nutrition-diagnostics-*`. The current cooldown's reason was corrected
to `ip_not_authorized` without shortening its expiry or changing either quota.
Food and serving identifier tables remain empty. Pending group changes and
unrelated services were not included in this deployment.

Sources: [Error codes](https://platform.fatsecret.com/docs/guides/error-codes),
[OAuth/IP prerequisites](https://platform.fatsecret.com/docs/guides/authentication/oauth2).

## Basic Lookup Verified

On 2026-10-08 at approximately 01:31 UTC, after the user saved the provider IP
allowlist change, one operator-requested `eggs` search and food detail lookup
succeeded. OAuth granted `basic`; authentication, `foods.search`, and
`food.get.v5` each returned HTTP 200 without a provider error. The detail
response included standard servings and calorie, protein, carbohydrate, and
fat values. Those values were displayed for the requested test, not written
into PostgreSQL, source files, or operational documentation.

The test retained only five permitted food IDs and six food/serving ID pairs.
It created no user food-usage, recipe, meal-plan, or macro-log entries. There
are seven total charged attempts in the rolling-day ledger, including the four
earlier attempts; the configured total budget remains 1,000 and background
allowance remains 100. The operator resumed only the IP-authorization pause,
not a provider rate-limit pause. The one-shot process exited, discarding its
temporary response cache and OAuth token. The now-expired IP cooldown metadata
was cleared only if no newer active pause had been recorded.

Keep only the exact VPS outbound IP allowlisted. Provider allowlisting controls
where authenticated outbound API requests may originate; it does not alter VPS
firewall rules, open inbound ports, or grant provider access to PostgreSQL.
If the VPS outbound IP changes, update the provider entry and rerun a controlled
lookup. Credentials must remain private and server-side, including on this
shared VPS. Catalog discovery remains disabled pending separate permission;
the existing mobile screens are unchanged.
