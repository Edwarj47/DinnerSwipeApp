# Grocery groups and optional recipe details

## Scope

This release includes grocery grouping, hybrid pantry coverage, optional recipe
details, ignored feedback, and the previously tested recipe/planner UX updates.
No unrelated VPS services are changed. Live database/API deployment is separate
from the requested GitHub push and Android APK build.

## Grocery list

- Current grocery responses retain the flat item list and add `recipe_groups`.
- Recipe sections start expanded and collapse independently. Repeated planned
  uses of one recipe share a section, with ingredient amounts scaled to the sum
  of selected servings. Manual or unmatched items appear under Additional items.
- Shared ingredients reference the same shopping item. Per-recipe amounts are
  shown separately from the combined shopping total; checkmarks and quantity
  edits apply to that shared total, including queued offline grocery edits.
- In Pantry opens two choices: Have enough for this week, or an amount available
  with its unit. Known stock is subtracted once from the combined requirements,
  not once per recipe. Need three onions and have one means buy two.
- Enough coverage is scoped to the current week and recipe requirements. Adding
  another recipe or changing portions requires confirmation again. Moving meals
  between days does not change coverage. Legacy entries keep their old behavior
  until edited; no previously stored stock assumption is silently converted.
- Quantities remain on hand until manually updated; planning does not consume
  them. Common unit aliases match (cup/cups); different units are not guessed or
  converted. Unknown quantities remain flagged for review. Removing pantry stock
  restores requirements and retains unrelated shopping edits and item IDs.
- Client pantry edits require the API's `pantry_coverage_version: 1` capability;
  older servers cannot silently interpret a partial amount as full coverage.
- Regenerate recalculates recipe quantities while retaining manual household
  items and checked states. Unknown ingredient quantities stay unknown rather
  than presenting a partial subtotal as the whole requirement.
- Internal search-link status values are not displayed to shoppers.

## Recipe feedback

- Needs Work has expanded Recipes needing attention and collapsed Ignored
  feedback sections. Ignore keeps the recipe available and keeps its warnings.
- Choices persist per account in existing profile notification preferences;
  old/stale profile updates cannot erase them. No new schema migration is needed.
- Review again restores feedback. Changed quality warnings automatically return
  a recipe for attention; ignoring does not bypass group allergen restrictions.
- Search and incremental loading apply to feedback sections.

## Optional recipe fields

- Manual create/edit, web approval, and AI approval can save a named recipe with
  no ingredients or instructions. Default servings are used unless changed.
- Empty ingredients/instructions become feedback, not save blockers. Names must
  contain at least two non-whitespace characters. Provided invalid serving or
  nutrition values are still rejected. Zero-minute foods are not missing timing.
- Automated extraction retains strict completeness checks before user review.

## UAT

1. Plan two recipes sharing an ingredient and one recipe twice. Verify grouping,
   per-recipe portions, shopping totals, and collapse/expand behavior.
2. Check the shared item; verify it is checked everywhere. Edit its shopping
   quantity; recipe ingredient definitions should not change.
3. With two recipes needing three onions total, select In Pantry and save one
   each. Verify the shared shopping total is two in both sections. Regenerate
   twice and verify no additional subtraction. Then choose enough for this week,
   add another onion recipe, and verify coverage needs confirmation. Remove
   pantry stock and verify full requirements return without changing other rows.
4. Ignore a recipe warning, reopen Needs Work, and expand Ignored feedback.
   Verify the warnings remain, then choose Review again. Use a separate account
   to confirm the first account's choice is not applied to it.
5. Save a title-only manual recipe and approve an incomplete named draft. Verify
   it can be planned, then add ingredients, steps, photo, or nutrition later.

Hybrid pantry requires migration `f20b84e901ac`, following the pending offline
receipt migration `e19a71c042bf`. The client supports older cached flat grocery
responses without exposing internal fields.

## Local verification (2026-10-04)

- Mobile lint, TypeScript, 97 tests, and web export passed.
- API Ruff, mypy, and 117 tests passed; one optional disposable-Postgres test was
  skipped because `OFFLINE_TEST_DATABASE_URL` was not supplied.
- Fixture-only Playwright checks passed at 320x720, 390x844, and 1280x900:
  recipe groups, collapse/expand, combined totals, shared checks, quick pantry,
  ignored feedback, restore, and title-only save. No horizontal overflow or
  browser exceptions; screenshots visually inspected. No customer writes.
- Logs: `/tmp/dinner-grocery-verification.log` (mobile) and
  `/tmp/dinner-grocery-api-verification.log` (API). Preview reuses the existing
  localhost-only static server at `http://127.0.0.1:19010`.
