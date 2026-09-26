# Weekly Planner And Entry Flow

Updated 2026-09-25.

## Entry Flow

- Authenticate first, then confirm subscription access. The plan chooser names
  the signed-in account and offers Switch account.
- Keep the root navigator mounted for legal pages, but do not mount protected
  tabs or issue their API requests before access is confirmed.
- Refresh previously blocked queries after unlocking access.
- A new account can add its first recipe by link or manually, or take the
  optional tour. Persist completion/dismissal on the account. Replay remains
  available from Profile; returning users do not repeat the tour.
- Discover distinguishes loading, failed requests with retry, an empty library,
  a filled week, and an exhausted browsing session.

## Weekly Plan

- Reset replaces the redundant header Groceries link. The Grocery tab remains.
- The fixed Any/Mon-Sun row accepts meals dragged by their handles. Selecting a
  handle and then a day is the keyboard/tap alternative; Edit also retains date
  selection. Dragging outside a target cancels without saving.
- Meals are displayed under their assigned date, in Monday-Sunday order, with
  unscheduled slots first. Multiple meals on one day are allowed; dropping a
  meal never silently replaces another meal.
- Reset requires confirmation. A day's reset clears only slots for that date
  and keeps the date available. Whole-week reset restores Profile's current
  dinner count and servings, with flexible, unlocked, unscheduled slots.
- Reset applies only to the signed-in user's current week. Saved recipes,
  favorites, hidden recipes, other weeks/users, and recorded nutrition remain.
  Historical nutrition entries are detached from reset slots, not deleted.
- Reset regenerates recipe-derived groceries while preserving manually added
  items and checked states for remaining ingredients.
- Discover shuffles all available recipe pages on each visit or Shuffle again,
  keeping the order stable during background refreshes. Current-week recipes
  and hidden meals are excluded. Progress uses the saved plan, not a hardcoded
  five-dinner session counter. Day reset returns just its cleared recipes;
  recipes still planned elsewhere remain excluded.

## Verification

- Mobile unit tests cover deterministic shuffle integrity, targeted return to
  Discover, hidden-choice preservation, and access-unlock regression.
- API tests cover partial updates, per-day/full-week reset, profile defaults,
  repeatability, date bounds, account isolation, preserved nutrition, and manual
  groceries. Adjacent grocery and macro tests were also run.
- Playwright used intercepted API fixtures, not production user data, at
  desktop, 390px and 320px widths. It exercised actual mouse and emulated touch
  dragging, tap fallback, cancellation, failed/successful resets, account
  switching, code unlock, optional tour persistence/replay, and retry states.
- Physical Android/iOS binaries and real Stripe Checkout were not exercised.

## Deployment And Rollback

No database migration or billing/provider change is needed. Only Dinner Swipe
web and API containers are replaced; worker and database stay running.

Previous image tags:

- `dinner-swipe-web:before-onboarding-flow-20260924`
- `dinner-swipe-api:before-week-reset-20260925`

Pre-deployment database backup (local, ignored, mode 0600):
`backups/postgres/dinner_swipe_20260925T191956Z.sql`.

For application rollback, retag those images as
`dinner-swipe-dinner-swipe-web:latest` and
`dinner-swipe-dinner-swipe-api:latest`, then run:

```sh
docker compose --profile production up -d --no-deps --force-recreate dinner-swipe-api dinner-swipe-web
```

The API image reuses the running image's dependency layer with the updated app
source. No production dependency upgrade is part of this rollout. Do not
restore the database backup for a code rollback: that would discard new data.
