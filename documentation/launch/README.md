# Launch Fulfillment Package

Prepared November 18-19, 2026. Source work and test evidence are separate from a
production release, a store submission and legal approval.

## Review Documents

- [Privacy policy draft](privacy-policy-draft.md): actual account, health, fitness,
  group, voice, AI, database, payment and device data handling.
- [Subscription terms draft](subscription-terms-draft.md): free Basic, 30-day
  no-card complimentary Premium, explicit monthly purchases, cancellation and restoration.
- [Retention and erasure operations](retention-and-erasure-draft.md): data categories,
  deletion outcomes, recovery suppression, operational responsibilities and open decisions.
- [Store disclosure worksheet](store-disclosure-worksheet.md): Google Data Safety,
  health declaration and Apple App Privacy inventory and acceptance checklist.
- [Native billing runbook](native-billing-runbook.md): store setup, protected server
  configuration, rollout order and sandbox acceptance.
- [Verification record](verification-2026-11-19.md): completed checks, private evidence
  locations and explicit unverified release boundaries.

These are drafts, not automatically published legal text. Confirm controller/legal
entity and mailing address, minimum age, EU health-data consent/transfer arrangements,
provider contracts, backup window and tax treatment before public release. A proposed
30-day backup window is not an enabled pruning policy. No existing backup archives
were removed by this work.

## Commercial Decision Implemented In Source

Basic is free for active authenticated accounts. Eligible new verified accounts
retain the existing 30-day no-card/no-autocharge welcome grant. After it expires,
Basic continues; paid Premium requires a separate purchase. Intended U.S. reference
price: USD 9.99 monthly. The purchasing provider controls displayed currency and tax.
Existing paid Basic subscriptions were not cancelled or repriced.

Native purchases use platform billing and backend verification; web Stripe remains
separate. Native purchase screens do not fall back to web checkout or coupons.
Missing store credentials leave purchase unavailable. This is deliberate, not a
successful transaction simulation. New native inputs require runtime 0.3.0/code31,
a new Android store bundle and an iOS archive; an OTA update cannot add this module
to runtime 0.2.2/code30.

## Deletion Decision Implemented In Source

The owner approved removal of original shared recipes and workout contributions,
preserving other accounts' independently owned copies and personal logs. Shared
group ownership must be resolved first. Deletion revokes access before cleanup,
uses a durable receipt and retries failures without claiming they completed.
Minimal detached store ownership prevents old purchases from being reassigned to
an unrelated or newly created account.

`ACCOUNT_ERASURE_ENABLED`, `NATIVE_GOOGLE_ENABLED` and `NATIVE_APPLE_ENABLED` default
to false. Their production rollout is separate. The old manual deletion-intake
route remains compatible until fulfillment is enabled; do not describe it as
immediate erasure. Account deletion does not silently cancel external billing.

## Owner Actions

1. Google: complete payments agreements/profile, choose the monthly subscription
   product and base-plan IDs, price/regions, API service-account access, authenticated
   RTDN and license testers. Internal tester membership alone is not license testing.
2. Apple: finish enrollment and agreements, create the matching app and monthly
   product, configure server verification/notifications and signing, then TestFlight.
3. Review the draft documents and decide the outstanding legal/retention/audience
   items. Confirm a rights-request and incident-response owner.
4. Approve a separately backed-up source deployment and new native builds, then
   perform actual sandbox purchases and device acceptance. Never use a real customer
   account for destructive deletion tests.

## Current Evidence Boundary

The earlier AAB30 was cryptographically verified privately on November 18 from
source `60ae95d2f9c81a7fa0e40d32ae69f32fec1b7dbc`; it does not include this package's
native billing/deletion changes and was not uploaded by this task. Its manifest is
under `backups/store-testing-20261118`. Keep that older artifact's readiness separate
from the new runtime. Local provider-mocked tests do not establish real payments,
banking, tax compliance, iOS compilation, device behavior or store approval.
