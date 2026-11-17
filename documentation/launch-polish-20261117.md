# Launch Polish: November 17, 2026

## Status

Implemented and locally verified; **not pushed, deployed, or published to EAS**.
The live release remains `fc3f477ee9b171c5c110bc9cb27d116618e53b21` / APK 29,
runtime `0.2.1`. No production records, credentials, provider settings, routes,
store settings, prices or subscriptions were changed. No paid build was queued.

This is not a public-store readiness certification. The outstanding gates in
[launch readiness](launch-readiness-20261108.md) still apply, particularly actual
account erasure, native purchases/restoration, privacy declarations and physical
Android/iOS acceptance. Garmin remains deferred. Confirm tax registrations and
paid-plan refund terms before public US/EU billing; automatic tax is unchanged.

## Product Experience

- First-use guidance asks what the user wants to do: Plan meals, Plan workouts
  when enabled, or Track nutrition with Premium. The full feature tour remains
  available. Completed/dismissed accounts are not forced through another tour.
- Short walkthroughs open the actual controls, adapt to the current experience,
  group and access, and recognize confirmed saved actions. Favorites, group
  proposals, failed requests and offline optimistic changes do not falsely count
  as a planned meal. A server-acknowledged offline entry does count.
- Empty Personal/group Discover lists explain the relevant recipe/owner-curation
  prerequisite rather than asking a new user to swipe a nonexistent meal.
- Tasks can be skipped, paused and resumed or replayed from Account details.
  Skipping does not mark the task's action complete. Progress is account-specific
  **on that device**, not synchronized across devices. Only task IDs/state are
  persisted; no meal descriptions, audio or provider responses are copied into it.
- Switching experience is an explicit Start/Resume action. Switching group pauses
  mismatched meal guidance. It does not silently alter another group's plan.
  Preference writes queued by an old account cannot run under a new account.
- Food/portion review, user-chosen dates, theme colors, provider consent and
  required attribution remain in place. No tutorial operation fabricates meals,
  workouts or macro entries. Provider quotas and nutrition cache expiry remain.

## Complimentary Premium

- With `COMPLIMENTARY_PREMIUM_ENABLED=true`, registration creates a pending
  `premium_welcome_30d_v1` eligibility row, not a subscription or a charge.
- Email verification is required. The first verified app access starts the offer
  through authenticated `POST /api/v1/subscription/welcome/start`. The server sets
  the start and exclusive end exactly 30 days apart in UTC.
- The new table has one row per account. PostgreSQL account locking makes retries
  and concurrent requests idempotent: one start/end and one audit event. Logging
  out, reinstalling, resetting the tutorial or retrying cannot restart access.
- No card or Stripe request is needed. Pending/active welcome access cannot open
  paid checkout; unresolved prior checkout cannot be overlapped by welcome access.
- Premium and Basic capabilities use the combined server entitlement; offline
  access cannot extend beyond the welcome end. AI/voice/provider limits still apply.
- The offer expires without an automatic charge. Continued subscription-gated use
  requires an explicit paid plan. Saved data is not erased, and account export,
  legal pages and deletion-request access do not require payment. It does not
  silently become a permanently free Basic subscription.
- Existing accounts are **not backfilled** and paid subscription terms are not
  replaced. Existing legacy Basic trial handling is preserved for those accounts;
  welcome recipients cannot stack that trial after their welcome ends.
- Turning the flag off stops new eligibility rows; it does not revoke eligibility
  already issued or shorten a started offer. Any existing-account promotion needs
  a separate reviewed, account-scoped grant rather than a broad migration.

## Schema And Release Order

New additive head: `fa617db329a0`, following `d9b46e13a702`. It creates only
`complimentary_premium_access`; no existing accounts are granted access by migration.

Before an authorized release: acquire the project/production claims, back up the
isolated Dinner Swipe database/media/env and retain current image IDs. Review the
staging result, apply `alembic upgrade head` with the migration owner, and verify
the actual runtime role has DML privileges on the new table before starting the
new API/worker. Deploy API/worker before the matching web or mobile JS update.
Check `/api/v1/health/ready`, sign-up/verification, expiry and an existing paid
account with synthetic or authorized UAT accounts. Never use real charges for CI.

The migration was upgraded/repeated/downgraded/re-upgraded only in a disposable
PostgreSQL database. Production rollback should keep the additive table and revert
application images; dropping it would lose issued eligibility and is not the
normal rollback. Never restore an old database over new user changes automatically.

No native inputs changed in this update. A compatible EAS Update can deliver the
JS after the API/schema release, subject to the native runtime guard and preview
device acceptance. Public store billing still needs its own native integration
and binary. The new staging origin is not silently applied to APK 29.

## Verification

Private local evidence: `/tmp/dinner-launch-polish-20261117` (synthetic fixtures,
isolated containers, logs and screenshots; not public release downloads).

- API: Ruff and mypy passed; 1,093 tests passed, 13 environment-dependent tests
  skipped in the default suite. Existing framework deprecation warnings remain.
- Disposable PostgreSQL: all 11 integration cases executed, no skips, including
  eight concurrent welcome activations. Migration upgrade/rollback passed.
- The actual staging SQL initializer and real migrations passed with a dedicated
  runtime role: DML allowed, table/schema/role changes denied.
- Mobile: TypeScript passed; ESLint exited successfully with 72 warnings and no
  errors (including effect-state and import warnings). 744 tests passed in 67
  suites, including stale account-write rejection before network dispatch.
- Candidate API and nginx web images built; the API image reports the expected
  concrete Alembic head. Browser checks covered 1440x900, 390x844 and
  320x800: logo pixels, settings controls, task start/dismiss and no-card verification
  state; screenshots were inspected. These are synthetic API responses, not proof
  of native recording, billing settlement or physical-device behavior.
- All 15 release-contract/Compose checks passed; workflow YAML parsed and native
  icon/release/runtime guards passed. Three additional readiness endpoint tests
  passed for missing, old and current schema revisions. Read
  [the CI/CD operations guide](reviewed-cicd.md) for activation
  prerequisites and the unexecuted host deployment boundary.
