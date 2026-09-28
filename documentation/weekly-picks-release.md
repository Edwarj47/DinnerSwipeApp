# Weekly Picks And Swipe History

## Behavior

- This Week > Add meal offers **This week's picks** and **All recipes**. Both
  support search and pagination. The picker is not restricted by the Discover
  cook-time preference. Group recipe-sharing pickers keep their existing layout.
- Weekly picks are distinct accessible recipes with a saved Plan or Favorite
  action in the current Monday-Sunday UTC week. Hidden and archived recipes are
  excluded. An undone/removed plan does not qualify, but a separate Favorite does.
- The permanent Favorites collection is unchanged. A prior week's favorite is
  eligible for Discover again, but not automatically a pick for the new week.
- Discover keeps its current session when switching tabs. A change in the
  server's week resets the local deck and random seed. Focus, resume, and a
  focused-screen minute timer refresh the current week. Opening a new app session
  or choosing Shuffle again also allows another pass. Never show stays hidden.
- Undo only reverses a Plan selection, targeting its exact slot instead of
  guessing by recipe name or ID. Moving that meal to another day preserves Undo;
  replacing/resetting it retires the original choice. Nutrition history remains.

## Data And Analytics

- Existing `meal_swipes` records remain the source of history. Each successful
  recipe action records the account, recipe, action, session, and timestamp.
  New clients also send a retry key. The unique account/key constraint and
  account row lock prevent duplicate effects from a retried choice.
- Revision `d8126c4ab391` adds the retry key, associated plan slot, undone time,
  and a user/time index. No historical choices are deleted on weekly rollover
  or reset. Pre-migration records cannot retroactively identify old undos.
- `GET /api/v1/recipes/swipes/summary?week_start=YYYY-MM-DD` returns the signed-in
  account's per-recipe/action counts for that week, including undone counts.
  `add` means Plan. This counts recipe action choices, not arbitrary calendar
  edits, searches, views, or direct Add meal picker operations.
- Account JSON export includes `meal_choices`, without request/session keys.
  Privacy copy discloses choice tracking. No third-party analytics destination
  or cross-account administrator dashboard was added.

## Deployment And Rollback

- Cause of build 7's Not Found: production lacked POST
  `/api/v1/weekly-plans/current/slots`; the APK was newer than the API.
- Fresh backup rehearsal: restored Dinner Swipe data to a network-isolated
  PostgreSQL 16 container, migrated both pending revisions, and exercised add,
  swipe, undo, picks, counts, and groups there. No emails or payments were tested.
- Quiescent production backup:
  `backups/postgres/dinner_swipe_20260928T135701Z_quiescent_week_picks.dump`
  (0600, Git-ignored; its restore listing is alongside it).
- Live API and worker use `dinner-swipe-api:week-picks`. Live database revision:
  `d8126c4ab391`. Public health is healthy; the Add meal route now returns 401
  without credentials instead of 404. Authenticated writes were tested on the
  restored copy, not by modifying a real user's plan.
- Rollback images: `dinner-swipe-{api,worker,web}:before-week-picks`. Prefer
  application-image rollback retaining additive schema. Do not restore an older
  database after new activity without preserving that activity first.
- New picker tabs require a new standalone Android APK; build 7's bundled JS
  does not update from web deployment. No Metro or OTA dependency was introduced.
- Web image `dinner-swipe-web:week-picks` is deployed at `https://dinner.dcss.dev`.
  The owner approved GitHub push and Android preview build 8. Artifact checks
  and the completed build record are tracked in `android-preview-uat.md`.

## Verification

- 51 backend tests, Python lint and mypy (58 files).
- 16 mobile tests, mobile lint and TypeScript checks.
- Playwright with intercepted fixtures at 1280, 390, and 320 pixel widths:
  weekly/all tabs, both search/list states, empty picks, failed add/retry, correct
  day assignment, and fitting modal controls. Screenshots inspected. Repeated
  against the deployed production web bundle with intercepted fixture API data.
- Existing day-drag/edge-scroll, day reset, multi-meal, group create/invite/join,
  and account-settings browser regressions also passed at all three sizes.
- PostgreSQL backup/upgrade and endpoint smoke checks passed before live rollout.
- Physical Android gestures and the next APK remain device UAT work.
