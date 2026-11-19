# Native Billing Setup And Acceptance

Engineering runbook, November 19, 2026. No provider resources, paid subscriptions,
signing credentials or tax registrations are created by this document.

## Plan And Store Records

Use the unchanged application identity `dev.dcss.dinnerswipe` on Android and iOS.
Create one monthly auto-renewing Premium subscription per store, with the U.S.
reference price USD 9.99. Review localized amounts, tax presentation and U.S./EU
availability in each console. Basic is not a paid product. Do not create an
automatically converting first-month offer: the app's existing server welcome grant
already provides 30 days without a card or charge.

Suggested display name: Dinner Swipe Premium.
Suggested description: Macro tracking, nutrition calculations and analytics, plus
Premium planning and group capabilities. Food database, AI and voice limits apply.
Description and screenshots must match enabled, tested features; do not claim
medical accuracy, unlimited provider calls or Garmin integration.

Product IDs are immutable console decisions. Record the chosen Apple product ID
in `NATIVE_APPLE_PRODUCT_ID`, the Google product ID in `NATIVE_GOOGLE_PRODUCT_ID`,
and Google's monthly base plan in `NATIVE_GOOGLE_BASE_PLAN_ID`. They default empty:
no existing product has been invented or assumed. Verify the console period and
base-plan offer before enabling access.

## Protected Server Configuration

Native secrets belong only in protected API/worker configuration and read-only
secret-file mounts, never `EXPO_PUBLIC_*`, app assets, build logs or Git. Ensure
the same encrypted-token key and provider settings reach API and worker. Keep
private files accessible only to the service account. The code never trusts a
client-supplied price, tier, expiry or premium flag as entitlement evidence.

| Setting | Meaning |
| --- | --- |
| `NATIVE_TOKEN_ENCRYPTION_KEY` | Fernet key for stored provider references; preserve securely and plan key rotation before changing it |
| `NATIVE_GOOGLE_ENABLED` | Off until Google prerequisites and acceptance are complete |
| `NATIVE_GOOGLE_PRODUCT_ID`, `NATIVE_GOOGLE_BASE_PLAN_ID` | Exact configured monthly product/base plan |
| `NATIVE_GOOGLE_CREDENTIALS_PATH` | Mounted service-account credentials, with only required Play access for this app |
| `NATIVE_GOOGLE_PUSH_AUDIENCE` | Exact configured Pub/Sub OIDC audience |
| `NATIVE_GOOGLE_PUSH_EMAIL` | Exact authenticated push-service identity, not the customer's email |
| `NATIVE_APPLE_ENABLED` | Off until Apple prerequisites and acceptance are complete |
| `NATIVE_APPLE_ENVIRONMENT` | Explicit `Production` or `Sandbox`, no silent fallback |
| `NATIVE_APPLE_PRODUCT_ID`, `NATIVE_APPLE_APP_ID` | Exact product and numeric App Store app ID; omit app ID when not yet created |
| `NATIVE_APPLE_ISSUER_ID`, `NATIVE_APPLE_KEY_ID` | Server API key identity |
| `NATIVE_APPLE_PRIVATE_KEY_PATH` | Mounted Apple private key, never a mobile/public variable |
| `NATIVE_APPLE_ROOT_CERTIFICATES` | JSON list of mounted, independently obtained trusted Apple root certificate files |
| `NATIVE_ALLOW_TEST_PURCHASES` | Explicit test allowance, off by default; never silently grant production access from sandbox evidence |
| `NATIVE_VERIFICATION_LEASE_HOURS` | Bounded verification freshness, default 24 hours, max 72 |
| `NATIVE_NOTIFICATION_REQUESTS_PER_MINUTE` | Per-provider global/IP delivery budget, default 120; throttled store events must retry |
| `NATIVE_RECONCILE_BATCH`, `NATIVE_RECONCILE_BUDGET_SECONDS` | Bounded worker batches and between-job time budget; not a hard cancellation of an already running provider request |

Do not generate keys, grant cloud roles, enable billing or upload credentials
through ordinary chat. Coordinate those protected changes with the owner. No
additional billing intermediary was provisioned for this implementation.

Manual Basic features remain available without a purchase. Expensive AI generation,
URL ingestion and native billing verification require a verified email; existing
per-account, IP and global dispatch limits remain in place. Set store notification
budgets to an appropriate reviewed capacity as traffic grows, and monitor provider
delivery retries rather than disabling authentication or deduplication.

## Google Setup

Complete the Play payments profile/agreements, app record, monthly product/base
plan and territory configuration. Upload an authorized billing-enabled AAB to the
internal track if Play needs one before enabling monetization settings. Enable
Android Publisher API access and give the backend identity only the required app
and subscription-verification/acknowledgement permissions, not organization-wide
administrator access.

Configure Pub/Sub and authenticated RTDN push to:
`https://dinner.dcss.dev/api/v1/subscription/native/google/notifications`.
Match the audience and verified service-account email exactly. Configure the
appropriate Google publisher identity and IAM permissions using Google's current
instructions. Send a console test notification; confirm authenticated delivery,
durable deduplication, worker processing and authoritative subscription retrieval.
An RTDN event is a signal to fetch current state, not itself a Premium grant.

Configure **license testers** separately from internal-track testers and select
test payment methods. An internal-track account can otherwise make a real purchase.
Use distinct Dinner Swipe test logins to exercise correct-account and wrong-account
restoration. Do not share production customer credentials with testers.

## Apple Setup

Once enrollment is active, complete required agreements, banking/tax information,
app record and a monthly auto-renewable subscription in its subscription group.
Configure server API credentials and trusted certificate files. Use Server
Notifications V2 at:
`https://dinner.dcss.dev/api/v1/subscription/native/apple/notifications`.
The verifier checks Apple's signed evidence, bundle, environment and current
subscription state. It does not accept a decoded but unverified client receipt.

The current backend selects one explicit Apple environment. TestFlight purchases
need the appropriate sandbox verification setup and explicit test allowance; do not
mix production and sandbox evidence or merely flip an environment on an established
live customer service. Use a separately planned test deployment or complete the
environment architecture review before mixed-environment acceptance. A final
production deployment must not leave sandbox acceptance enabled unintentionally.

Configure EAS signing only after the owner approves credential actions. Produce
the new runtime's signed iOS archive, upload to App Store Connect and assign it to
TestFlight. A Linux prebuild or JavaScript export is not an Xcode build or an iOS
purchase test. Keep review credentials and sandbox testers separate.

## Deployment Order And Recovery

1. Review the source diff and final test evidence. Take checksum-verified private
   database/media/environment backups and retain API/worker/web rollback images.
2. With erasure and both provider flags off, apply the new additive migrations to
   Dinner Swipe's own database, then deploy only its scoped components. Verify
   readiness at the new migration head and preserve unrelated containers.
3. Supply protected store configuration to API and worker in the intended test
   environment. Check no secret entered mobile configuration or logs.
4. Build runtime 0.3.0/code31; keep preview APK distribution, Play AAB and iOS archive
   distinct. The old runtime cannot acquire the new native module through OTA.
5. Perform the acceptance matrix below. Enable each purchase provider and account
   fulfillment only after its prerequisites pass; update public policies/forms to
   match what is actually live.

Rollback source/components without dropping ownership or erasure tables. Never
restore an old database over real erasures or lose the encrypted-reference key.
Disabling a purchase button is not cancellation. A provider outage must fail closed
for new grants; do not solve it by accepting unverified receipts or client flags.

## Acceptance Matrix

Record device/OS, app/runtime, backend release, account role and receipt/event IDs
with secret values redacted. Tests must include:

- New verified account: 30-day no-card welcome, no store transaction or automatic
  charge; expired welcome returns to free Basic without loss of saved data.
- Store price: exact monthly product/base plan, localized currency/tax, terms and
  privacy links, explicit confirmation and cancellation before purchase.
- Success, user cancellation, pending payment, network timeout and application
  termination/relaunch. Never grant merely because a purchase sheet closed.
- Restoration on the same account after reinstall; wrong-account, missing-binding,
  deleted-account and duplicate-token attempts rejected without finishing a foreign
  transaction or granting access.
- Foreground recovery, committed grant before Google acknowledgement, failed
  acknowledgement retry, Apple finish after verification, duplicate notifications,
  refund, renewal, expiry, grace, hold/pause, linked replacement and provider outage.
- Deletion with and without paid billing, group ownership transfer, independent
  survivor logs/copies, private media cleanup failure, old tokens/in-flight saves,
  late notifications, disconnected-device behavior and backup restore suppression.
- Voice recording/permission denial, keyboard and screen-reader usability, larger
  text, narrow screens and basic meal/workout/grocery regression on both platforms.

Web tax readiness is a separate gate. A read-only check on November 18 found Stripe
Tax active but zero active registrations. No tax collection, registration or customer
invoice behavior was changed. Obtain the appropriate business/tax review before
enabling web automatic tax or claiming taxes are handled for every region.

## References

- [Google billing setup](https://developer.android.com/google/play/billing/getting-ready)
- [Google RTDN reference](https://developer.android.com/google/play/billing/rtdn-reference)
- [Apple subscriptions](https://developer.apple.com/help/app-store-connect/manage-subscriptions/offer-auto-renewable-subscriptions)
- [Apple notifications](https://developer.apple.com/documentation/appstoreservernotifications/enabling-app-store-server-notifications)
