# UI Cleanup UAT

## Status

API, worker, and web deployed on October 6, 2026 from source `cc41224`.
[CI 37395246990](https://github.com/Edwarj47/DinnerSwipeApp/actions/runs/37395246990)
passed all three jobs. Android preview build 21 finished and passed artifact
verification. Web is live at https://dinner.dcss.dev.

The presentation pass is frontend-only. This release also includes the previously
pending weekly card behavior and optional servings API field. No schema migration,
billing configuration, customer-data maintenance, or unrelated service change was
required.

## Presentation

- All five tabs use 28px page headings and opt into a centered 960px maximum
  content width. Phone layouts stay full-width. Screen scrolling and tour
  reveal behavior retain their existing owners.
- Related controls use tighter spacing, while sections retain clear separation.
  Profile sections use headings and dividers instead of nested framed panels.
- Weekdays remain visible, including empty days. Empty rows have an 80px
  minimum height, 12px day gaps, and one divider. Dates sit beside weekdays
  when space permits and wrap otherwise.
- Collapsed meals retain only Edit. Duplicate remains beside the serving +
  inside the editor. Serving controls share one outline; Ate stays primary,
  Skipped is quieter, and Remove is an accessible trash icon at the right.
- At 320px or with enlarged phone fonts, meal photos and drag handles share
  a narrow column so long meal names have space to wrap by whole words.
- Grocery checkboxes have a 44px click target around a 26px visual checkbox.
  Pantry actions, review warnings, quantities, and recipe grouping remain.
- Recipe lists use consistent thumbnails and tighter spacing. Long names,
  warnings, and recipe-detail action labels can wrap instead of being clipped.
- Discover uses a labeled, icon-only Undo control. Swipe logic is unchanged.
- Shared Button adds opt-in quiet and quiet-danger variants. Existing variants
  and defaults remain unchanged. Web buttons have native browser tooltips.
- Forms retain 48px minimum inputs; shared buttons and segmented controls retain
  at least 44px touch targets. Success notices still expire after five seconds.

## Verification

- Mobile lint, TypeScript, all 194 tests in 31 suites, Expo web export, and
  git diff whitespace checks passed.
- Fixture-only Playwright checks passed at 320x720, 390x844, 768x1024, and
  1280x800, plus 390x844 with text enlarged to 125 percent. All five tabs,
  recipe details/editors, pantry dialogs, group invitations, and macro views
  were checked for horizontal overflow and clipped text.
- Actual browser gestures verified same-day reordering and cross-day moves.
  Additional weekly checks verified duplication destinations and portions,
  Basic/Premium access, logging outcomes, failed-action retries, five-second
  feedback, and mouse-wheel scrolling at phone and desktop widths.
- Replay tour opened Discover and This Week with visible in-flow callouts;
  Try it, reopening the callout, and ending the tour remained functional.
- Screenshots and logs are local under /tmp/dinner-ui-*.png,
  /tmp/dinner-ui-cleanup-checks.log, and /tmp/dinner-ui-cleanup-browser.log.
  All browser API requests were intercepted; no customer records were changed.

## Weekly Actions

- Duplicate copies the saved recipe and serving count to any weekday or
  Unscheduled. It leaves the original meal in place, recalculates groceries,
  and does not copy consumption, swipe history, or a legacy lock.
- Ate logs nutrition for the assigned day, or today for an unscheduled meal.
  Skipped records a skipped meal with zero nutrition; it does not undo an
  earlier Ate entry. Remove clears the planned meal but retains logged nutrition.
- Successful Ate, Skipped, Remove, and Duplicate actions collapse the editor.
  Success notices expire after five seconds. Failed actions remain open for retry.
- The unused Meal/Leftovers/Out/Flex selector and Keep lock controls are removed
  from the editor. Existing legacy slot types and lock values are preserved.
- Add-slot accepts optional servings from 1 through 30. Older clients that omit
  servings retain the existing account-default behavior.

## Deployment Verification

- Release checks passed 153 backend tests with one existing skip, 194 mobile
  tests in 31 suites using a cold transform cache, lint, mypy, TypeScript,
  web export, a private-environment secret scan, and whitespace checks.
- Fresh backup restored into disposable, internal-network PostgreSQL. All 1,469
  original rows across 41 tables remained unchanged while fixture requests tested
  duplication, portions, dates, grocery scaling, invalid requests, legacy clients,
  and Ate/Skipped/Remove history. No provider calls or live fixture writes occurred.
- Candidate and live Playwright checks passed the viewports and workflows above.
  Served HTML and JavaScript matched the deployed web image exactly.
- API/worker image `110ea3873a8f`, web image `8ff9892fa777`. Public health,
  anonymous route protection, and the live optional-servings contract passed.
- Read-only account snapshots confirmed weekly meals, portions, order, locks,
  nutrition entries, and swipe history were unchanged by deployment.
- Dinner Swipe Postgres, the environment, and all unrelated containers were
  verified unchanged. Private backup: `backups/releases/20261006T004045Z_preview21`.
  Database, media, environment, source, verification records, and rollback images
  are retained. Backup checksums passed.
- Rollback tags: `dinner-swipe-api:before-preview21`,
  `dinner-swipe-worker:before-preview21`, `dinner-swipe-web:before-preview21`.
  Restore these service images with scoped Compose recreation, not a database
  restore over new customer writes.

## Android Artifact

- EAS build `628c2747-ecae-4b41-91d1-00528fef6f83` finished October 6 at
  00:51 UTC from `cc41224`. Standalone preview `0.1.0`, package
  `dev.dcss.dinnerswipe`, Android version code `21`; no Metro server is required.
- Download length, ZIP integrity, embedded package/version, production API URL,
  and bundled weekly-action/settings checks passed. The signing certificate
  matches build 20. Size: 79,669,479 bytes. SHA-256:
  `e2292ac59510a04eb7c2afdda42ce56b899fbc927216082085ccb9fdb3ab812f`.
- Install over build 20 to preserve local session data. The direct link is shared
  privately. Physical-phone installation and native gesture UAT remain pending.

## Native Acceptance

Physical-phone UAT remains pending installation of preview build 21.

1. Check all five tabs at normal and enlarged system text sizes.
2. Open a long-named weekly meal, change portions, and duplicate it to another
   day. Check that the collapsed card still shows only Edit.
3. Drag meals within and between days, including edge scrolling.
4. Confirm Ate and Skipped collapse the editor after saving, with brief feedback.
5. Check grocery boxes, partial pantry coverage, recipe editing, and group invites.
6. Replay the tour and verify callouts and controls remain reachable.
