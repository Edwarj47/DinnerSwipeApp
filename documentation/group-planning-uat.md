# Group Planning

Implementation status: complete, pushed and deployed in release 23. The new
Android APK is finished and artifact-verified; deployment evidence is tracked in
[the release record](group-ui-release-23.md).

## User Flow

- Discover, This Week and Grocery share the account's selected kitchen. The
  searchable bottom-sheet picker shows My Kitchen and joined groups, with roles.
  Selection is saved through the existing household switch API.
- A group's Shared recipes list contains only recipes created in that group or
  explicitly shared with it. Sharing does not automatically enable Discover.
- Owners curate Discover choices with search, individual selections, Select all
  matches, Clear and Save. Off-search choices and failed-save selections survive.
  New and existing groups start with no enabled choices; private plans stay intact.
- Owners swipe Plan into the group's Unscheduled list. Members swipe Propose.
  A recipe has one proposal per group/week with separate requesting members.
  Yes/Maybe/No votes never approve a meal automatically.
- Pending proposals show explicit owner Approve/Decline controls. Approval asks
  for the day and total group servings, then creates one shared-calendar entry.
  Direct owner planning also resolves a pending proposal for that recipe.
  Approved and Declined sections start collapsed.
- Request another recipe accepts any approved shared recipe. Approving an extra
  request does not enable it for Discover. Group safety restrictions still apply.
- Only owners add, move, duplicate, reorder, remove and reset shared-week meals.
  Members can view them and log their own Ate/Skipped entries with Premium.
  Personal consumption starts at one portion, not the total group serving count.
- Group groceries and pantry are editable by group members. The existing hybrid
  pantry calculations use only that group's stock. My Kitchen stock never covers
  a group's grocery requirements. Nutrition entries always remain personal.
- Each group has independent weekly reset settings, defaulting to manual carry.
  Automatic reset follows the group's configured time zone and reset day.
  Members have their own group-reminder opt-out; phone reminders fire at 9 AM in
  the phone's local time. Manual-only groups schedule no reminder.

## Isolation And Recovery

Group calendar, grocery and pantry paths carry an explicit household ID. In-flight
actions retain their original destination even if the visible kitchen changes.
Discover history, planner queries and offline grocery queues are scoped by kitchen;
personal macro queues are not assigned to a group. Membership and owner permission
are checked again on the server, including receipt replay and ownership changes.

Group groceries support revision-checked, idempotent offline edits. Group calendar,
curation, proposals, votes, pantry and group switching require network access.
Cached group reads follow the existing bounded offline subscription grace. A
successful membership refresh removes cached content for departed groups.

The foreground week, group deck, group groceries and proposals refresh periodically.
Loading or failed kitchen resolution cannot fall back to editing a personal plan.
Reset/removal detaches historical macro entries without deleting logged nutrition.

## Migration And Release

Alembic revision `a8f97b321c40` follows `f20b84e901ac`. It adds explicit group
calendar/grocery/pantry scope, group planning settings, Discover choices and
proposals. Existing personal rows retain their user ID with a null household ID;
no private calendar is copied into a group. New scope checks require exactly one
of a user or household owner. Group/week and proposal uniqueness are enforced.

`bash infrastructure/scripts/verify-group-migration.sh` takes a private,
Dinner Swipe-only backup, restores it into a disposable localhost PostgreSQL 16
container and rehearses the upgrade. It fingerprints every original column/row
and verifies preservation and empty new group tables. The disposable container
is removed on completion. Backup artifacts are ignored by Git and use restrictive
permissions. The rehearsal preserved 1,494 legacy rows across 40 tables on
2026-10-07 before release. The authorized live migration later passed the same
preservation checks; see the release record.

Before an authorized release, take a new verified Dinner Swipe-only backup and
retain the currently running API, worker and web images. Apply the additive
migration before deploying the API and new clients. Keep unrelated VPS services,
databases and routes unchanged. Older APKs still use legacy personal-planner paths.

Rollback uses the retained application images with the additive schema intact.
Do not downgrade or restore an old database after new group activity; this migration
deliberately refuses destructive downgrade. Export new activity before any recovery
that would replace database contents. A new APK is required for these UI changes.

## Verification

- Group implementation checks on 2026-10-07, before the combined UI release:
  173 API tests passed; the two opt-in
  PostgreSQL tests passed separately; 214 frontend tests passed across 32 suites.
  API Ruff/mypy and frontend lint/typecheck passed. The production web export
  succeeded. The combined release later passed 222 frontend tests and deployed
  the API and web. Android build 23 is finished and artifact-verified.
- API coverage includes default-disabled choices, shared-library/safety boundaries,
  idempotent member proposals, individual withdrawal, explicit approval, independent
  group reset/time-zone boundaries, personal reminders, ownership transfer, isolated
  pantry calculations, personal macro portions and offline receipt membership checks.
- Frontend coverage includes curation/retry, off-search selections, searchable
  kitchen switching, member read-only controls, captured proposal destinations,
  kitchen-specific Discover history, group reminders and offline grocery isolation.
- Browser checks use intercepted fixtures, not production mutations, at 320, 390
  and 1280 pixel widths plus larger text. All four passed curation/retry, explicit
  approval, kitchen switching, member permissions/personal portions, scoped
  proposals, grocery selection, mouse-wheel scrolling and layout checks. Recipe
  fallback images loaded without browser errors. The local static UI preview is
  on port 19011. These fixture checks did not exercise real account writes.
  The API was subsequently deployed with release 23; see the release record.
- Physical Android gesture handling and notifications remain device UAT checks.

Local logs: `/tmp/dinner-group-api-final.log`, `/tmp/dinner-group-ui-final.log`,
`/tmp/dinner-group-web-export.log`, `/tmp/dinner-group-browser-final.log` and
`/tmp/dinner-group-migration.log`. Browser screenshots are under
`/tmp/dinner-group-{choices,approval,member-week,discover,grocery}-*.png`.

`bash infrastructure/scripts/verify-group-concurrency.sh` runs two opt-in tests
on a fresh disposable PostgreSQL database on localhost port 15413. It refuses
an occupied port and removes its own test container afterward. Both tests passed:
legacy receipt atomicity plus concurrent group requests/approval/grocery retries,
with foreign-key-safe reset preserving personal macro history. The receipt test
also retains the pre-group downgrade check before installing the additive revision.
Personal receipt hashes retain the old format so an older APK's acknowledged
operation can be retried after deployment. Log: `/tmp/dinner-group-postgres.log`.
