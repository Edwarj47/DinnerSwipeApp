# Expo and EAS Build Guide

Run locally:

```bash
npm run web -w apps/mobile
npx expo start -w apps/mobile
```

Android development build:

```bash
cd /home/codexvps/Desktop/projects/dinner-swipe
infrastructure/scripts/eas-build-android-development.sh
```

Android development build reconnect:

```bash
cd /home/codexvps/Desktop/projects/dinner-swipe
infrastructure/scripts/current-expo-tunnel.sh
```

Paste the printed `http://...exp.direct` URL into the Dinner Swipe development
build's manual URL field. Do not use the default `10.0.0.25:8081` placeholder
unless Metro is running from a computer on the same Wi-Fi network as the phone.

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

For non-interactive VPS or CI builds, create an Expo access token in the Expo dashboard and run:

```bash
export EXPO_TOKEN=<expo-access-token>
cd apps/mobile
npx eas-cli@latest build --profile production
```

Do not commit `EXPO_TOKEN`.

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
infrastructure/scripts/eas-build-android-production.sh
```

Android production build:

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

Native manual recipe photos use `expo-image-picker`; iOS includes a photo-library usage description in `app.json`.

Native biometric unlock uses `expo-local-authentication`. iOS builds include a Face ID permission string through the Expo config plugin. Web builds gracefully show biometric unlock as unavailable.

## Expo Account

Create the Expo account at:

https://expo.dev/signup

Use the account that should own the Dinner Swipe EAS project. Expo supports email/password and social sign-in options. EAS cloud builds are the easiest path for Android development builds and later iOS TestFlight builds.

For app-store releases, Expo's current EAS Build docs note that Google Play distribution requires a Google Play Developer account and Apple App Store distribution requires Apple Developer Program access.
