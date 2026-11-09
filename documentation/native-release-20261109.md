# Black Default Release 0.2.1

Android versionCode 29 uses runtime 0.2.1. The existing package, EAS project,
signing identity, SDK 58, permissions and update recovery behavior are unchanged.
This native change must not be published to runtime 0.2.0 / APK 28 as an OTA.

Black (#111111) is the new fallback, sign-out and reset appearance. Explicit
saved preferences, including red, remain unchanged; no profile migration is
required. The API accepts the additional black preset before clients use it.
The native splash, primary icon and web default favicon use black DS artwork.
Authentication requests light status-bar icons while its dark overlay is shown.

Android retains the old DSIconRed component as the black default launcher entry,
and uses DSIconRedSelected for selectable red. This preserves installed override
behavior without adding a second default-enabled component. Other color aliases
and MainActivity/deep-link behavior remain. iOS uses black as primary and red as
an opaque alternate. Existing source red/colored artwork remains unchanged.

## Release Gates

- Confirm mobile/API lint, types, tests, native icon/runtime guards and matching
  generated Android/iOS resources. Local source verification included 731 mobile
  tests, 20 focused API tests and seven icon tests, plus isolated real API/browser
  and Basic/Premium viewport checks at 1440x900, 390x844 and 320x800.
- Push the reviewed source and require exact-commit backend/frontend/Docker CI.
  Inspect the EAS archive and public preview environment; use existing frozen
  signing credentials and the preview APK profile, not store submission.
- Before deployment retain scoped database/media/environment snapshots and
  current API/web images. Replace only API/web; no migration or worker/database
  restart is needed. Verify live health, source/assets and data fingerprints.
- Verify the finished cloud build's source, package, version, runtime, channel,
  microphone permissions, black splash/icons, certificate continuity, signature,
  archive integrity and absence of configured server secrets.
- Keep APK 27/28 and runtime 0.2.0 history intact. Publish APK 29 atomically under
  the existing downloads route and compare a full public download checksum.
  Record a real finished-build receipt for runtime 0.2.1 only after verification.

Actual build/deployment IDs and checksums belong in the private
`backups/black-default-release-20261109/MANIFEST.md` receipt, not an assumed status
in this procedure. A source/configuration check is not signed-device acceptance.

Physical APK 28-to-29 checks remain required: selected red/blue, pinned shortcuts,
deep links, biometric-locked startup, status-bar/splash contrast, voice recording,
offline launch and foreground icon reconciliation. No device behavior is claimed
solely from manifest/model tests.

This is a private-preview release, not store approval. Actual account erasure,
native store purchases/restoration and store enrollment/configuration remain
separate launch work. Approved eventual availability remains US/EU only.
