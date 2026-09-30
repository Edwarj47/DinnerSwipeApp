# Guided Tour UAT

Implemented locally September 29, 2026. Not yet published to GitHub, production
web, or an Android APK. Build 10 still contains the previous slide-based tour.

## Behavior

- New users can choose sections or decline the whole tour. Existing completed
  or dismissed tours do not automatically reopen. Account > Replay tour opens
  the section chooser again.
- Each step navigates to the real screen and subview. Contextual callouts sit
  beside the highlighted controls and scroll into view without covering them.
- Try it collapses the explanation without disabling the app. The compact tour
  toolbar keeps Back, Next/Finish, Skip section, End, and reopen-step controls
  available. Navigating away does not force the user back; the step title does.
- The tour covers recipe collection/import, Discover, daily planning, groceries,
  pantry exclusions, preferences, groups, account settings, and Premium macros
  for Premium members. Empty accounts can continue without adding data.
- No recipe, plan, invitation, preference, or billing changes happen just by
  advancing through the tour. User-operated controls retain their real effects.
- Completion/dismissal uses the existing profile onboarding endpoint and version
  `2026-09-29`. A failed save closes the tour anyway and offers Retry. Until a
  retry succeeds, the preference is only suppressed for the current session.
- Tour state resets with the authenticated account. Late requests cannot update
  another account's profile cache. Native Back first collapses the explanation,
  then ends the tour; open native dialogs retain their own Back behavior.

No new dependency, backend update, or database migration is required.

## Checks

- 42 mobile tests pass with a cold transform cache, plus lint and TypeScript.
- New tests cover navigation, section filtering/skipping, Premium gating,
  replay, completion, decline, offline retry, usable controls, and stale saves.
- Playwright covered the actual screens at 1280x900, 390x844, and 320x640,
  plus an empty Basic account. Checked callout positioning, horizontal overflow,
  compact Discover cards, subview restoration, meal/group dialogs, typed inputs,
  and completion/replay. API responses were mocked; no customer data was changed.
- Physical Android/iOS testing remains necessary for touch gestures, safe areas,
  keyboard behavior, and native Back. Production web is unchanged.

## Phone Pass

1. Replay the tour, deselect two sections, and confirm they are omitted.
2. Try a recipe step, change Web to Manual, then tap the tour title. Web returns.
3. Skip Recipes from its first step; Discover opens without the import step.
4. Try a Discover card, open and close its details, and continue to This Week.
5. Open Add meal and close it without selecting. Drag an existing meal only if
   you intend to change its real planned day.
6. Open Grocery/Pantry and Profile subviews. Confirm highlighted controls remain
   usable and the guide can be collapsed, reopened, skipped, or ended.
7. Finish or decline, restart the app, and confirm there is no automatic replay.
8. Disable connectivity before ending. Confirm the app remains usable and Retry
   saves the choice after connectivity returns.
