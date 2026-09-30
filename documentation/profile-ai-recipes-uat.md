# Profile and AI Recipe UAT

## Behavior

- Subscription and tester access codes live at the top of Profile > Account.
- Account identity, Replay tour, sign-out, password reset, and data/legal are together.
- Account Settings groups Planning and Device security.
- Macro Tracker replaces Premium. Basic sees a locked state and a subscription link;
  macro queries and editing remain Premium-only on the API.
- Manual recipe entry has no sample buttons. Choose photo and Take photo share
  permission/error handling. On mobile web, camera capture depends on the browser.
- AI replaces CSV in Add. Existing spreadsheet imports and API routes are retained.
- AI drafts are editable and only enter the library after Save recipe. Drafts can
  be revisited or discarded. Input text and photos are sent to OpenAI, not persisted
  by Dinner Swipe. Drafts and usage metadata are retained; discarded draft content
  is removed while its usage record remains. Account export includes AI activity.
- Premium has no monthly AI count limit. Basic (including its trial) gets three
  successful drafts per UTC calendar month. Discard/save does not refund usage.
  Failed or interrupted generation does not consume a use. In-flight requests
  reserve a use, with a three-minute interruption timeout. Five attempts/minute
  and one in-flight request per account protect the service for both tiers.
- Repeated request IDs return the original result. PostgreSQL account-row locks
  serialize quota reservations; approval is one transaction and repeatable without
  producing another recipe. Existing ingestion jobs store drafts and counts;
  no schema migration is needed.
- Legacy recycled web drafts use rejected_at, then updated_at, then created_at.
  Listing and restore enforce a strict 15-day boundary. Rejection retries do not
  extend it. Expired drafts are hidden, not purged from the database by this patch.

## AI Contract

Default model: `gpt-5.4-mini`, configurable using `AI_RECIPE_MODEL`.
If the provider reports that the model is retired, missing or unavailable, the
same request uses `OPENAI_FALLBACK_MODELS` (default `gpt-4.1-mini`). This also covers
AI normalization of web imports. The ordered list is deduplicated and bounded to
four models total. Refusals, invalid output, authentication/billing/rate-limit
errors and generic server failures do not trigger model switching. Each chain
shares the original timeout and counts as one generation, not several uses.
The actual model used is recorded in the ingestion job; logs contain model names
only. Update the environment list and recreate the API when replacements change;
no mobile rebuild is required. If every configured model becomes unavailable,
generation fails safely without using the allowance. There is no guarantee that
any fixed model remains available forever; monitor provider retirement notices.
The Responses API receives a versioned recipe-only prompt and strict JSON schema,
with `store: false`, a bounded output, a 90-second deadline, no tools, and no
external URL fetches. Images are limited to 5 MB JPEG/PNG/WebP; descriptions to
6,000 characters. Authenticated Basic access is required before generation.

The model transcribes written recipes or proposes a draft for an idea/food photo.
Estimated quantities/timing are identified; allergens cannot be verified from an
image. Review remains mandatory. Provider refusals, incomplete outputs and schema
failures return a plain-English error without provider internals.

Model reference: https://developers.openai.com/api/docs/models/gpt-5.4-mini

## Release Requirements

Not deployed by this change. After release approval:

1. Run API lint/types/tests, mobile lint/types/tests, and web export.
2. Back up Dinner Swipe only and retain its current service images for rollback.
3. Deploy the API with `AI_RECIPE_ENABLED=true`, `AI_RECIPE_MODEL=gpt-5.4-mini`, and
   the existing secret `OPENAI_API_KEY`. Do not put the key in source or logs.
4. Verify usage, generation, discard, approval, and expired-bin behavior using
   dedicated UAT accounts. Roll back the API image or disable the flag if needed.
5. Deploy the web build and create a new signed preview APK. The image-picker
   plugin adds camera permissions; do not rely on a JavaScript-only phone update.
6. On Android/iOS devices test camera permission denied, granted and canceled;
   image rotation; large photos; sign-out mid-request; and background/resume.

Local verification uses mocked account data, SQLite API tests, browser checks at
320/390/1280px, and two live synthetic OpenAI examples (text and recipe image).
PostgreSQL 16 concurrency checks also passed in an isolated, temporary database:
eight requests for one remaining Basic use produced one reservation; six
simultaneous approvals created exactly one recipe. The test database was removed.
Physical-device camera checks are still required before broad release.
