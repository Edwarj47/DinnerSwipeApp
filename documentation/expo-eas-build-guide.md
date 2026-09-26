# Expo and EAS Build Guide

## Phone Testing Without Metro

Android preview build 6 completed on 2026-09-26. Its artifact checks and pending
physical-device tests are recorded in the [UAT checklist](android-preview-uat.md).
The install link is shared privately rather than committed to this repository.

Use the **preview** profile for regular phone UAT. It produces a standalone
Android APK with its JavaScript bundled inside, not the development-server
launcher. It does not require Metro, ngrok, a laptop, or a manual server URL.
The API still requires an internet connection. See
[Expo internal distribution](https://docs.expo.dev/tutorial/eas/internal-distribution-builds/).

From the repository root, with the private Expo token already configured:

```bash
infrastructure/scripts/eas-build-android-preview.sh
```

This explicitly starts a cloud build and uses the account's EAS build allowance.
It does not submit to either store. The CLI is pinned to `21.7.0` in both this
helper and the GitHub workflow; update them together after validation.

1. Wait for the build to finish successfully in the
   [Dinner Swipe EAS dashboard](https://expo.dev/accounts/data-centric-software-solutions/projects/dinner-swipe/builds).
2. Open that build's install link or QR code on Android and install its APK.
   Android may ask permission to install from the browser.
3. Open Dinner Swipe directly. If it asks for a development server URL, that is
   still the old development build, not the preview APK.
4. Test cold launch, sign-in, biometrics, email verification and return, recipe
   import, swiping, weekly drag/reset, grocery generation, and macro edits.
5. Repeat after force-closing the app and with no Metro server running.

The preview currently shares the package ID and signing identity of the existing
app; it is not a side-by-side staging installation. Preserve the signing key and
increase the Android version code for new releases. If Android rejects an
update, check signing/version codes before uninstalling and losing local data.

**Current backend:** `https://dinner.dcss.dev`, including live accounts, data,
and Stripe Checkout. Use private UAT access grants for charge-free testing; do
not enter real payment details for a billing test. An isolated staging API,
database, and Stripe sandbox are still roadmap work.

## Manual GitHub Build

`.github/workflows/mobile-preview.yml` adds **Android Preview** under Actions.
It is manual-only: pushing a commit does not queue an EAS build.

- Configure the GitHub `preview` environment and its `EXPO_TOKEN` secret; the
  private VPS token file is not automatically available to GitHub.
- Limit the environment to trusted branches and require approval before builds.
- Run the workflow on the intended commit. It runs mobile checks, then queues
  the Android preview build using existing EAS signing credentials.
- The workflow uses `--no-wait`. A green job means the cloud build was queued,
  **not** that the APK succeeded. Follow the printed EAS link to completion.
- A successful build still needs physical-device testing before sharing widely.

This follows [Expo's CI build flow](https://docs.expo.dev/build/building-on-ci/).
The workflow and profile alone do not create an APK or configure GitHub secrets.

## Optional Developer Sessions

Use Metro only for an engineer's interactive debugging session, not regular
tester access. Run locally:

```bash
npm run web -w apps/mobile
npm run start -w apps/mobile
```

Android development build:

```bash
cd /home/codexvps/Desktop/projects/dinner-swipe
infrastructure/scripts/eas-build-android-development.sh
```

The old development build requires a reachable Metro server to reconnect:

```bash
cd /home/codexvps/Desktop/projects/dinner-swipe
infrastructure/scripts/current-expo-tunnel.sh
```

The helper above only prints an existing tunnel URL. Do not start ngrok on the
shared VPS without first resolving the hosting provider's previous tunnel
restriction. Prefer local Wi-Fi or USB debugging when a developer session is
actually needed. Standalone preview builds avoid this dependency entirely.

## Project And Credentials

The EAS profiles point native builds at `https://dinner.dcss.dev` through `EXPO_PUBLIC_API_URL`. Change this only when preparing staging or production domain variants.

The Expo project is connected with EAS project ID:

```text
fbe8bf7c-1e7e-4ace-9cd8-68f231173d90
```

The Expo owner is:

```text
data-centric-software-solutions
```

The saved VPS token may authenticate as an individual Expo user such as `dcss_2026`.
That is expected as long as the user has access to the `data-centric-software-solutions`
account. The build owner is controlled by `apps/mobile/app.json`, not by the local shell
username.

The native package identifiers are:

```text
Android package: dev.dcss.dinnerswipe
iOS bundle identifier: dev.dcss.dinnerswipe
```

To run EAS builds from the VPS, authenticate first:

```bash
cd apps/mobile
npx eas-cli@latest login
```

For non-interactive builds, use a private Expo token file on the VPS or the
`EXPO_TOKEN` GitHub environment secret. Do not put token values in shell history,
logs, source files, or documentation.

On the VPS, store the token outside the repository:

```bash
cd /home/codexvps/Desktop/projects/dinner-swipe
infrastructure/scripts/save-expo-token.sh
```

That writes:

```text
~/.config/dinner-swipe/eas.env
```

with `0600` permissions. Future Android builds can then use:

```bash
cd /home/codexvps/Desktop/projects/dinner-swipe
infrastructure/scripts/eas-build-android-development.sh
infrastructure/scripts/eas-build-android-preview.sh
infrastructure/scripts/eas-build-android-production.sh
```

## Store Builds

The project is still on Expo SDK 51. Upgrade and validate the native toolchain
against current store requirements before submitting. See
[the release roadmap](store-release-and-cicd-roadmap.md).

Android production build (AAB for Play, not a directly installable APK):

```bash
cd apps/mobile
npx eas build --platform android --profile production
```

iOS TestFlight build:

```bash
cd apps/mobile
npx eas build --platform ios --profile production
```

Web export:

```bash
npm run build:web -w apps/mobile
```

Package identifiers are set in `app.json`; avoid changing them after store listings are created.

Over-the-air updates are **not configured** yet: there is no `expo-updates`
dependency, runtime version policy, or update URL. Until that work and a new
binary are complete, distribute another preview APK for client code changes.

Native manual recipe photos use `expo-image-picker`; iOS includes a photo-library usage description in `app.json`.

Native biometric unlock uses `expo-local-authentication`. iOS builds include a Face ID permission string through the Expo config plugin. Web builds gracefully show biometric unlock as unavailable.

## Expo Account

Create the Expo account at:

https://expo.dev/signup

Use the account that should own the Dinner Swipe EAS project. Expo supports email/password and social sign-in options. EAS cloud builds are the easiest path for Android development builds and later iOS TestFlight builds.

For app-store releases, Expo's current EAS Build docs note that Google Play distribution requires a Google Play Developer account and Apple App Store distribution requires Apple Developer Program access.
