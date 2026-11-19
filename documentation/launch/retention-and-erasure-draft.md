# Retention And Erasure Operations

Working operational draft, November 18, 2026. This is a decision and verification
record, not authorization to prune archives or a statement that fulfillment is live.
Durations marked proposed require owner approval, implementation and verification
before appearing as guarantees in a public policy.

## Retention Schedule

| Data | Current or intended handling | Decision or acceptance evidence |
| --- | --- | --- |
| Account, recipes, preferences, plans, groceries | Retain for requested account features; erase on confirmed account fulfillment | New fulfillment flag defaults off; deploy and accept before claiming live |
| Original shared recipes and workouts | Remove originals and sharing links during erasure | Owner explicitly approved; other accounts' independent records remain |
| Other members' personal logs and independent copies | Preserve their own records; detach unavailable source references | Do not treat the deleting user as owner of another member's private records |
| Uploaded private photos | Remove if no surviving independent reference; inaccessible cleanup queue on storage failure | Restricted custody only for genuinely referenced independent copies |
| CSV/XLSX import bytes | Current parser discards uploaded bytes after parsing | Parsed data and metadata persist until removed; inspect legacy stored-file paths |
| Server voice conversion files | Delete in processing cleanup | Test failure/cancellation paths; do not promise provider zero retention |
| Standalone transcript retry cache | In-memory, at most five minutes | Purge local entry if authenticated completion fails |
| Native audio cache | Attempt removal after successful submission/discard/cancel | OS interruption can leave cache; test cold-start and cleanup behavior |
| Meal-assistant drafts | Access expires after one hour | Expired access is not a stored-data deletion schedule; job content/metadata need a separately reviewed cleanup policy |
| fatsecret responses | Temporary cache configured to 23 hours, never serve beyond allowed lifetime | Permitted IDs and user-entered labels/portions are separate; no permanent copied macros |
| Account-bound offline data | Explicit erasure clears the deleting device; ordinary sign-out may retain drafts | Disconnected devices cannot be instantly wiped; never sync revoked changes back |
| Erasure receipt and suppression hash | Minimal receipt, timestamps, counts and hashed original account identifier | Necessary to prevent resurrection after restore; no email/password retained in receipt |
| Store chain ownership and billing references | Minimal detached records to prevent purchase reassignment and reconcile obligations | Restrict access; no profile reconstruction; no implied cancellation |
| Provider notification, usage and security records | Minimum necessary for delivery, abuse prevention, incidents and disputes | Approve category-specific durations; redact health payloads and purchase tokens from logs |
| Database/media backups | Private recovery material, not application access | Proposed maximum residual window: 30 days after erasure; not approved or enforced by this draft |
| Tax, accounting and legal-hold records | Only fields and period supported by a specific obligation | Owner/adviser must identify jurisdictions, scope and duration; no arbitrary universal seven-year rule |

## Fulfillment Procedure

1. Identify the exact account and verify the current password plus explicit deletion
   confirmation. A paid subscription is not required for privacy controls.
2. Resolve shared-group ownership without moving private records into someone else's
   account. Existing controls let a sole member leave a shared group. Keep any
   exceptional review proportionate and avoid indefinite deletion blocks.
3. Show external billing consequences and cancellation routes. Record acknowledgement,
   but allow deletion now without waiting for cancellation or subscription expiry.
4. Create a durable receipt; revoke the account and its sessions before cleanup.
   Authenticated in-flight writes must fail after revocation.
5. Atomically erase database-owned data, original shared contributions and access
   links. Preserve other accounts' independently owned records. Detach source IDs
   where needed and replace authored history snapshots with neutral placeholders.
6. Queue unreadable private media for storage cleanup. A storage failure leaves the
   receipt pending. Retry with bounded backoff; alert/review aged failures. Never
   report completion solely because a timer executed.
7. Clear the deleting device's account caches and unsent edits. A local cleanup
   problem must not turn a successful server erasure into a false failure or clear
   a different user's device data.
8. Confirm the receipt outcome without including private content or credentials.
   A pending receipt remains operational work; support must be able to locate it
   by receipt ID after sign-in access has been revoked.

## Backups And Restore Suppression

The proposed 30-day window cannot be published until the owner approves it and
inventory covers manual archives, automated backups, pinned rollback bundles,
off-host copies and media. Do not infer Dinner Swipe backup retention from n8n's
separate seven-set policy. This development task does not remove existing archives.

Restore suppression is a release requirement, not an optional historical note.
Keep a minimal erasure ledger outside any restore scope that could roll it back.
Before restoring service, replay all applicable erasures into a private restoration
environment, revoke restored credentials, reconcile store ownership tombstones, and
check private-media references. Only then expose the restored application. Restoring
an old backup must never silently reactivate a deleted account. Test this procedure
and retain evidence without publishing original personal data.

## Service Providers And Incidents

Maintain a processor register with deletion/request paths, retention terms, contacts
and any legal-retention limits. Record provider requests where required; do not
promise our application deletion API erases Apple, Google, Stripe, OpenAI or email
provider records. Track completion or lawful exceptions. Avoid sending raw health
data to observability or support tools merely to investigate a request.

Before EU/U.S. public release, assign a rights-request owner, incident responder,
backup custodian and legal escalation contact. Review EU health-data and transfer
requirements and the applicability of U.S. consumer-health and breach-notification
rules. Set documented response targets, evidence preservation and incident exercises;
do not substitute an in-app disclaimer for those controls.

## Release And Rollback

Take private, checksum-verified backups before a production migration and retain
the relevant component images. New migrations are additive, but a rollback must
not resurrect erased data or drop receipts/native purchase ownership. Once real
erasure has occurred, restoring an old full database is not a normal code rollback.
Leave fulfillment and store-provider flags disabled until deployment is separately
authorized and acceptance passes. Never test destructive workflows with the owner's
or an ordinary customer's real account.
