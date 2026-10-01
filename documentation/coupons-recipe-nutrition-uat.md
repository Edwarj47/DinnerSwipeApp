# Coupons, Recipe Nutrition, and Library Recovery

## Release State

Deployed to the production API/web on 2026-10-01, prepared for Android preview 12. See
`production-billing-readiness.md` for billing checks and remaining launch requirements.
Deploy the API before releasing the new client.
No database migration is needed: nutrition uses `recipe_macro_profiles`; access grants use
the existing subscription expiry and audit tables.

## Coupon Behavior

- Signup paywall and Profile > Account use the same **Coupon code** endpoint.
- Existing privately configured development codes still grant Basic or Premium access.
- Stripe promotion codes represent percentage or fixed discounts. Configure their duration,
  eligible products, expiration, redemption limits, and customer restrictions in Stripe.
  No new live coupons were created by this change.
- For an account without access, Apply opens Checkout with the promotion attached. It does
  not unlock the app merely because a coupon was found. Checkout shows billing terms and
  the final price; existing Basic card-on-file trial behavior remains intact.
- For an existing Stripe subscriber, Apply updates discounts on that subscription without
  creating another subscription or generating a proration invoice. An existing discount
  is not silently replaced. Stripe validates redemption restrictions.
- Free-access grants cannot overwrite an ongoing Stripe subscription. Resolve its billing
  first. Discounts are not applied while a non-billed access grant is active.
- Optional private `ACCESS_COUPON_GRANTS` configuration maps SHA-256 hashes of trimmed,
  lowercase codes to objects containing `tier` (`basic` or `premium`) and `months`
  (1-36, or null for no expiry). Keep real codes and this configuration out of Git.
  A finite grant is redeemable once per account and does not auto-bill at expiry.
- This is not a coupon-management dashboard. Production offers still need private
  configuration and a Stripe sandbox checkout/webhook test before public promotion.

Stripe reference: https://docs.stripe.com/billing/subscriptions/coupons
Lifecycle tests mock Stripe. Live Checkout creation for both tiers was separately verified
through the app's existing credentials, and those sessions were immediately expired. No
real payment or live subscription was changed. A completed-payment test remains outstanding.

## Recipe Nutrition

- Manual recipe entry and AI draft review include optional calories, protein, carbs, fat,
  and fiber. Choose per-serving amounts or whole-recipe amounts; the latter are normalized
  by recipe servings before saving. Nutrition is not guessed by AI.
- Recipe owners can edit nutrition from recipe details. Basic can store recipe nutrition;
  logging and analytics remain Premium features.
- **Log meal** on details and **Log a saved recipe** in Macro Tracker open a searchable
  recipe picker / entry form with date, meal category, portions, notes, and editable totals.
- Fractional portions scale known values. Missing values stay null; zero stays zero.
- Editing a recipe does not rewrite logged history. Changing a logged portion scales that
  entry's stored snapshot, and explicit user overrides take precedence per nutrient.
- Recipe entries flow through the existing daily views, analytics, and exports.

## Library Recovery

- Recipe Library, Hidden Recipes, and Archived Recipes are independently collapsible.
- Search applies to all sections; each section paginates and loads when expanded.
- Unhide restores a personal hidden choice; Restore is restricted to the recipe owner.
- Restoring also clears that recipe's local swipe suppression, not its server-side analytics.
- Archived recipes are distinct from rejected web drafts in the 15-day recycle bin.

## Verification

- API regression suite: 97 passed; strict type checks and lint passed.
- Mobile regression suite: 49 passed; TypeScript, ESLint, and web export passed.
- Playwright with mocked API responses at 320, 390, and 1280 pixels: recipe restoration,
  editing nutrition, fractional portions, whole-recipe normalization, coupon submission,
  and the Macro Tracker recipe picker. Screenshots checked after modal animations settle.
- Final phone checks include a visible, unobstructed nutrition input and a portion increment
  button inside the modal at 320 pixels. Local UI preview: http://127.0.0.1:19010.
- Native APK/device testing and Stripe sandbox integration remain release checks.
