# Welcome Premium Release 0.2.2

Android preview APK 30 includes the dynamic tutorial, verified-account 30-day
no-card Premium welcome access and account-switch safeguards. Runtime/version
is 0.2.2; app identities, existing signing credentials, permissions, SDK 58 and
native voice support are retained. The release deliberately bumps the native
runtime contract for the new build metadata; do not overwrite the 0.2.1 receipt
or publish this build as an update to a different runtime.

Production Android builds explicitly produce `app-bundle` (.aab); preview remains
a directly installable APK. iOS has a reviewed build number of 30 for a future
signed .ipa. Release numbers stay source-controlled (`autoIncrement=false`)
instead of allowing an EAS build to mutate the sealed native config. Before
another store upload, choose a new build/version number and reseal/test it.

## Authorized Release And Rollback

The owner authorized GitHub push, Dinner Swipe API/worker/web deployment and an
Android preview rebuild on November 17. Back up only the dedicated database,
media and environment; retain all three rollback images and previous APKs.
Run the additive `fa617db329a0` migration as the existing migration owner, verify
runtime DML privileges and zero backfill, then replace only API/worker/web.
Never change shared n8n/PostgreSQL/Ollama resources or restore a dump over later
user writes. Compatible image rollback leaves the new eligibility table intact.

Require exact-commit GitHub CI, local native/runtime guards, restored-backup
migration checks, matching source/version/signature/archive inspection and a
full public APK-download checksum before reporting release completion. Record
actual image/build/commit/checksum results in the private release receipt under
`backups/launch-polish-release-20261117/MANIFEST.md`. A queued EAS job is not a
finished APK. No public store submission is authorized by this release.

## Next Store Steps

The owner reports Google Play developer approval. Create or confirm the Dinner
Swipe app record, retain `dev.dcss.dinnerswipe`, then prepare an internal-testing
AAB release. Confirm organization versus personal account type: newer personal
accounts may require 12 opted-in closed testers for 14 continuous days before
production access; do not apply that requirement to every organization account.
[Google testing requirements](https://support.google.com/googleplay/android-developer/answer/14151465).

The APK is for direct device testing, not a replacement for the Play AAB. The
production EAS profile is build-only unless submission is explicitly requested;
an upload is not a public rollout. Google app records, signing enrollment,
submission credentials, privacy/Data Safety/content forms, reviewer access and
store products are not created automatically by this task.
[Expo Android guide](https://docs.expo.dev/submit/android/).

For iOS, confirm Apple Developer enrollment and signing, create the matching
App Store Connect record, build a production signed .ipa, and upload for
TestFlight testing before public review. Apple account/signing setup and builds
are separate authorized actions; no iOS build or upload is implied here.
[Expo TestFlight guide](https://docs.expo.dev/submit/testflight/).

Neither an AAB nor an IPA fixes missing public-launch functionality: actual
account erasure, native purchase/restoration and server verification, final
privacy/tax/refund declarations, US/EU territory setup and physical-device UAT
remain release gates. See the launch-readiness and reviewed-CI/CD documents.
