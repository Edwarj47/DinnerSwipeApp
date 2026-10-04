# Beverages

## Behavior

- Beverages appears beside Breakfast, Lunch, Dinner, and Snack in both daily
  macro entry and recipe-based logging, including editing existing entries.
- Manual recipes, AI draft review, recipe editing, and web draft review offer a
  meal-type picklist with Beverages. Imported custom categories remain selectable.
- Recipe library, detail sheets, and Discover cards display the category as
  Beverages. Beverages can be planned and shared like other recipes.
- The stored value is `beverage`. Recipe and macro inputs also accept the aliases
  `beverages`, `drink`, and `drinks`, case-insensitively.
- AI drafts can return `beverage`; the prompt explicitly uses it for drinks,
  smoothies, shakes, coffee, and tea. Nutrition extraction rules and model
  fallback behavior are unchanged.
- Web structured data handles a string or list of categories and recognizes
  drink/beverage labels. Unknown categories are preserved rather than rejected.
- Portion scaling, daily totals, analytics, exports, and existing offline macro
  synchronization retain beverage entries without special calculations.
- No new database migration, pricing change, or automatic reclassification of
  historical recipes is required. Existing drinks saved as Snack can be edited.

## Acceptance Checks

1. Create a name-only tea recipe, choose Beverages, save, and reopen to edit it.
2. Generate an AI drink draft and confirm that Beverages is retained during review.
3. Fetch a web drink recipe; choose Beverages before approving the draft.
4. Log a beverage manually, then edit it without changing its category.
5. Log a saved beverage at 1.5 servings and verify the scaled nutrition, then
   override one value and save. Check the daily totals and exported entry.
6. Share and plan a beverage recipe; confirm the private original stays in place.
7. Verify Snack, Dessert, Sauce, and a previously imported custom category still
   work. Check narrow-phone and desktop layouts for wrapping and scrolling.

These changes are local until the API and updated clients are released. No live
AI call, live recipe modification, provider change, or APK build is required to
run the isolated automated checks.

## Local Verification (2026-10-04)

- Backend: 136 tests passed; one existing test skipped. Ruff and mypy passed.
- Frontend: 125 tests passed across 25 suites with a cold cache. ESLint,
  TypeScript, and the web export passed.
- Playwright: 320x720, 390x844, and 1280x900 viewports passed using isolated
  mock API responses. Checked the category picker, manual creation, recipe
  editing, web draft approval, display labels, daily macro creation/editing,
  recipe-based logging at 1.5 servings, scrolling, and no horizontal overflow.
- Backend integration checked sharing, planning, nutrition overrides, and
  analytics export with the canonical beverage category. AI classification
  was checked against its schema and fixtures, not a live OpenAI request.
- No production service, migration, GitHub push, or APK release was performed.
