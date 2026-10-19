# Backend Photo-Credit Handoff

Status: local backend work, 2026-10-19. No deployment, production migration,
enrollment, timer activation, provider requests, or GitHub push was performed.
Mobile, nutrition/rate-limit work, source catalogs, and the media downloader remain
with their respective agents.

## Contract And Preservation

- Optional `photo_credit` contains exactly `text`, `source_url`, `license_url`,
  and `license`. Recipe outputs and candidate review outputs default it to null.
  Meal-plan summaries expose the corresponding `recipe_photo_credit`.
- Credits are read-only projections of verified image evidence, not a rewrite or
  backfill of legacy attribution fields. Unsafe links and incomplete evidence
  produce null. CC BY 4.0 and CC BY-SA 4.0 retain creator/credit text, public source
  and license links, the modification notice, and the share-alike notice where
  applicable. HTML/control characters and private provenance keys are excluded.
- Library lookup matches approved candidate owner, kind, target ID, and canonical
  photo reference. Replacing or clearing a photo cannot reuse its previous credit,
  including after the original credit has been cached.
- There is at most one credit query per owner/kind in a request session, not per
  list item. Unattributed legacy recipes and non-object photos do not query the
  approval table. Legacy workouts with uploaded photos require at most one query
  per owner, and cannot inherit another template's credit for the same image.
- Existing workout snapshots are not backfilled or modified while rendering.
  Shared snapshots retain their original photo and credit after private edits;
  explicit resharing recalculates both. Missing, deleted, or inaccessible workout
  photos do not display credits. Response dictionaries cannot mutate cached data.

## Export Privacy

Campaign export selects only the authenticated owner's campaign, batches, and
candidates. Payloads use explicit nested field allowlists. Media/source URLs,
credits, provenance, provider credentials, storage keys, warnings, worker reports,
lease credentials, and identity hashes are excluded. Export does not mint media
links. The authenticated account-export response now sends `Cache-Control: no-store`.
Export remains available without Basic access/email verification; deletion requests
still retain data for the existing manual review process.

## Verification

- Targeted Ruff and strict mypy: passed for the 12 owned implementation/test files.
- 250 tests passed across `test_photo_credit.py`, `test_content_automation.py`,
  `test_workout_media.py`, `test_workouts.py`, `test_workout_revisions.py`, and
  `test_auth_and_recipes.py`. Log: `/tmp/dinner-credit-verification.log`;
  JUnit: `/tmp/dinner-credit-verification.xml`.
- Final rerun after adding the populated-cache recipe replacement assertion:
  all 34 photo-credit tests passed. Log: `/tmp/dinner-credit-final.log`;
  JUnit: `/tmp/dinner-credit-final.xml`.
- Regression coverage includes optional/legacy responses, approved-owner/photo
  matching, CC BY/BY-SA, unsafe attribution, stale-credit removal, frozen shares,
  query counts for credited and legacy lists, unchanged stored evidence, export
  isolation/redaction, and cache headers. Database tests use isolated SQLite,
  including the existing in-memory migration test, not a production migration.
- This is a targeted regression pass, not a rerun of the prior full API suite or
  a mobile/browser, deployment, or source-fetch verification.

## Remaining Boundaries

- Final integration expanded the eligible registry to 12 recipes and 52 workout
  routines; one proposed photograph was excluded for misrepresenting its dish.
  This does not establish a supply of 175 unique items per type.
- Whole-backend Ruff and mypy now pass. Full backend regression passed 982 tests
  with nine opt-in skips; the final source follow-up passed 113 with one opt-in
  skip. All 574 mobile tests and four browser viewports passed, and the web export
  succeeded. Final logs are under `backups/review-oct19/`.
- Existing dependency/datetime deprecation warnings remain. No runtime scheduler,
  migration, PostgreSQL race test, enrollment, or external license verification
  was run in this pass.
