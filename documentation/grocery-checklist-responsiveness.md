# Grocery Checklist Responsiveness

## Behavior

- Checkmarks and remaining-item counts update on tap, including all appearances
  of a shared ingredient across recipe groups. Layout and touch targets are unchanged.
- Grocery edits finish locally after the existing account-scoped outbox is
  durably written. Network synchronization runs separately; macro-edit API
  completion behavior is unchanged.
- Ordered local intents keep rapid check/uncheck taps predictable. Failed local
  saves remove only the failed intent; they never send a server mutation.
- Pending outbox values stay visible during polling and conflicts, within their
  original personal or shared group. Query cancellation prevents stale requests
  from replacing a completed local save. Cleared account caches are not recreated.
- Grocery mutations bypass React Query's network pause so the app's own offline
  persistence can run even when browser connectivity is unavailable.
- Outbox completion refreshes affected grocery scopes once per drained sync
  burst. Macro acknowledgements refresh entries, summaries and analytics only.
  Ordinary reconnect/foreground refresh behavior remains unchanged.
- Successful sync stays silent. The existing ten-second delay for slow sync and
  immediate conflict/storage-error feedback remain intact.

## Verification

Regression coverage includes delayed writes, rapid toggles, failed persistence,
stale read snapshots, conflict retention, group isolation, account-cache clearing,
offline network-manager state and scoped/batched refreshes.

Verified on 2026-10-11: all 41 mobile suites / 282 tests passed with a cold Jest
cache, together with lint, TypeScript and the production web export. Playwright
passed at 320x720, 390x844 and 1280x900 with mocked API responses: immediate
feedback during a held response, true/false/true tap ordering, durable browser
outbox writes, one refresh of the matching personal/group list after sync,
offline/reconnect recovery, 44px touch targets and no overflow or page errors.
Production API/data were not used or modified. Native phone testing is still
an acceptance step for the next APK release.

```sh
npm run lint -w apps/mobile
npm run typecheck -w apps/mobile
npm test -w apps/mobile -- --runInBand --no-cache --forceExit
npm run build:web -w apps/mobile
```

Physical-device acceptance: tap a shared ingredient rapidly while online,
repeat in airplane mode, leave and revisit the grocery page, then reconnect.
Check that the latest choice remains visible and the server receives the queued
operations in revision order. Review conflicts rather than forcing an overwrite.

This is a client-only change. No API schema, production database, migration,
deployment or APK rebuild is required for source verification. Publishing to
installed users still requires a web release and a new Android build.
