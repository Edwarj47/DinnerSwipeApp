# Group Recipe Sharing

## Scope

Profile > Group > select a shared group > Share recipes opens a searchable,
scrollable checklist of the user's own saved recipes. Sharing adds group access;
it does not move, duplicate, or remove the private original.

- Select individual recipes, several recipes, or all recipes.
- With a search active, Select all applies to every matching recipe, including
  results not yet loaded. Deselect individual matches to exclude them.
- Individual selections stay selected while searching. Changing a search clears
  a search-wide Select all selection.
- Already shared recipes remain visible and cannot be selected again.
- Hidden owned recipes can be shared without unhiding the owner's copy.
- Archived and unapproved recipes are excluded.
- Sharing is available to verified Basic and Premium members of the destination
  group. Existing tier limits on joining and creating groups remain unchanged.
- Group members cannot re-share another user's recipes through this picker.
- Nothing is shared until Share is pressed. Errors retain the selection for retry;
  successful feedback disappears after five seconds.
- After a connection failure, pressing Retry, More recipes, or Share again uses
  the existing reconnect flow before sending the request. Sharing is not queued
  offline.

## API

- `GET /api/v1/households/{id}/recipes?q=&limit=30&offset=0` returns paginated
  options, the complete matching count, and the complete already-shared count.
- `POST /api/v1/households/{id}/recipes/share` accepts either `recipe_ids`, or
  `select_all: true` with optional `q` and `excluded_recipe_ids`.
- Explicit selection and exclusions are capped at 500 IDs. Select all can share
  a larger library without collecting every ID on the client.
- Requests are atomic and idempotent. Membership and recipe ownership are
  revalidated, and the destination group and recipe rows are locked before saving.
- The existing single-recipe sharing endpoint remains compatible.
- This feature requires no new database migration. Both the API and client must
  be released together; a local implementation does not update the live APK.

## Acceptance Checks

1. Use a verified account belonging to two shared groups and a private kitchen.
2. Select the first shared group and open Share recipes. Verify the correct group
   name, search, thumbnails, and already-shared state.
3. Select two private recipes, search for another, and share. Only the explicit
   selections should appear for a second member of that group.
4. Open again, select all, deselect an exception, and share. Include a library
   larger than one loaded page. Repeating the request must create no duplicates.
5. Search, select all matches, then change the search. Selection should reset.
6. Switch to the second group. Previous selections and sharing state must not leak.
7. Confirm private originals remain editable and hidden recipes remain hidden
   for their owner. The private kitchen should not offer sharing to itself.
8. Simulate offline access, load failure, and failed sharing. Verify retry works,
   selections survive a failed share, and there is no false success notification.
9. During sharing, prevent extra requests, closing, and selection changes.
10. Check a narrow phone, a larger phone, and desktop: no text overlap, scrolling
    recipe rows, a visible footer, and feedback that clears after five seconds.

## Local Verification (2026-10-04)

- Backend: 136 tests passed; one existing test skipped. Ruff and mypy passed.
- Frontend: 125 tests passed across 25 suites with a cold cache. ESLint,
  TypeScript, and the web export passed.
- Playwright: 320x720, 390x844, and 1280x900 viewports passed with isolated mock
  API responses. Checked real photo rendering, search, selection across unloaded
  pages, deselection, scrolling, failed sharing and reconnect/retry, group changes,
  the fixed footer, five-second feedback, and no horizontal overflow.
- No live recipes were shared, no production services were restarted, and no
  migration, GitHub push, or APK release was performed for this feature.
