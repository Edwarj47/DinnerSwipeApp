# Launch Readiness: November 8, 2026

**Status: private preview, not ready for public store submission.** Configuration,
a passing web build, or a recorded deletion request does not prove store readiness.
Garmin and personal Garmin-key entry remain deferred.

## Released Polish

Source `5ea46f2` was pushed, deployed to the web, and published to the Android
preview channel for runtime `0.2.0` / APK 28. The update group is
`2ba466fa-c90c-4b87-a25c-31a545dabc39`. The release passed 706 mobile tests,
lint/types/runtime checks, GitHub CI and synthetic-account browser checks at
1440x900, 390x844 and 320x800. Preview manifest delivery was verified.

Calculated meal logging shows portion-scaled totals and a labeled optional notes
field. Cached accents restore before authenticated screens. The fixed native
splash in the installed APK is unchanged; changing it requires a new binary.
The native toolchain is now Expo SDK 58 / React Native 0.88, not the old SDK 51
baseline in the September roadmap. Native voice and compatible EAS Update are
already integrated, but actual Android/iOS device acceptance testing remains.

Provider attribution is not a repeated terms agreement. FatSecret requires credit
where its data is displayed, plus public website/store-listing attribution.
Parent credits are hidden while the active child nutrition view supplies its
own credit. Do not remove that credit or add duplicate consent checkboxes.
[FatSecret attribution policy](https://platform.fatsecret.com/attribution).

## Account Controls

The next source changes improve **request intake only**:

- Authenticated `/delete-account` works without an active subscription. It is
  linked from legal pages and both subscription-lock/error views.
- Current password and exact `DELETE` confirmation remain required. The API
  rate-limits before password verification, serializes retries on the user row,
  and reuses the original pending request instead of duplicating it.
- The authenticated status endpoint returns only the caller's pending state
  and original timestamp with `Cache-Control: no-store`.
- Both status and submission are explicitly bound to the confirmed account ID;
  a stale form cannot follow another browser tab's changed sign-in cookies.
- The account route omits planning/offline sync runtimes while nutrition-cache
  expiry stays mounted without network refresh. Its reconnection path verifies only
  health/authentication, not subscriptions or pending recipe/macro edits. The two
  intake endpoints retry the server rather than trusting a stale offline flag.
- The form shows a persistent receipt and explicitly says the account has not
  been deleted and billing has not been canceled. Existing clients retain the
  original POST payload, URL and exact successful response.

This is **not** account erasure, subscription cancellation, session revocation,
media deletion, or background-job cancellation. Do not mark the store's deletion
fulfillment requirements complete on the strength of intake tests.

### Fulfillment Still Needed

1. Confirm retention of deliberately shared recipe/workout copies versus removal,
   ownership transfer for populated groups, and a documented backup/legal
   retention policy. Preserve other members' plans, grocery lists and history.
2. Add durable, resumable deletion state and retryable media cleanup, with fresh
   password confirmation and a clear preflight summary. Fence concurrent account
   writers, uploads, AI/ingestion jobs and late billing webhooks.
3. Resolve active and uncertain billing/checkout state before deleting provider
   mappings. Never assume a deletion request cancels an external subscription.
4. Purge personal records in foreign-key-safe order, scrub personal provenance
   and audit payloads, and keep aggregate API-budget accounting anonymous.
5. Retained shared content must keep non-null restricted ownership. Null recipe
   ownership means public/global content in this app and is not anonymization.
   Retain required image-license credits and referenced calculation/media records.
6. Prove erasure/rollback/retry, access revocation, account isolation, shared-history
   preservation and concurrent-job behavior against disposable PostgreSQL.
   Never use a real account as a destructive test.

Pending intake can be reviewed by authorized operators with a read-only query of
`audit_events` filtered to `account_deletion_requested` and
`payload->>'status' = 'pending_manual_review'`, joined to `users`. Report earliest
request time, duplicate count and age per user; keep that report private and omit
credentials and unrelated audit payloads. Do not manually delete table rows from
this query or describe the intake audit table as a complete processing queue.

Apple requires actual account deletion, not merely deactivation. Google also
requires an in-app path and an external web deletion resource. Verify the
fulfilled flow and disclosures before submission.
[Apple deletion guidance](https://developer.apple.com/help/app-review/guideline-reference/5-1-1-account-deletion),
[Google deletion guidance](https://support.google.com/googleplay/android-developer/answer/13327111?hl=en).

## Native Purchases And Restoration

**Not implemented.** Current native preview purchase/coupon/portal actions still
use Stripe. They must not be submitted unchanged as a globally compliant native
purchase flow. Web Stripe billing can remain. Developer enrollments and launch
countries have been requested but are not currently confirmed.

Native store work requires a new runtime and binary, not an update to APK 28:

1. Confirm store accounts, signing, merchant agreements, countries, Basic/Premium
   products, renewal terms and sandbox testers. Do not create paid resources or
   spend money as part of local verification.
2. Validate the chosen native billing library against the actual SDK/RN toolchain
   before pinning it. Isolate platform code so web checkout is unaffected.
3. Persist random account-binding identifiers and unique provider purchase
   ownership; accept no client-supplied premium flags or expiry dates.
4. Verify Apple signed transactions/current status and Google subscription-v2
   state on the backend, with server-owned product-to-tier mapping and account
   binding. Verification failures must not extend access or fall back to Stripe.
5. Preserve independent provider records and derive effective unexpired
   entitlement without overwriting existing Stripe/waiver subscriptions.
6. Restore through the same verified flow; finish/acknowledge only after durable
   entitlement persistence. Replays are idempotent; cross-account claims fail.
7. Verify signed Apple notifications and authenticated Google RTDN, deduplicate
   events and reconcile current provider state. Test refunds, revocations,
   cancellations, expiration, grace/hold/pending states and delayed events.
8. Use store-localized products/prices/terms. Hide external checkout, coupons that
   redirect to payment, and generic Stripe portal links in public store builds.
9. Test actual sandbox purchase, restore after reinstall, duplicate purchase,
   account switching and provider failure on physical Android/iOS devices.

[Apple purchase rules](https://developer.apple.com/app-store/review/guidelines/#in-app-purchase),
[Google payments policy](https://support.google.com/googleplay/android-developer/answer/10281818?hl=en).

## Privacy Disclosure Inventory

This inventory is a form-preparation aid, not a completed App Privacy/Data Safety
declaration or legal certification. Map each item to the store's current taxonomy
and actual provider/retention settings, including optional and server-side data.

| Data | Current behavior | Likely purpose |
| --- | --- | --- |
| Email, account IDs, verification/legal acceptance | Account-linked server records | Authentication and account management |
| Recipes, imports, photos, notes and group choices | Saved content; intentional group sharing | App functionality and personalization |
| Macro targets/logs and nutrition references | Account-linked, potentially health-related | Tracking and user-requested analytics |
| Workout logs, sets, weights, durations, notes | Account-specific performance; shared templates/plans separately | Fitness tracking and planning |
| Optional meal text/audio and AI recipe photo/text | Sent through backend to OpenAI; not a zero-retention guarantee | Requested AI/transcription |
| Food search terms and identifiers | Backend requests to FatSecret; returned content temporary | Requested nutrition matching |
| Subscription IDs/status/events | Backend plus Stripe currently; future stores must be added when real | Billing and access |
| Auth/network metadata, usage/job/rate-limit records | Security, reliability and quota records; not all temporary | Abuse prevention and diagnostics |
| Local biometrics, reminders and appearance | OS biometric templates are not sent to Dinner Swipe; local notification permission is optional | Device security and preferences |
| Expo update requests | Technical/network metadata for update delivery, not meal/audio payloads | App maintenance |

The source policy now explicitly covers workout/macro health-related records,
local biometric/reminder handling, and the actual manual-review deletion state.
Do not claim full erasure, a fixed backup-retention deadline, zero provider
retention, or native store processing before those are implemented/verified.
No Garmin, HealthKit or Health Connect integration is present. No advertising
tracking SDK was found in the reviewed mobile dependency manifest; re-audit the
final native binary and all third-party SDK privacy manifests before submission.

[Apple privacy details](https://developer.apple.com/app-store/app-privacy-details/),
[Google Data Safety guidance](https://support.google.com/googleplay/android-developer/answer/10787469?hl=en).

## Final Acceptance Gates

- Fulfilled account deletion and tested restore/purchase lifecycle.
- Final privacy/support/deletion URLs, retention policy and store forms.
- Separate non-charging test environment; preview currently uses the live API.
- Signed AAB/iOS builds, native permission/privacy-manifest checks and store assets.
- Physical cold start, biometric cancellation, voice permission/recording,
  background/resume, offline/retry, camera and reminders on both platforms.
- Small-phone layout, font scaling, screen-reader labels and theme verification.
- Google internal testing/TestFlight evidence and reviewer account/instructions.
- Crash diagnostics with scrubbed payloads, scoped backups and tested rollback.

Do not queue a public release or declare these gates passed from mock tests.
