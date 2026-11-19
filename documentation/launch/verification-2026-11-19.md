# Fulfillment And Native Billing Verification

Verified locally on November 18-19, 2026 against the working tree based on
`60ae95d2f9c81a7fa0e40d32ae69f32fec1b7dbc`. Changes are uncommitted and were not
pushed or deployed by this task. No real-account deletion, purchase, product
creation, signing operation, tax change or store submission was performed.

## Results

| Check | Result |
| --- | --- |
| Full backend regression | 1,139 passed, 19 environment-gated skips |
| Additional final native tests | Two new tests passed for paid-expiry/freshness-bounded offline access and pending purchase not consuming welcome access; verified-email dispatch test also rerun successfully |
| Real PostgreSQL erasure tests | Six passed, including FK preservation, independently owned records, revocation race and native ownership tombstones |
| PostgreSQL migration exercise | Old head to new head, repeat upgrade, no account backfill, empty rollback/re-upgrade and protection against dropping nonempty receipts passed |
| Mobile regression | 757 tests passed across 69 suites |
| Static checks | Ruff, strict mypy across 175 backend files, mobile ESLint and TypeScript passed |
| Python dependency consistency | `pip check` passed |
| Release guards | 15 runtime/store-profile tests passed; Android AAB and iOS device IPA preflights passed |
| Native configuration | Android and iOS CNG prebuild passed in a temporary snapshot; microphone/photo/biometric purpose strings retained |
| Platform exports | Android and iOS Hermes plus web exports passed after final mobile source changes |
| Browser | Mocked API/no writes; 320x800, 390x844 and 1440x900; deletion acknowledgement, disabled purchase, legal links, screenshots/nonblank and overflow checks passed |
| Dependency audit comparison | New and baseline Node production audits each had 10 moderate, zero high and zero critical reports; no new affected advisory package names from IAP |
| Production isolation | Existing API/worker/web and n8n/shared PostgreSQL/Ollama container identities/start times unchanged; public readiness remained 200 |

Earlier regression failures were old paid-Basic assertions, not accepted failures:
they were updated to verify free Basic, retained Premium gates, bounded offline
access and continuing Basic weekly resets. The final full backend run passed.
Existing deprecation warnings were not suppressed in source or represented as fixes.
This is focused verification, not a new complete security audit or a zero-CVE claim.

## Evidence

Private local evidence is under `/tmp/dinner-launch-fulfillment-20261118`:
`backend-final.xml`, `backend-final.log`, `backend-final.result`, backend Ruff/mypy
logs/results, mobile final/lint/typecheck logs/results, `pg-tests-final.log`,
`pg-tests.result`, `migration-test.log`, `migration-test.result`,
`native-prebuild.log`, `refreshed-export.log`, `native-refresh.result`,
`browser-results.json`, and desktop/mobile screenshots. Provider evidence in unit
tests is synthetic or mocked, not live purchase verification.

The isolated PostgreSQL fixture had no persistent mounts, only tmpfs data. It was
removed after successful tests. Temporary browser/build jobs completed, and the
temporary static-preview server was stopped. Older unrelated preview sessions and
protected APK/download archives were not removed.

## Runtime And Rollout Boundary

Source runtime is sealed as `0.3.0`, Android code31/iOS build31, native hash prefix
`02c15b249a1c`. This seal is a reviewed source contract, not proof of a built binary.
The previous `0.2.2`/code30 AAB remains a separately verified older artifact without
this native billing work. No APK31, AAB31 or signed iOS archive was built by this task.
No EAS Update was published to an older runtime.

Database candidate head is `c419fa3a8210`, following the additive erasure and native
billing migrations. Production schema was not changed. Erasure and both native
provider flags default off. Existing manual deletion intake remains compatible
until fulfillment is separately released and enabled. No Stripe-backed subscription
records were found in a read-only production aggregate on November 19; none were
cancelled, repriced or migrated.

## Outstanding Acceptance

Store products, agreements, protected credentials, notification delivery, actual
device purchases/restoration, renewal/refund tests, iOS signed compilation and
store reviews remain outstanding. Apple environment separation must be reviewed
before combining TestFlight testing and production customers. Reviewed privacy,
audience/age, EU health-data handling/transfers and backup retention decisions are
also still required. Draft documents were not published as approved policies.

A read-only November 18 check found Stripe Tax configured but zero active
registrations; no collection or registration was enabled. Native pricing/tax must
be reviewed in each purchasing store; web tax remains a separate readiness gate.

These checks support a controlled next testing release, not an assertion that
public launch, native billing, legal compliance or every physical-device workflow
has already been accepted.
