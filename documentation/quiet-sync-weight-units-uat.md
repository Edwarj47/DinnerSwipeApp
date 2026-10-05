# Quiet Sync, Weight Units, and Summary Help

## Scope

Client-only changes. No API schema, database migration, or billing configuration
change. Prepared for web deployment and standalone Android preview APK 19;
release verification is recorded below once complete.

## Behavior

- Normal checkbox sync does not show a banner. An unresolved outbox or offline
  state shows a notice after 10 seconds and clears on recovery. More checkbox
  taps and screen changes do not restart the delay. Conflicts and local storage
  failures remain visible immediately because they require user action.
- Profile > Account > Account Settings > Measurement units contains independent
  gram/ounce choices for protein, carbs, fat, fiber, and ingredient weights.
  Choices save to the account's existing Profile preferences and are available
  across devices. Missing or unsupported choices default to grams.
- Entry forms use the saved choices automatically. The inline selectors and
  "As added" option have been removed, including from Amount available.
- Saving a choice updates only Profile preferences, not existing recipe or macro
  nutrition. Nutrition and macro payloads and exports remain in grams; calories,
  blanks, zero values, and whole-recipe/per-serving normalization retain their
  meaning. A failed preference save keeps the last saved choice and shows an error.
  Retrying rechecks connectivity when the app has marked the device offline.
- Known ingredient weights can show an equivalent below the original recipe
  wording. Supported weight units include g, kg, oz, lb, and their common names.
  Cups, fluid ounces, milliliters, item counts, and unstructured text are not
  converted. No ingredient density is guessed.
- Pantry input and grocery quantity steps convert back to their original stored
  unit. For example, 2 oz entered for a gram-based item saves 56.69904625 g.
  Existing backend rules for ingredients stored in different units are unchanged;
  this does not introduce cross-unit pantry aggregation.
- The summary-days popup explains that totals cover the chosen number of days
  ending today, with 1 showing today only. Existing account persistence and the
  1-3650 whole-day limit are unchanged. Its helper text is: "Choose how many days
  to show, including today. Enter 1 for today only."

## Verification

- Lint, TypeScript, 168 mobile tests in 29 suites with a cold Jest cache,
  web export, and diff whitespace checks passed.
- Browser checks used a mock account and intercepted every API request. No live
  customer writes were performed.
- Chromium checks passed at 320x720, 390x844, and 1280x720: account preference saves
  and retry after a failed save, persistence after clearing browser storage,
  mixed-unit recipe/macro views, canonical nutrition and pantry payloads,
  volume-unit preservation, ingredient equivalents, and summary helper layout.
- The pantry popup is bounded and scrollable in a reduced-height viewport.
- Existing browser regressions passed: bounded weekly mouse-wheel scrolling,
  within-day drag ordering, default recipe logos, custom summary persistence,
  and desktop scrolling on all five main pages.
- Local logs: `/tmp/dinner-quiet-sync-checks.log`,
  `/tmp/dinner-measurement-browser.log`, `/tmp/dinner-ux-regression.log`.
- Current screenshots:
  `/tmp/dinner-measurements-{settings,pantry,nutrition,summary}-{small,phone,desktop}.png`.
- The earlier real-outbox browser check verified silent fast sync and a notice
  only after ten seconds for a held update, clearing on recovery:
  `/tmp/dinner-quiet-sync-browser.log`, `/tmp/dinner-quiet-sync-delayed.png`.

## Phone UAT After Release

1. Check several groceries on a normal connection: no sync banner should flash.
2. Leave an edit unsynced for more than 10 seconds, then reconnect. Verify the
   notice appears, pending edits remain available, and the notice clears.
3. Set protein to ounces and carbs to grams in Account Settings, then save a
   recipe and a manual macro entry. Verify each field follows its own choice,
   calories do not change, and blank versus zero nutrient values stay distinct.
4. Enter partial pantry stock in ounces for a gram-based item and verify the
   remaining grocery amount. Confirm cups and counted items remain unchanged.
5. Restart the app or sign in on another device and verify the saved choices.
6. Open summary days with the Android keyboard visible and verify the helper,
   input, validation message, and Apply button remain accessible.

Physical Android keyboard and connectivity checks remain pending until a new
APK is built and installed. A separate release must push the code, deploy the
web client, and build/verify a new APK; no backend deployment is required.
