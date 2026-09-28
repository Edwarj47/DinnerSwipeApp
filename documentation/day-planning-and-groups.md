# Day Planning And Groups

Updated 2026-09-28. Source commit `415d210` is pushed and Android preview build 7
is complete. The production migration and API/web deployment are still pending
owner approval; the APK's new group and day-specific add features need that rollout.

## Weekly Planning

- Monday through Sunday are full drop areas with Add meal actions. Unscheduled
  meals appear last. Multiple meals can share a day without replacing each other.
- Drag by the handle; the list scrolls near its edges. Tapping the same handle
  opens an accessible day picker. An unsuccessful drop makes no request.
- The header Reset still resets the whole week after confirmation. Each occupied
  day also has its own confirmed reset. Edit > Remove removes just that meal.
- Add, edit, remove and reset refresh recipe-derived groceries, preserving manual
  items and checked states. Replaced or removed meals are detached from historical
  nutrition entries; logged nutrition is not erased.
- Reset/Remove returns recipes to Discover. A recipe still planned on another
  day stays excluded until its final planned instance is removed.

## Accounts And Groups

- Enable Biometrics has no explanatory subtitle in sign-in/sign-up or Profile.
- Account deletion is under Profile > Account > Data and legal > Delete account.
  The existing password/DELETE confirmation and manual-review behavior remain.
- Every account has a private kitchen. Basic can create or join one shared group
  in addition to that kitchen. Premium can create or join unlimited shared groups.
  Capacity checks run on the server and serialize concurrent create/join requests.
- Existing memberships are retained after a downgrade; additional create/join
  requests are blocked at the Basic limit. No group or recipe is deleted on downgrade.
- Group selection affects shared recipe discovery and voting, not the user's
  personal weekly plan or nutrition history.
- Recipes added with a shared group active belong to that group. Existing private
  recipes are not automatically shared: members can explicitly share their own
  recipes into one or several groups.
- Votes are keyed by group, week, member and recipe. Ownership changes do not
  move or erase the group's votes. Voter details remain owner-only.
- Owners can share a link/code/QR, reset invitations, change safety settings and
  transfer ownership with confirmation. Members can leave; owners must first
  transfer ownership if others remain. Shared recipes remain in the group.
  Joining, resetting invitations and leaving serialize against the same group
  record so an invitation cannot race with the last owner leaving.
- Invite links lead to `/join?code=...`, then the existing authentication and
  subscription gates. Joining requires a verified email and explicit confirmation.
  The preview exposes the group name/member count, not member emails. Failed or
  revoked invitations give a readable error. Invite lookup/join are rate-limited.
- QR images are generated locally using qrcode-generator, not an external service.
  Links stay valid until reset or the last member leaves. No invitation email is
  automatically sent; Share opens device sharing (or copies the link on web).
- Web invitation pages offer a `dinnerswipe://join` app link after authentication.
  Automatic HTTPS Android App Links / iOS Universal Links are not configured.

## Migration And Release

New Alembic revision: `ca92e654710b` (after `0db143da7f75`). It adds a private-space
flag, group-specific votes and recipe shares. Existing solo auto-created spaces
become private; users without one receive a new private kitchen. Existing shared
groups keep their membership and active selection. Solo starter invitations
should be replaced by invitations from a newly created shared group.

Legacy votes remain intact. Only unambiguous owner/group mappings are copied;
ambiguous legacy records need manual review, not guessed attribution.

Before deploying, take and verify a Dinner Swipe-only database backup and retain
the current API/web image tags. Apply the migration, then deploy API and web, and
build a new standalone Android preview APK. No EAS Update configuration exists,
so the installed APK will not receive these client changes automatically.

Rollback: prefer application rollback with the added schema retained. New group
records will not appear in the old UI. Do not restore an old database or downgrade
after new group activity without preserving that activity first; downgrade drops
the new vote/share tables. Neither rollback nor migration should touch unrelated
VPS services, PostgreSQL databases, or reverse-proxy routes.

## Verification

- API tests cover day-specific adds, multiple meals beyond the weekly goal, reset
  scopes, dates/access checks, Basic/Premium limits, private recipe sharing,
  revoked invites, repeated joins, owner transfer, and isolated group votes.
- The migration test exercises upgrade/downgrade on disposable SQLite data and
  preserves legacy votes. A fresh production backup was also restored to an
  isolated, network-disabled PostgreSQL 16 container and upgraded successfully.
  The live PostgreSQL database remains at `0db143da7f75`.
- Mobile tests cover drop hit-testing, edge-scroll bounds and invitation parsing,
  alongside existing authentication, subscription, Discover and planner tests.
- Playwright uses intercepted API fixtures at 1280, 390 and 320 pixel widths,
  including real mouse/emulated touch gestures and edge scrolling to Sunday,
  day pickers, add errors/retry,
  reset scopes, group creation, invitation QR/link screens and joining.
- Final checks: 48 API tests and 14 mobile tests passed, plus Python/mobile
  lint and type checks. The five group/migration tests were rerun after the final
  invitation concurrency change and passed.
- Physical Android/iOS gesture and share-sheet checks remain phone UAT tasks.

## Release 7 Preflight

- Verified backup: `backups/postgres/dinner_swipe_20260928T004154Z_before_build7.dump`
  (0600, ignored by Git). Restore plus upgrade reached `ca92e654710b`; every user
  had a private kitchen afterward. The temporary database container was removed.
- Retained rollback tags: `dinner-swipe-api:before-build7`,
  `dinner-swipe-worker:before-build7`, `dinner-swipe-web:before-build7`.
- Prepared API image: `dinner-swipe-api:build7-415d210`. No live service restarted.
- Android artifact verification is recorded in `android-preview-uat.md`.
