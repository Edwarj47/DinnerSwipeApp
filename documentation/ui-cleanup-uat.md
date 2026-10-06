# UI Cleanup UAT

## Status

Implemented and verified locally on October 5, 2026. Release verification for
Android preview build 21 is underway on October 6, 2026. Deployment and artifact
results will be recorded below once verified. The local web preview remains
http://127.0.0.1:19011/week, bound to localhost.

This pass changes frontend presentation only. The previously pending weekly
card behavior and optional servings API changes remain in the worktree. No new
API change, migration, customer-data write, billing configuration, or unrelated
VPS service change was made by this pass.

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

## Native Acceptance

Physical-phone UAT remains pending installation of preview build 21.

1. Check all five tabs at normal and enlarged system text sizes.
2. Open a long-named weekly meal, change portions, and duplicate it to another
   day. Check that the collapsed card still shows only Edit.
3. Drag meals within and between days, including edge scrolling.
4. Confirm Ate and Skipped collapse the editor after saving, with brief feedback.
5. Check grocery boxes, partial pantry coverage, recipe editing, and group invites.
6. Replay the tour and verify callouts and controls remain reachable.
