# Subscription And Premium Macro Tracker

Dinner Swipe now has two entitlement tiers:

- Basic: `5.99 USD/month` for app access after the free first month.
- Premium: `9.99 USD/month` for everything in Basic plus macro tracking.

## Current Implementation

- New accounts receive a Basic access trial from their account creation timestamp.
- Basic access gates app workflows such as recipes, weekly plans, grocery lists, imports, URL ingestion, and group voting.
- Profile, authentication, email verification, legal pages, account export, and subscription status remain reachable without active Basic access.
- Subscription entitlement storage is local in `user_subscriptions`.
- Premium includes Basic access.
- Meal confirmations are stored in `meal_macro_confirmations`.
- Macro targets are stored in `macro_profile_targets`.
- Recipe-level macro profiles are prepared in `recipe_macro_profiles`.
- Weekly planned meals can be marked as eaten or skipped by Premium users.
- Macro totals can use manually provided macro values or reviewed recipe macro profiles.
- Recipes without macro profiles are tracked as unmatched and require review.

Automatic nutrition extraction from recipe ingredients is not complete. The MVP macro feature is a reviewed tracking foundation, not a nutrition or medical system.

## UAT Access Codes

The API supports local access codes through:

```text
BASIC_WAIVER_CODES=
PREMIUM_WAIVER_CODES=
```

Codes are configured only in the ignored VPS `.env`. The raw code is not stored in the database; only a hash is stored with the subscription record.

Do not document or commit the live UAT code values. Share them privately with
testers, then rotate or remove them before public launch.

## Stripe Plan

Use Stripe Checkout and Billing for paid web subscriptions:

- Product: Dinner Swipe Basic
- Price: `5.99 USD/month`
- Free trial: 30 days
- Product: Dinner Swipe Premium
- Price: `9.99 USD/month`
- Checkout mode: `subscription`
- Checkout discounts: promotion codes enabled
- Checkout endpoint: `POST /api/v1/subscription/checkout-session`
- Webhook endpoint: `/api/v1/premium/stripe/webhook`
- Primary webhook events:
  - `checkout.session.completed`
  - `customer.subscription.created`
  - `customer.subscription.updated`
  - `customer.subscription.deleted`

The VPS environment should keep `STRIPE_EXPECTED_ACCOUNT_ID` set so checkout and portal session creation fail closed if the configured Stripe key belongs to the wrong account. Verify the account in Stripe Dashboard or through the Stripe connector before live billing.

Required environment variables:

```text
STRIPE_ENABLED=true
STRIPE_SECRET_KEY=
STRIPE_WEBHOOK_SECRET=
STRIPE_BASIC_PRICE_ID=
STRIPE_PREMIUM_PRICE_ID=
STRIPE_EXPECTED_ACCOUNT_ID=
STRIPE_API_VERSION=2026-07-29.dahlia
BASIC_MONTHLY_PRICE_CENTS=599
BASIC_FREE_TRIAL_DAYS=30
PREMIUM_MONTHLY_PRICE_CENTS=999
BASIC_WAIVER_CODES=
PREMIUM_WAIVER_CODES=
```

Use the helper below to write Stripe values locally without committing them:

```bash
infrastructure/scripts/save-stripe-secrets.sh
```

The script prompts for Stripe values, then writes them to `.env` with `0600` permissions.

## Customer Billing Management

Stripe-sourced users can open the Stripe-hosted Customer Portal from Profile. The app creates short-lived portal sessions on demand through:

```text
POST /api/v1/premium/billing-portal-session
```

Configure the Customer Portal in Stripe Dashboard before enabling this for live users. Basic-to-Premium upgrades for an existing Stripe Basic subscription should be handled through the portal so Stripe can handle proration and subscription changes instead of creating a second subscription.

## Native App Store Note

Stripe Checkout is appropriate for web subscriptions. Before public iOS or Android monetization, implement the required Apple App Store and Google Play billing flows for in-app digital features and avoid linking native users directly to external Stripe checkout.

## Safety Notes

- Do not create live Stripe products, prices, coupons, or payment links until the account is verified.
- Do not commit Stripe keys or webhook secrets.
- Prefer a Stripe restricted API key with only the permissions this app needs.
- Keep `STRIPE_EXPECTED_ACCOUNT_ID` set in production so a wrong-account key fails closed.
- Verify webhook signatures before processing events.
- Keep subscription entitlement checks server-side.
- Treat macro values from imported or AI-derived recipes as requiring review before nutritional use.
- Consider Stripe Tax and tax registrations before charging a broader public audience.
