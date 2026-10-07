# Balanced Mobile UI Polish

Status: implemented, verified and deployed on 2026-10-07. Release 23 combines this
UI pass with the earlier group-planning changes. Deployment and APK evidence is
tracked in [the release record](group-ui-release-23.md).

## Changes

- Preserve the existing colors, branding, routes, permissions and workflows.
  Main settings and group-management content remain visible by default.
- Remove the extra 96px tab-screen footer spacer. The tab bar owns its bottom
  safe area; ordinary screens retain their top safe area, and the tour owns its
  own top inset. Public screens keep their existing spacing.
- Use tighter section spacing without reducing 44px command targets or 48px
  input targets. Long labels can grow instead of being clipped.
- Keep macro target and entry labels visible after values are entered. Nutrition
  fields use two phone columns, with one column for enlarged native text.
  The standalone macro meal type is a dropdown containing all five categories.
- Let segmented controls, metric values and bottom navigation reflow for larger
  text. Navigation reports its actual height and preserves links, tab events,
  selected state and long-press behavior. At standard phone sizes it remains a
  single row; enlarged labels can wrap into additional rows without shrinking.
- Size Discover's image against the measured viewport and card text, leaving
  room for the kitchen selector. Extreme text sizes retain scrolling.
- Use a smaller, 160px logo placeholder in recipe details. Actual photos keep
  their existing aspect ratio, and failed URLs still fall back to the logo.
- Let weekly card headers wrap whole words and retain Edit on collapsed cards.
  Duplicate, portion controls, Ate, Skipped, removal and drag handling remain.
- Shorten grocery quantity labels to Recipe and Buy total without changing
  shared-ingredient or pantry calculations. Group accordion headers have a
  44px minimum target. Calendar weekday headings use two-letter abbreviations;
  date cells have room for enlarged numbers.
- Declare the already-installed React Navigation versions as direct dependencies;
  no package version was upgraded. Offline lockfile verification passed.

## Verification

- Frontend: 222 tests passed across 33 suites. Lint, TypeScript and whitespace
  checks passed. The Node 20 production web export completed successfully.
- Browser fixtures intercepted every API request; no production data was changed.
  Checked all five tabs, recipe details/editors, review, manual entry, pantry,
  group choices, macro views, category/date/summary dialogs and navigation at
  320x720, 360x800, 390x844, 430x932, 768x1024 and 1280x800, plus 150% and 200%
  text at 390x844. No horizontal overflow, clipped text or browser exceptions.
  Calendar, Consumed and weekday labels did not split mid-word.
- A separate 200% text stress pass displayed 10,950,000 calories and 438,000g
  protein in synthetic summary, nutrition and analytics fixtures without overflow.
- Group browser regression passed at 320, 390 and 1280 pixel widths and enlarged
  text: curation/save retry, explicit owner approval, kitchen switching, member
  permissions, personal consumption portions and group-scoped proposals/groceries.
- Mouse-wheel scrolling remained available. A separate desktop regression pass
  verified same-day ordering, cross-day dragging, duplicate placement, icon
  tooltips, grocery checks, pantry dialogs, invitation QR images and guided-tour
  navigation. The recipe fallback images loaded.
- Native unit coverage checks enlarged navigation widths, measured footer height,
  safe-area spacing, tab selection/cancellation, macro dropdown values, persistent
  labels, canonical nutrition units, zero values and photo fallback sizing.
- Production API and web health checks returned OK during the local UI pass;
  that pass did not restart services. The subsequent authorized release changed
  only Dinner Swipe API, worker and web. Unrelated services remained unchanged.

Final browser log: `/tmp/dinner-balanced-browser-final.log`. Web export log:
`/tmp/dinner-balanced-web-export.log`. Screenshots are under
`/tmp/dinner-balanced-*.png`; the desktop regression screenshots use
`/tmp/dinner-ui-*-desktop.png`.
Group and large-value logs: `/tmp/dinner-balanced-group-final.log` and
`/tmp/dinner-balanced-large-values.log`. Final frontend suite log:
`/tmp/dinner-balanced-tests.log`.

## Device UAT

Browser text enlargement is not an Android emulator. For device UAT, check a
physical Android device with large system text, display scaling, gesture
navigation, keyboard open, meal dragging and every dialog. Biometrics and
notification delivery were not changed or device-tested in this pass.

The local preview is `http://127.0.0.1:19011`. The production API and web app are
now deployed; the fixture-based checks do not establish physical-phone behavior
or authenticated production writes. Release followed the backup and rollout
procedure in `group-planning-uat.md`; APK 23 is finished and artifact-verified.
