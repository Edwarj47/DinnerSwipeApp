# Premium Macro Tracker

Dinner Swipe Premium is planned as a `9.99 USD/month` subscription for macro tracking.

## Current Implementation

- Premium entitlement storage is local in `user_subscriptions`.
- Meal confirmations are stored in `meal_macro_confirmations`.
- Macro targets are stored in `macro_profile_targets`.
- Recipe-level macro profiles are prepared in `recipe_macro_profiles`.
- Weekly planned meals can be marked as eaten or skipped.
- Macro totals can use manually provided macro values or reviewed recipe macro profiles.
- Recipes without macro profiles are tracked as unmatched and require review.

## Waiver Codes

The API supports local waiver codes through:

```text
PREMIUM_WAIVER_CODES=
```

Codes are configured only in the ignored VPS `.env`. The raw code is not stored in the database;
only a hash is stored with the subscription record.

The private beta code configured on the VPS is intended for friend/tester use only. Rotate or remove
it before a public launch.

## Stripe Plan

Use Stripe Checkout and Billing for the paid subscription:

- Product: Dinner Swipe Premium
- Price: `9.99 USD/month`
- Checkout mode: `subscription`
- Checkout discounts: promotion codes enabled
- Webhook endpoint: `/api/v1/premium/stripe/webhook`
- Primary webhook events:
  - `checkout.session.completed`
  - `customer.subscription.created`
  - `customer.subscription.updated`
  - `customer.subscription.deleted`

Stripe remains disabled until the connected Stripe account is reauthenticated and verified as the
correct DCSS account.

Required environment variables:

```text
STRIPE_ENABLED=true
STRIPE_SECRET_KEY=
STRIPE_WEBHOOK_SECRET=
STRIPE_PREMIUM_PRICE_ID=
```

The Stripe Dashboard should also have a 100 percent off forever coupon and a customer-facing
promotion code for friend/tester access if this benefit should be managed by Stripe instead of the
local waiver-code path.

## Safety Notes

- Do not create live Stripe products, prices, coupons, or payment links until the account is verified.
- Do not commit Stripe keys or webhook secrets.
- Verify webhook signatures before processing events.
- Keep subscription entitlement checks server-side.
- Treat macro values from imported or AI-derived recipes as requiring review before nutritional use.
