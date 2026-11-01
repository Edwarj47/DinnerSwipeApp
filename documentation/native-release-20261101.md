# Native Release 0.2.0

## Scope

Expo was upgraded incrementally from SDK 51 through SDK 58, with compatible React Native 0.88, React 19.3 and Node 22 build tooling. Android versionCode is 28. The application package, EAS project and signing identity are unchanged. Recipe component headings from the November 1 formatting work are included; protected log-linked recipes and nutrition records are not modified by this release.

Native meal dictation now records bounded mono AAC in private cache with expo-audio. Stopping transcribes automatically through the authenticated backend. Existing Premium, consent, upload size/duration and provider quota controls remain. Cancellation, backgrounding and unmount release the microphone and discard the local clip; OS cache eviction covers abnormal termination. Web recording remains browser-based. Physical-device permission, audio-interruption and OEM launcher-icon tests remain required.

## EAS Update

This APK opts into automatic launch-time checks with the embedded bundle available offline and no startup wait. It never forces a mid-session reload. Separate development, preview and production channels use separate branches/environments. Preview is an internal distribution channel, **not a staging backend**: it uses dinner.dcss.dev and the installed production package identity.

The appVersion runtime policy is guarded by `check-ota-runtime.cjs` and the committed `apps/mobile/native-runtime.json`. Packages, lockfiles, configuration, native plugins/modules, palette and images form the native contract. Alternate Expo configs and checked-in native project directories are rejected for this CNG project. JavaScript-only UI fixes can use OTA. SDKs, native dependencies/permissions/icons and contract changes require a higher app version and a new APK. Never reuse an older runtime or re-record the guard to bypass a mismatch.

After finishing and verifying an APK, store its nonsecret receipt privately in `backups/eas-runtime-0.2.0.json`: `runtime`, `contract`, `commit`, `buildId`, `status: FINISHED`. `infrastructure/scripts/eas-update-android-preview.sh "message"` checks this receipt, clean tracked source, ancestry, distinct channel mappings and the actual remote preview public environment before publishing Android only. It does not publish production updates. Run release tests and review the diff before invoking it.

EAS authentication stays in the existing mode-0600 user configuration, never source or public environment variables. Only app name, HTTPS API origin and the existing public AI feature flag are configured in EAS public environments. Free-plan quotas apply. End-to-end OTA code signing is not enabled because the current Free tier does not provide it; existing APK signing is retained.

## Verification and Rollback

Release evidence is private under `backups/sdk-voice-release-20261101` and `/tmp/dinner-sdk-voice-release-20261101`. Verify mobile lint/types/tests, icon and native-contract tests, Expo Doctor, Android/web exports, generated permission/icon/update configuration, actual EAS build artifacts and mobile/desktop browser workflows before reporting completion.

The scoped web rollback uses `backups/sdk-voice-release-20261101/rollback.sh` and the retained previous web image. No database migration is required. Fresh database/media/environment snapshots are checksum verified. API, worker, database and unrelated VPS containers remain unchanged. For a bad OTA, use EAS rollback/republish on the affected channel and runtime; do not disable anti-bricking or embedded fallback. Verify two cold launches, offline startup and native recording on a physical Android device after installing the APK.
