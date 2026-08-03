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
