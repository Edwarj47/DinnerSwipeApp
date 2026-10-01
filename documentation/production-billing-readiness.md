# Production Billing Readiness

## Release 12 Scope

API and web deployed on 2026-10-01. Both live Checkout sessions were created, verified,
and immediately expired without entering payment details or creating a subscription.
The Dinner Swipe webhook now subscribes to all 10 events below. Its billing portal
contains only the two configured Dinner Swipe prices, with quantity changes disabled.
Fresh backup restoration passed; no migration or unrelated service restart was performed.
Android preview 12 and GitHub CI verification are recorded in `android-preview-uat.md`.

- Live Stripe account verified: expected account, charges and payouts enabled, active USD
  monthly prices of $5.99 Basic and $9.99 Premium, active billing portal.
- Basic offers a 30-day trial with a card required. Previous Stripe subscribers on the same
  account do not get another trial. Returning users see monthly billing instead of a trial offer.
- Webhook signature and live/test mode are checked. Access follows the latest subscription
  fetched from Stripe, not the checkout redirect or an out-of-order event snapshot.
- Configured price IDs determine the tier, including portal upgrades. Modern item-level
  billing periods and trial end dates are supported. Unpaid checkout does not unlock access.
- Repeated events are deduplicated under an account lock. Stripe sync failures return a retryable
  error. Invoice failure/paid events resync access. Old cancellations cannot erase coupon access.
- Pending checkout sessions are reused. Network retries share an idempotency key. Switching
  plans expires an earlier open checkout rather than leaving both purchase links active.
- Stripe SDK is pinned to tested 15.6.1; request API version is 2026-08-26.dahlia. No account-wide
  Stripe API-version change is required. Coupon handlers accept actual SDK response objects.
- Coupon access grants and bill discounts remain distinct. Existing development grants are
  unchanged. No marketing coupons or new subscription prices were created.

## Required Webhook Events

Dinner Swipe endpoint: `https://dinner.dcss.dev/api/v1/premium/stripe/webhook`.
Only this endpoint's subscriptions are updated; other projects are not changed.

- `checkout.session.completed`, `checkout.session.async_payment_succeeded`
- `customer.subscription.created`, `.updated`, `.deleted`, `.paused`, `.resumed`
- `invoice.paid`, `invoice.payment_failed`, `invoice.payment_action_required`

## Verification and Rollback

- Local: 97 API tests, 49 mobile tests, Ruff, mypy, ESLint, TypeScript, web export.
- Browser: mocked UAT flows at 320/390/1280 pixels for coupons, recipe nutrition, portion
  logging, library recovery, and recipe selection in Macro Tracker.
- Before deployment: private Dinner Swipe-only database dump, isolated restore check,
  environment snapshot, webhook snapshot, and retained API/web rollback images.
- Provider rollback: the private release directory contains `stripe-webhook.before.json`
  and `stripe-portal.before.json`. Restore only this endpoint's enabled events and the
  Dinner Swipe portal's subscription-update product configuration, not account-wide settings.
- No schema migration is needed. Rollback uses `dinner-swipe-api:before-preview12` and
  `dinner-swipe-web:before-preview12`, plus the release's `environment.before` file. Recreate
  only API and web with `--no-deps`; never bring the entire shared VPS stack down.
- Verify live checkout sessions for both tiers without providing a card or customer, then
  immediately expire them. This checks live configuration, not a completed payment.
- Record deployment, CI, APK source/version/signing checks and download URL after completion.

## Still Required Before Public Launch

- A controlled end-to-end payment/UAT exercise: payment authentication, renewal, decline/retry,
  cancellation, refund, and discount durations. Mocked lifecycle tests and uncompleted live
  Checkout sessions are not proof that real settlement and renewals have occurred.
- Owner decisions on tax registrations, refund/support policy, and public promotional offers.
  Automatic tax and new offers must not be enabled without those decisions.
- Apple/Google developer accounts, store submission assets/review, and review of each store's
  applicable digital-subscription billing rules before shipping the store builds. A private
  Android APK using web checkout is not evidence of store compliance.
- Restore drills, operational alerting, and periodic review of webhook delivery failures.
- Remove or tightly restrict development coupons before broad public marketing; actual values
  remain outside Git. The Stripe tool connection separately needs reauthentication, although
  the production app uses its own verified credentials.
