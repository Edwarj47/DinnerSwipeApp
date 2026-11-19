# Internal Store Testing

Version scope, November 19, 2026: the artifact instructions below describe verified
runtime 0.2.2/code30. Working source now prepares runtime 0.3.0/code31 with native
store billing and account fulfillment, which are not in AAB30. See
[launch preparation](launch/README.md) for source verification, console prerequisites
and release boundaries. No code31 binary has been built or submitted by this task.

Updated November 18, 2026. This is a private testing runbook, not public-launch
approval. Google Play enrollment and an internal tester list are owner-confirmed;
Apple Developer activation is pending. No store upload, release rollout, Apple
credential creation, or billing/provider changes have been performed here.

## Current Candidate

| Item | Value |
| --- | --- |
| Source | `60ae95d2f9c81a7fa0e40d32ae69f32fec1b7dbc` |
| Version / runtime | `0.2.2` |
| Android version code / iOS build number | `30` / `30` |
| Package / bundle identifier | `dev.dcss.dinnerswipe` |
| Toolchain | Expo SDK 58 / React Native 0.88.1 / EAS CLI 27.2.0 |
| Android preview | APK 30 verified, including signature and public download |
| Play bundle | Production AAB build `688d54a1-627d-49d4-ad61-7a101a17b5c7` queued; check its live status and private receipt before uploading |
| iOS | Local project generation checked; signed archive and device testing pending |

All profiles currently use the live `https://dinner.dcss.dev` backend. Test with
dedicated accounts and synthetic meals/workouts; do not change another user's
content, enter a real card, or treat this as an isolated billing sandbox.
Fresh verified accounts receive 30-day complimentary Premium without a card or
automatic charge. This does not backfill an existing Basic account's entitlement.

The existing production build profile already produces a store AAB for Android
and a device IPA for iOS. Preview remains an APK. Native config, runtime, app
identities and signing keys have not been changed just to prepare store testing.
Production and preview have separate EAS Update channels; an update published
only to preview does not update a Play/TestFlight production-channel installation.

## Google Play: The Next Screen

1. Download the finished, verified **`.aab`**, not the preview APK. On the current
   **Internal testing > Create release > App bundles** screen, choose **Upload**.
   Confirm `dev.dcss.dinnerswipe`, version `0.2.2`, code `30` after processing.
   If code 30 was already uploaded to Play, stop: prepare a new reviewed build
   number/runtime instead of rebuilding or overwriting this artifact blindly.
2. Review **App integrity / Play App Signing** before the first rollout. The EAS
   bundle uses the existing upload certificate. Google may use a different app
   signing certificate for installed Play APKs. Compare certificate fingerprints
   before migrating a sideloaded installation. A different signing key can block
   an in-place update; do not uninstall and lose unsynced local drafts as a fix.
   Importing an existing key or changing Play signing requires separate owner
   approval and secure tooling. Never send keystores or private keys in chat.
3. Set a release name such as `0.2.2 (30) - Internal testing`, paste the test notes
   below, and complete Google's required draft-release tasks. Review the exact
   warnings/errors; a store validation error is not permission to waive a gate.
4. Preview and confirm **only the internal track**. Do not promote to production,
   open testing or a public rollout. Keep the initial cohort small.
5. Under **Testers**, save the selected email list and a feedback contact. Copy
   the opt-in link. Open it while signed into the same Google account that is on
   that list, join the test, then install from Google Play. Email-list membership
   alone does not install the app; the release must be available and opted into.
6. Record installed version/code, Android/phone version and the actual results
   of the acceptance checklist. Confirm the Play-delivered build, not an older
   sideloaded APK, is running. Do not report the test passed just because the
   upload was accepted.

Public production access may also require a closed test for newer **personal**
developer accounts: at least 12 opted-in testers for 14 continuous days. An
internal test does not fulfill that closed-test requirement. Confirm the account
type and the actual Play dashboard requirement; do not apply it indiscriminately
to organization accounts.

[Expo manual AAB upload](https://docs.expo.dev/submit/android-manual/),
[Google test tracks and opt-in](https://support.google.com/googleplay/android-developer/answer/9845334),
[Play App Signing](https://support.google.com/googleplay/android-developer/answer/9842756),
[Personal-account testing](https://support.google.com/googleplay/android-developer/answer/14151465).

## iOS While Enrollment Is Pending

Engineering can validate config/plugins, iOS JavaScript, privacy inventory,
permission text, icons and tester instructions now without creating credentials
or spending an iOS cloud-build slot. A Linux prebuild/export is **not** Xcode
compilation, CocoaPods resolution, signed-IPA verification or iPhone testing.

The local generated project uses iOS 16.4 or later and targets iPhone; iPad support
is disabled. The default icon/splash is black, with six alternate accent icons.
Microphone, camera, photo library and Face ID purpose strings are present, and
background audio/recording is not enabled. The final signed archive still needs
its merged privacy manifests, usage strings, entitlements and release permissions
reviewed after CocoaPods and Xcode have run.

When Apple confirms activation:

1. Sign into App Store Connect, accept outstanding agreements, and confirm the
   publishing team/legal entity. Create Dinner Swipe's app record with bundle ID
   `dev.dcss.dinnerswipe`, platform iOS and a stable internal SKU. Keep its numeric
   App Store Connect ID and Apple Team ID for release setup; these are identifiers,
   not passwords. Do not share passwords, 2FA codes or private `.p8` keys in chat.
2. Authorize the first iOS signing setup separately. In a private interactive
   session, use `npx eas-cli@27.2.0 credentials --platform ios` from `apps/mobile`.
   Confirm the correct team and bundle ID before creating/assigning distribution
   signing and provisioning. Do not revoke unrelated certificates or invent a
   placeholder Apple Team ID in committed config.
3. Once existing EAS signing is confirmed, run the guarded build-only helper:

   ```bash
   DINNER_SWIPE_IOS_SIGNING_READY=1 bash infrastructure/scripts/eas-build-ios-production.sh
   ```

   It uses the production/store profile, freezes existing credentials and does
   **not** auto-submit. The enrollment guard is an operator assertion, not a
   live Apple verification. If signing is missing, stop and resolve it rather
   than allowing unattended credential creation.
4. Verify the resulting `.ipa`: bundle/version/build, distribution signature,
   provisioning, runtime/channel, purpose strings, privacy manifests and no
   bundled server credentials. Answer Apple's encryption/export-compliance
   questions truthfully after reviewing actual cryptography; do not set a false
   declaration just to suppress a processing prompt.
5. After explicit upload approval, submit that exact build ID, not `--latest`:
   `npx eas-cli@27.2.0 submit --platform ios --id <verified-build-id>`.
   An App Store Connect API key can later enable scoped CI submission; store its
   private key only in protected secrets. The empty `submit.production` profile
   is not evidence that submission credentials exist.
6. Once Apple finishes processing, create a **TestFlight internal testing group**
   and add eligible App Store Connect team members. Install Apple's TestFlight
   app on an iPhone and accept the invitation. Do not grant admin access merely
   to let someone test. People outside the team use external TestFlight and its
   Beta App Review, not broad App Store Connect access.

TestFlight needs a **store-signed production** build, not Expo's `distribution:
internal` ad-hoc preview. It does not require a Mac on the owner's desk: Expo
builds on hosted macOS and submits from the VPS. A TestFlight upload is not a
public App Store release. Builds expire after 90 days; external testing/review
and public submission are separate gates.

[Expo TestFlight workflow](https://docs.expo.dev/submit/testflight/),
[Apple internal testers](https://developer.apple.com/help/app-store-connect/test-a-beta-version/add-internal-testers/),
[Apple export compliance](https://developer.apple.com/help/app-store-connect/manage-app-information/overview-of-export-compliance).

## Release Notes Draft

```text
Dinner Swipe 0.2.2 (30) - Private internal test

Please test sign-up/email verification, guided setup, meal and workout planning,
grocery checklists, favorites, macro calculations and voice meal descriptions.
New verified accounts receive 30 days of complimentary Premium; no card needed.
Check cold launches, saved colors and returning after switching apps.

Use test data. Do not make real payments. Report device/OS, app version, steps,
expected and actual result. Redact names, emails and personal health data from
screenshots before sharing feedback.
```

Owner must supply the feedback contact and any private reviewer credentials.
Do not commit passwords or promise native purchase/restoration or completed
account erasure in store metadata before those workflows actually exist.

## Physical Acceptance Record

Run on the store-delivered candidate on Android and iPhone. Leave unchecked
until observed. Capture failure evidence privately, not personal health data in
public issues. Record build, OS, device, tester and UTC date for every run.

- [ ] Fresh install, black launch screen, saved accent and alternate app icon.
- [ ] Verify email, sign in/out, recover password; no cross-account data or theme.
- [ ] Tutorial starts at the right task, resumes and advances only after saving.
- [ ] Fresh verified account gets 30-day no-card Premium; existing access unchanged.
- [ ] Personal/group selection persists and respects owner/member permissions.
- [ ] Recipe search/favorites/edit/checklists; nutrition and required photo credits.
- [ ] Meals/workouts switch; next-week plans persist and historical weeks stay read-only.
- [ ] Grocery taps update immediately; failed/retried sync stays consistent.
- [ ] Calculator search, match, portions, edit/date move, recipe save and daily totals.
- [ ] Microphone allow/deny/retry; foreground recording/transcription; return from background.
- [ ] Meal review survives switching apps without duplicate entries.
- [ ] Workout notes/completion save without a measured set; session history intact.
- [ ] Keyboard/small-screen/large-text layout; reduced motion, back and modal dismissal.
- [ ] Offline/reconnect/relaunch; drafts survive; no stale writes to another account.
- [ ] Update channel/runtime and cold-start fallback work without Metro.

Store purchase/restore/refund and completed account erasure need separate final
acceptance after implementation. Do not use a real account for destructive tests.

## Public Launch Is Still Gated

Actual account-deletion fulfillment, native store purchase/restore and server
verification, final privacy/Data Safety/health/AI/audio declarations, owner
approved retention/prices, US + EU territory selection, review access and final
device acceptance remain open. Existing native preview billing still uses web
Stripe links; do not submit that unchanged as a finished public-store flow.
See [launch readiness](launch-readiness-20261108.md) for the implementation and
disclosure inventory. Garmin remains deferred.

## Repeatable Preflight

```bash
node infrastructure/scripts/store-build-preflight.cjs android
node infrastructure/scripts/store-build-preflight.cjs ios
node --test infrastructure/scripts/store-build-preflight.test.cjs infrastructure/scripts/ota-runtime.test.cjs
```

These are local, read-only configuration/tests, not live store checks. Build
helpers also validate the production public environment before building, reject
unexpected public variables, and freeze existing signing credentials. They
consume Expo allowance only when explicitly invoked. Never auto-submit
on every push. Keep reviewed exact-commit CI, immutable native artifacts,
independent human approval for store upload/rollout and the existing rollback
artifacts. Do not make public store releases depend on unverified `--latest`.
