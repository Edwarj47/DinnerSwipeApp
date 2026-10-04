# Recipe Editing and Weekly Ordering UAT

## Status

Implemented and tested locally on October 4, 2026. These changes have not been
pushed, deployed, or included in a new Android APK yet.

The new API routes need no new database migration. A deployment of the complete
current branch would also include the separately pending offline-support migration
`e19a71c042bf`; do not apply it implicitly. Follow the Dinner Swipe-only backup,
isolated restore test, and image rollback procedure before production rollout.
No unrelated services or customer records were changed during verification.

## Changes

- Profile > Account ends with the version and native build number (Web on web).
- Green success notices expire after five seconds; repeated notices restart the
  timer. Explicit error alerts and in-progress operations remain visible.
- Recipe details show saving, success, and failure feedback for Plan it.
- Dragging the existing weekly handle above another meal reorders that day's
  meals. Dragging below the last meal moves it to the end. Cross-day moves and
  the existing tap-to-choose-day behavior remain available. Drag release does
  not open the tap chooser.
- Approved and rejected web imports close their review editor after success.
  Approved imports remain in compact history; rejected imports retain the
  existing recycle-bin behavior. Failed actions keep the draft editable.
- Owners can edit their recipes from recipe details, including name,
  description, photo, servings, timing, meal type, difficulty, cuisine, tags,
  source details, ingredients, instructions, and per-serving nutrition. Shared
  and starter recipes offer Customize recipe and Save a copy instead of
  changing another owner's recipe.
- Recipe edits refresh affected current-week grocery lists while retaining
  manual groceries and checked state. Past logged nutrition is not rewritten.

## Verification

- Mobile lint, TypeScript, all 93 Jest tests, and Expo web export passed.
- API Ruff, mypy, and the complete pytest suite passed (one optional test skipped).
- Fixture-only Playwright checks at 320, 390, and 1280 pixels cover real pointer
  dragging, five-second notices, Plan it feedback, full recipe editing, import
  collapse, and the Account version. No customer API writes were made.
- API regression tests cover ownership, validation failure, unchanged-content
  saving, nutrition, grocery refresh, historical confirmations, persistent
  ordering, and rejection of duplicate, missing, or foreign slot IDs.

## Phone Acceptance Checks After Release

1. At the bottom of Account, verify the installed APK's build number.
2. Reset a day and confirm its green notice clears after five seconds.
3. Open a recipe and tap Plan it. Confirm immediate saving feedback followed
   by success, or an actionable error if the request fails.
4. Add two meals to one day. Drag the second above the first, then drag the
   first below the other. Relaunch the app and check that the saved order remains.
5. Tap the drag handle without dragging and confirm the day chooser still works.
6. Approve and reject imports. Confirm the review editor closes only on success.
7. Edit an owned recipe, save, and reopen it. Check all edited fields and the
   grocery list. Customize a starter recipe and confirm the original is unchanged.

Native touch UAT remains pending the next APK release.
