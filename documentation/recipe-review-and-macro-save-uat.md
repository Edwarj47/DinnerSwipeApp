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
- The API, worker, and web release is live. Android preview build 22 is queued
  on EAS; the client release remains pending artifact verification. No database
  migration or customer-data maintenance was required.

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

## Production Deployment

- Source commit: `9383c86cfe22584215cd1266cec03f7ad49aa18e`, pushed to `main`.
  [GitHub CI](https://github.com/Edwarj47/DinnerSwipeApp/actions/runs/37509333646)
  passed the backend, frontend, and Docker jobs.
- Release checks passed all 165 API tests and 202 mobile tests, plus lint,
  type checking, cold Jest transforms, and the private-environment secret scan.
  One optional integration test was skipped; separate restored-Postgres smoke
  checks passed below.
- A fresh backup was restored into disposable, internal-network PostgreSQL.
  All 1,487 original rows across 41 tables remained unchanged while fixture
  requests verified bulk review actions, protected profile preferences,
  one-serving recipe creation without duplicate macro logging, aggregate
  minutes, weekly duplication, grocery scaling, and legacy client compatibility.
- API/worker image: `0d19cb2b49e0`; web image: `0ea3ea2e59ec`.
  Public API and web health checks passed. The new feedback endpoint requires
  authentication, and its live OpenAPI contract matches the tested API.
- Candidate and live fixture-only Playwright checks passed phone, desktop,
  tablet, and enlarged-text layouts, including the weekly-card regressions.
  Served HTML and JavaScript match the web image exactly. No live fixture
  writes were made.
- Read-only account snapshots confirmed weekly selections, portions, ordering,
  locks, macro entries, and swipe history were unchanged by deployment. Dinner
  Swipe Postgres, the environment, and all unrelated containers were unchanged.
- Private backup: `backups/releases/20261006T181104Z_preview22`. The database,
  media, environment, and verification records are retained privately.
  Rollback images: `dinner-swipe-api:before-preview22`,
  `dinner-swipe-worker:before-preview22`, and
  `dinner-swipe-web:before-preview22`. Roll back only these application images
  with scoped Compose recreation, not a database restore over new user writes.

## Android Build

- EAS build `faf1b66f-14b9-4798-ae70-a8c4f48d6580` was queued October 6 at
  18:11 UTC from source commit `9383c86`. Standalone preview `0.1.0`, Android
  package `dev.dcss.dinnerswipe`, version code `22`.
- Build completion, APK download integrity, bundled features, and signing
  compatibility have not yet been verified. No installable APK link is confirmed
  at this stage. Android bundle export alone is not an APK.
- [Build status](https://expo.dev/accounts/data-centric-software-solutions/projects/dinner-swipe/builds/faf1b66f-14b9-4798-ae70-a8c4f48d6580).

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
