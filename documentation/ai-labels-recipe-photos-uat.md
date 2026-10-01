# AI Nutrition Labels and Saved Recipe Photos

## Status

API and web deployed on 2026-10-01 from source `394ceab`. Android preview build 13
finished and its downloaded artifact is verified. No database migration was required.

## Changes

- The AI draft contract now includes optional nutrition and its per-serving/whole-recipe
  basis. Review initializes those fields from the draft, preserving null and zero values.
  Whole-recipe amounts normalize to per-serving amounts when the user saves.
- Extract only stated calories, protein, total carbohydrate, total fat and fiber. Do not
  confuse gram amounts with percent daily values or estimate nutrition from food appearance.
- Readable packaged-food labels are valid inputs. Ready-to-eat items do not need an invented
  cooking recipe. Serving size is included in the description when visible.
- The existing configured model and approved fallback chain are unchanged. Input photos
  still are not saved as recipe photos automatically, and monthly draft limits are unchanged.
- Saved recipe details include Add photo / Change photo for the owner. Camera and library
  selection upload directly to `PUT /api/v1/recipes/{recipe_id}/photo`. Existing size/type
  checks and storage adapters are reused. Failed uploads retain the previous photo.
- Recipe and weekly-plan queries refresh after an upload. Success messages expire after
  3.5 seconds. Photos are displayed without cropping; nutrition and recipe attribution remain
  unchanged. Replaced media files are not deleted by this change.
- OpenAI processing disclosure is in both Privacy and Terms, not repeated on the AI form.
  The form retains a short review reminder. Legal pages and new signup acceptance use
  version `2026-10-01`; existing acceptance records are not rewritten.

## Verification

- Live, single-request extraction using the supplied label and configured `gpt-5.4-mini`:
  1 shake (11 fl oz), 160 kcal, 30 g protein, 4 g carbs, 3 g fat, 2 g fiber, per serving.
  No database writes or changes to the user's generation allowance were made by this test.
- 104 API tests and 54 mobile tests passed. Ruff, mypy, ESLint, TypeScript and web export passed.
- Browser checks with mocked accounts at 320/390/1280 pixels: AI label review and save,
  photo upload failure/retry/reopen, and Privacy/Terms content. Screenshots inspected.
- Server tests cover ownership, authentication, size/type rejection, photo replacement and
  nutrition preservation. Mobile tests cover camera cancellation, retry, cache invalidation,
  transient success notices, whole-container normalization and old drafts without nutrition.
- Physical phone camera/library and label-reading UAT remain necessary with APK 13.
  AI extraction can still make mistakes, so values remain editable before saving.

Implementation references: [OpenAI Structured Outputs](https://developers.openai.com/api/docs/guides/structured-outputs)
and [image inputs](https://developers.openai.com/api/docs/guides/images-vision).

## Deployment Record

- Source `394ceab` pushed. [CI 36900357332](https://github.com/Edwarj47/DinnerSwipeApp/actions/runs/36900357332)
  passed backend, frontend (including cold-cache mobile tests), and Docker jobs.
- Fresh private backup: `backups/releases/20261001T173224Z_preview13`. Full restore
  into an isolated temporary database passed. Schema remains `d8126c4ab391`.
- Active API image `6fe1c7aab487`, web `df5d9859bf00`. Retained prior images:
  `dinner-swipe-api:before-preview13` and `dinner-swipe-web:before-preview13`.
- Live health, AI nutrition schema, and anonymous photo-upload/AI-usage rejection passed.
  Production web passed mocked-account browser checks at 320/390/1280 pixels for label
  review/save, photo failure/retry/reopen, and legal pages. Screenshots inspected.
- Only API and web containers changed. Database, worker, and all unrelated service IDs,
  image IDs and start times are unchanged. The environment file is byte-identical to the
  pre-release copy. No Stripe configuration or customer data was changed by release checks.
- Android build `78059c0e-b313-4ded-9f30-417a60714502` finished October 1 at 19:37 UTC
  from `394ceab`. Its initial 45-minute monitor expired while queued; a fresh EAS read
  confirmed completion and the downloaded APK was verified at 22:59 UTC.
- Download, ZIP integrity, embedded package/version, production API URL and new-feature
  bundle checks passed. Package `dev.dcss.dinnerswipe`, version code `13`; signing
  certificate matches build 12. Size 79,540,743 bytes. SHA-256:
  `738badb7a820ad44a87a5b40757e7f8d5835fe076afdaa26ec407ac0f83fba12`.
  The direct download link is shared privately. This standalone APK does not need Metro.

Rollback needs no database restore. From the repository root:

```bash
docker tag dinner-swipe-api:before-preview13 dinner-swipe-dinner-swipe-api
docker tag dinner-swipe-web:before-preview13 dinner-swipe-dinner-swipe-web
docker compose --profile production up -d --no-deps --no-build --wait dinner-swipe-api dinner-swipe-web
```
