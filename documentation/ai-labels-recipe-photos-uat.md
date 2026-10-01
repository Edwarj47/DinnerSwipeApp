# AI Nutrition Labels and Saved Recipe Photos

## Status

Implemented and tested locally on 2026-10-01. Prepared for Android preview build 13.
Deployment and artifact verification are pending; the release record will be added below.
Deploy the API before the updated client. No database migration is required.

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
- Physical phone camera/library and label-reading UAT remain necessary after the next APK.
  AI extraction can still make mistakes, so values remain editable before saving.

Implementation references: [OpenAI Structured Outputs](https://developers.openai.com/api/docs/guides/structured-outputs)
and [image inputs](https://developers.openai.com/api/docs/guides/images-vision).
