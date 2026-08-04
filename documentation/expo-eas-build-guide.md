# Expo and EAS Build Guide

Run locally:

```bash
npm run web -w apps/mobile
npx expo start -w apps/mobile
```

Android development build:

```bash
cd apps/mobile
npx eas build --platform android --profile development
```

The EAS profiles point native builds at `https://dinner.dcss.dev` through `EXPO_PUBLIC_API_URL`. Change this only when preparing staging or production domain variants.

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

Package identifiers are placeholders in `app.json` and should be changed before store work.

Native manual recipe photos use `expo-image-picker`; iOS includes a photo-library usage description in `app.json`.

Native biometric unlock uses `expo-local-authentication`. iOS builds include a Face ID permission string through the Expo config plugin. Web builds gracefully show biometric unlock as unavailable.

## Expo Account

Create the Expo account at:

https://expo.dev/signup

Use the account that should own the Dinner Swipe EAS project. Expo supports email/password and social sign-in options. EAS cloud builds are the easiest path for Android development builds and later iOS TestFlight builds.

For app-store releases, Expo's current EAS Build docs note that Google Play distribution requires a Google Play Developer account and Apple App Store distribution requires Apple Developer Program access.
