# Future Meal Planning

Weekly meal editing accepts an optional Monday `week_start` query parameter on
the existing personal/group `/weekly-plans/current` routes. Omitting it retains
the original current-week behavior. Current/future selections are editable up to
52 weeks ahead; past selections use the read-only history endpoint. Workouts keep
their existing current/history navigator limits.

Viewing an empty future week does not create a plan or grocery list. The first
explicit write creates that scoped plan. Adds, duplicates, moves, servings,
resets and reorders are bound to the displayed week. Authentication, group-owner
permissions, recipe visibility/safety, date checks and exact reorder validation
still apply. Planning writes are online-only; no fallback writes to current.

Future calendars use date-qualified cache keys and never replace the current
Discover/grocery cache. The last viewed week is retained per account/group in
the signed-in app session, including picker retries and returning to the tab;
sign-out clears this view state. Future personal pickers use All recipes, not
the current-week favorites/planned-picks filter. Future planning does not log
consumption.

Future plans refresh on tab focus, app foreground and the same active-screen
interval as current plans. The calendar's This week shortcut uses the account
or group's authoritative current week, not the phone's potentially different date.

Server-managed `weekly_planning_preplanned_weeks` metadata records weeks with
explicit future writes. Planning ahead never advances the current reset cursor.
On first arrival in a prepared week, its existing meals survive a catch-up reset
and the marker is consumed. Later scheduled resets operate normally. General
profile writes cannot replace this marker; group reset-setting changes preserve
it. Recipe edits refresh affected current/future grocery lists without rewriting
history.

Normal Account opening now leaves child accordions closed. Explicit subscription,
planning and password-reset links retain their intended focused behavior.

## Release Boundary

No database migration is needed. Release the matching **API and worker** planning
code before the web/compatible mobile update: an old worker does not understand
prepared-week markers. Record actual deployment and OTA delivery in the private
release receipt. Preserve Dinner Swipe's isolated data and all unrelated services.

A frontend rollback can retain this backward-compatible backend. Once future
plans have been written, do not roll back to an unaware reset worker: inspect
prepared weeks and arrange a reviewed reset pause or compatible rollback first.
Never restore an old database snapshot over newer user entries as a code rollback.

## Local Verification

November 8, 2026: 729 mobile tests across 66 suites and 1,078 backend tests passed;
10 backend tests were skipped. Mobile/backend lint and type checks, native runtime
contract, whitespace checks and web export passed. Real local API/browser checks
passed at 1440x900, 390x844 and 320x800, including personal/group future additions,
tab/group retention, refocus after an independent group change, and collapsed
settings. External providers were disabled; only disposable SQLite data changed.
Two additional release checks passed against disposable PostgreSQL: concurrent
personal and group additions each created one plan and retained all four meals.
These optional tests are skipped without an explicitly isolated PostgreSQL URL.
Physical-device acceptance remains outstanding.
