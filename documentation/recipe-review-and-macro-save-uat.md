# Recipe review and macro-to-recipe updates

## Behavior

- Needs Work supports individual Complete and Ignore actions, selection
  checkboxes, and bulk Complete or Ignore for up to 100 selected recipes.
  Select shown selects the loaded results; larger lists use Select first 100.
  Searching clears selection. Failed updates keep the selection for retry.
- Completed reviews and Ignored feedback are separate, collapsed sections.
  Complete records that the user reviewed the feedback; it does not erase
  warnings, fill missing fields, approve unsafe content, or hide the recipe.
  Review again restores attention. Changed warnings invalidate the earlier
  acknowledgement. These choices are private to the account.
- Save as recipe beside Add and Clear saves the macro form's name, meal type,
  notes, and nutrition as a one-serving recipe. It does not log another meal
  or clear the form. Display-unit preferences remain intact and nutrition is
  stored in grams. Zero and unknown values stay distinct. Repeat saves of the
  unchanged form are disabled, as is recipe creation while offline.
- Manual, AI-draft, and web-review forms no longer expose photo URL/path
  inputs. Choose photo, Take photo, image previews, and Remove photo replace
  those fields. Save/approval waits for pending photo uploads. Internal image
  URLs remain in API payloads for image rendering, not visible form text.
- Recipe step numbers use centered, size-adaptive badges rather than fixed
  height text circles, including multi-digit numbers and enlarged text.
- Prep plus cook time determines total time in the editor, API writes, recipe
  responses, and weekly-card metadata. Total is read-only. Combined time must
  not exceed 1440 minutes. Existing total-only recipes keep that value until
  timing is edited; old stored rows are not bulk rewritten.
- Cuisine is removed from the editor while existing cuisine metadata remains
  intact when editing or copying a saved recipe.

## API and release boundary

- New endpoint: `PUT /api/v1/recipes/feedback-preferences`, with `recipe_ids`
  (1-100 IDs) and `action` (`complete`, `ignore`, or `review`). Access checks and
  updates are atomic. Existing single-recipe Ignore requests remain supported.
- `feedback_completed` is added to recipe responses. Completion fingerprints
  use the existing profile JSON, protected against stale general profile saves.
  No schema migration is required; deploy the API before releasing the client.
- Preview build 22 is being released after the checks below. Production rollout
  deploys the API before the client; no customer-data maintenance is required.
  Android bundle export is not an APK; release results are recorded separately.

## Verification (2026-10-06)

- API Ruff and mypy passed. The full API suite passed 165 tests, with one
  optional disposable-Postgres integration test skipped.
- Mobile lint, TypeScript, and all 202 tests passed. Web export and Android
  Hermes bundle export passed.
- Fixture-only Playwright checks passed at 320x720, 390x844, 1280x800, and
  390x844 with enlarged text. Bulk selection/completion, reopening, time
  aggregation, image rendering without visible paths, step badges, and
  macro-to-recipe saves passed without horizontal overflow or clipped text.
  Screenshots were visually inspected. No live API writes were made.
- The broader five-tab UI regression passed at small phone, phone, tablet,
  desktop, and enlarged-text sizes, including wheel scrolling, weekly reorder
  and cross-day dragging, pantry actions, group invites, and guided tour.
- Logs: `/tmp/dinner-recipe-review-full-checks.log`,
  `/tmp/dinner-recipe-frontend-checks.log`, and
  `/tmp/dinner-recipe-review-browser.log`.
- Local static preview: `http://127.0.0.1:19011`.

## Device UAT

1. Select two Needs Work recipes, choose Complete, and expand Completed
   reviews. Confirm warnings remain and Review again restores attention.
2. Enter a beverage and nutrition in Macro Tracker; choose Save as recipe.
   Confirm its one-serving nutrition is in the library and no new log was made.
3. Upload or take a photo in manual, AI-draft, and web review. Confirm the image
   is visible but the storage URL is not. Replace or remove it before saving.
4. Enter prep 10 and cook 20. Confirm total 30 is read-only and remains 30 after
   save. Check an old total-only recipe without editing its time fields.
5. Inspect recipe steps 1 and 12 using normal and enlarged system text.
