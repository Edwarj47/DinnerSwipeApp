# Private Daily Additions

## Scope

A finite campaign prepares at most five recipe and five workout candidates per
calendar date, for 35 dates at 06:00 America/New_York. Preparation is not publication.
The campaign runs in collect-only mode: daily compilation is independent of later
publication. Pending batches may accumulate across the full campaign, then the
enrolled owner reviews them in Settings > User settings > Daily additions and
approves batches or selected entries, or dismisses selected entries. Completing
the 35-day collection period does not publish or discard pending entries.
Approval adds new records to that owner's Personal libraries only. Existing
recipes, nutrition logs, plans, groceries, pantry records, shares and groups are
not edited. There is no APK, SDK, subscription or billing change.

## Quality And Sources

- Only complete candidates with a real, independently reusable photograph pass.
- Recipe values must include a verified per-serving basis, yield, ingredients,
  instructions, prep/cook duration and calories/protein/carbohydrate/fat/fiber.
- Publisher nutrition is labeled as an estimate, not a laboratory measurement.
- Workouts are authored routines with equipment, difficulty, duration, warm-up,
  cooldown, exercise technique, rest periods and sets/reps or timed work.
- Photos must have individual public-domain, CC0, CC BY 4.0 or CC BY-SA 4.0
  evidence. Attribution-required photos retain visible creator, source, license
  and modification credits, with share-alike notices when applicable. A government
  hostname or a Commons page footer is not permission to copy a third-party photo.
- An independent representative dish photo is explicitly identified as such.
- Candidates matching saved ingredient exclusions are rejected again on approval.
- No FatSecret calls, catalog harvesting, copied FatSecret nutrition, AI-generated
  photos, image subscription or new paid API is used by this job.

Collection need not wait until every future entry is available. The checked-in
source queues are finite, not a guarantee of 175 qualifying entries
of each type. Duplicates, inaccessible sources, changed nutrition, unverified photos
and missing details produce a smaller batch and an explanation. An exhausted queue
does not justify fabricated entries, duplicate variants or increasing a daily cap.
Daily source discovery also checks rotating MedlinePlus recipe categories and NHS
exercise indexes for new links. It stores at most five new links of each type per
date, deduplicated across the campaign, in the existing private batch report.
These are **source leads, not complete recipes/workouts**. Discovery copies only
titles, publisher names and HTTPS source links, not photographs, instructions or
nutrition. Catalog robots policies are checked first; failures, blocked catalogs,
redirects and changed layouts fail closed. No recursive crawler, model calls,
paid search API or FatSecret requests are involved.

Review path: **profile icon > User settings > Daily additions**:

- **Pending**: compiled entries; preview and approve batches/selected entries or dismiss.
- **Sources**: discovered links marked Needs source checks; open the publisher page
  for research or dismiss a lead. This screen cannot approve or publish a link.
- **History**: completed batch reviews.

New source content still requires code/registry review, exact photo rights,
complete nutrition and parser tests before it becomes eligible for compilation.
Finding a link does not certify reuse permission or keep future batches full.
Exhaustion is reported as a shortfall while existing compiled candidates remain pending.

## State And Recovery

The additive `content_automation_campaigns`, `content_automation_batches` and
`content_automation_candidates` tables hold campaign, lease and review state.
Composite foreign keys enforce account scope. Unique date/slot/source/content
constraints and account-level row locks serialize preparation and approval.
Decisions are atomic and retry-safe; a lost approval response cannot publish twice.

The worker reserves each source attempt in the database before network work,
permits at most 20 attempts per type/date, and runs for at most 15 minutes. All
network work happens outside database row locks. Downloads use DNS-pinned HTTPS,
per-hop host allowlists, byte/decompression/image bounds and metadata stripping.
Photos use the existing private media store and account quota. Pending previews
remain live references for media cleanup.

Discovery runs after preparation with its own three-minute lease and a one-minute
wall-clock budget. It fetches at most four catalog indexes plus two robots files,
with 12-second request bounds, 1 MB index/64 KB robots limits and a one-second delay
between catalog checks. There is at most one finished discovery per dated batch,
with two attempts allowed only to recover from a crashed lease. Dismissing a lead
does not allow it to be rediscovered. Redirects are rejected before following;
earlier validated links survive a later catalog timeout. No new database tables are needed.

Pausing does not extend the campaign. Missed/paused dates do not accumulate extra
items. A restarted worker can resume the same date under a fresh lease, but never
refill a previous date or exceed that date's five-per-type cap.

## Operator Commands

Run from the repository root. The launcher reads the mode-0600 project environment,
uses the current API image and least-privilege database connection, and mounts only
the Dinner Swipe media volume in a bounded disposable non-root container.

```bash
bash infrastructure/scripts/run-content-job.sh --preflight
bash infrastructure/scripts/run-content-job.sh --enroll ACCOUNT_EMAIL
bash infrastructure/scripts/run-content-job.sh --status
bash infrastructure/scripts/run-content-job.sh --discover-sources
bash infrastructure/scripts/run-content-job.sh --timer ACCOUNT_EMAIL
sudo systemctl status dinner-swipe-content-daily.timer
sudo journalctl -u dinner-swipe-content-daily.service
```

Enrollment defaults to the next New York calendar date. Install the generated timer
only after a five-recipe/five-workout live preflight, passing test/build/browser
checks, a verified private backup and the additive migration. The generated timer
has exactly 35 dated `OnCalendar` entries, including the correct DST offset; it is
not an unbounded daily cron expression. The standard nutrition/weekly workers and
unrelated VPS services remain unchanged.

## Verification And Rollback

`verify-content-migration.py BACKUP_DUMP` restores into a disposable localhost-only
PostgreSQL container, compares every pre-existing table before/after the migration,
tests downgrade/re-upgrade, and checks concurrent staging/approval races.

Before deployment retain a custom-format `pg_dump`, table fingerprints and exact
API/web/worker image IDs in a mode-0700 private `backups/content-automation-*`
directory. Disable the new timer and restore the previous application images for
rollback. Leave unused additive tables in place. Never restore an old database over
newer user activity or drop tables containing review decisions as a routine rollback.

No enrollment, timer activation or successful deployment is implied by the presence
of these files; record and verify the actual campaign dates and timer state at release.

## Validation Status: 2026-10-19

- Read-only source preflight: 13 recipes passed; one was subsequently excluded
  because its otherwise reusable photograph misrepresented the recipe. The
  remaining 12 retain that verified source evidence; no records were staged.
  The earlier October 16 worker preflight produced five recipes and five workouts
  without skips, with no publication or enrollment.
- Verified content supply: 12 recipes and 52 distinct authored workouts. The 54-URL
  recipe registry contains 14 nutrition-reviewed records; 42 URLs remain blocked.
  This permits two full five-recipe dates plus two recipes before exclusions or
  source failures, not five weeks. This is not a reason to hold collect-only
  compilation, but source expansion remains necessary to keep future batches full.
- Six additional recipes use three CC BY-SA 4.0 and three CC0 photos. Individual
  creator/license checks, preparation differences and visible attribution are
  preserved. Government-hosted recipe nutrition remains publisher-estimated;
  representative photos do not certify the recipe's ingredients or nutrition.
- On October 16, disposable PostgreSQL upgrade/downgrade/re-upgrade left all 60 existing table
  fingerprints unchanged. Concurrent staging was capped at five and simultaneous
  duplicate approvals created a single recipe.
- Mobile/desktop browser checks used mock account data, not production credentials
  or writes. Successful paths, previews, selections, approvals, dismissal, pause,
  empty states, offline controls and server errors were exercised.
- No production migration, campaign enrollment or daily timer activation has been
  performed as part of these checks. Existing production records remain untouched.

## Live Status: 2026-10-20

The collect-only campaign is now active for October 20 through November 23, with
35 dated runs at 06:00 America/New_York. The first batch contains five complete
recipes and five complete workouts, all pending, with zero publication links.
Discovery is also deployed: its first live run saved five new recipe source links
and five new exercise source links. A repeated same-day invocation returned not_due
without further outbound catalog requests. Existing libraries and nutrition logs
had identical counts and full-table fingerprints before and after discovery.

The new **Sources** tab is separate from **Pending** batch approval. Source leads
are not a completed content supply: the reviewed 12-recipe/52-workout pool still
needs nutrition/photo/licensing checks and source-parser expansion before new
finds can fill future publishable batches. Smaller batches are still possible.
No entry is automatically published at the end of the campaign.

Release checks: 257 focused backend tests, 595 mobile tests, backend/mobile lint
and types, API/web images, and 15 browser states across desktop/390 px/320 px.
The independent discovery review's redirect, partial-timeout and publisher-identity
findings were fixed and regression-tested before deployment. Fresh private database
and media backups and previous-image rollback tags were retained; no schema change,
new paid provider, APK build or unrelated VPS service change was required.
