# Subscription UAT Diagnostic

Checked on 2026-09-23 against `https://dinner.dcss.dev`.

## Live Configuration

- Web and API return HTTP 200. API and PostgreSQL are healthy; the worker is running.
- Database migrations are at `0db143da7f75` (head).
- Production URLs and allowed web origin point to Dinner Swipe. The environment
  file has mode `0600`, and the JWT secret is not the development default.
- The configured Basic and Premium UAT codes match their intended tiers. Waivers
  have no expiration and do not require checkout. Keep the values only in the
  private environment file, not in this document or the client bundle.
- The application's Stripe credentials resolve to Data Centric Software
  Solutions LLC. Both products are active, with monthly USD prices of $5.99
  (Basic) and $9.99 (Premium).
- Checkout uses live Stripe prices. Use waiver codes for charge-free UAT.
- Basic Checkout requires a payment method and starts a 30-day trial.
  Premium starts billing immediately.
- The Dinner Swipe webhook is enabled for Checkout completion and subscription
  creation, updates, and deletion. The public endpoint rejects unsigned requests.
- The billing portal is active with subscription changes, cancellation, and
  payment-method updates enabled.
- SMTP and AI ingestion are configured. No email or AI import was triggered by
  this diagnostic. No paid checkout or Stripe resource mutation was performed.

## Product Gap

The checked-in group service supports joining an existing group, voting, safety
settings, and ownership transfer. It does not expose a group creation endpoint
or a list/switch workflow. Unlimited Premium groups are therefore labeled
"Coming soon" on the subscription screen and Profile. Implement and test the
multi-group workflow and tier limits before describing it as available.

## UI And Verification

- A dropdown selects Basic or Premium. Only the selected plan's benefits,
  billing terms, and checkout action are shown.
- The form has a constrained desktop width and scrolls on small screens.
- Invalid access codes use error styling and clear when edited.
- Returning to the app from checkout refreshes subscription status.
- TypeScript, ESLint, the 7 mobile tests, and 38 API tests passed.
- The native paywall component test covers opening the plan picker and sending
  the selected tier to checkout. A physical Android/iOS device was not tested.
- Playwright checked 1440px, 860px, 390px, and 320px layouts, selected checkout
  tiers, invalid-code messaging, code unlock, and checkout-return refresh.
  Browser API responses were fixtures; live configuration checks above were
  separate, read-only requests.

## Web Rollback

The previous production web image is preserved as
`dinner-swipe-web:before-subscription-picker-20260923`.
To restore it, retag it as `dinner-swipe-dinner-swipe-web:latest` and recreate only
`dinner-swipe-web` with `docker compose --profile production up -d --no-deps
--force-recreate dinner-swipe-web`. No database migration is part of this change.
