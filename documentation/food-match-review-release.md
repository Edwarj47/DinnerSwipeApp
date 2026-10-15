# Meal Matching And In-Place Review

## Changes

- Keep the main food, brand, preparation, quantities and units in the AI extraction.
  Attached toppings stay with their dish; explicitly separate condiments remain separate items.
- A recommendation must match the main food identity, not just a topping or brand.
  Cheeseburgers cannot be replaced by pickles, and waffle fries cannot be replaced by ketchup.
  Standalone pickles and ketchup still work.
- Recognize cheese burger/cheeseburger spellings and fries/French fried potatoes.
  Do not equate waffle fries with waffles or raw foods with explicitly cooked alternatives.
- Inspect up to 20 results in the same search request. If no suitable result exists,
  permit one distinct main-food search per item, capped at three fallback searches per draft.
  Provider failures and quota errors do not trigger retries. All existing budgets still apply.
- Leave uncertain items unmatched for user review, rather than select a known mismatch.
- Change match opens search inside the selected item. Cancel preserves its selection and
  servings; late canceled responses cannot replace them. Search errors stay with the item.

## Boundaries

No saved meal, recipe, target, weekly selection or grocery item is rewritten.
The reported drafts were already discarded, so their original AI output cannot be replayed.
Regression cases use independently authored synthetic foods, not retained provider responses.
Only permitted food/serving identifiers and user-derived labels/portions enter persistent storage.
Provider content remains temporary, with the existing consent and premium checks unchanged.

This release needs no migration, SDK upgrade, APK build, quota change or external service change.
Deployment replaces only Dinner Swipe's API, worker and web containers after verified
database/media backups and rollback image tags are created.

## Verification

- Backend unit/integration tests cover food identity, brand/preparation matching,
  bounded fallback, cancellation, provider failure, identifier-only persistence and no autosave.
- Mobile tests cover inline search placement, per-item replacement, cancel preservation,
  keyboard search, empty/error states and existing voice/calculator behavior.
- Browser review uses a loopback-only synthetic account at 320x720, 390x844 and 1280x900.
- Scoped deployment checks compare protected data fingerprints and unrelated container identities.

Prompt changes follow code-managed instructions and representative examples described in the
[official OpenAI prompt engineering guidance](https://developers.openai.com/api/docs/guides/prompt-engineering).
