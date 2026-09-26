# Store Release and CI/CD Roadmap

This roadmap keeps Dinner Swipe easy to edit, test, deploy, and eventually submit to Google Play and the Apple App Store without mixing secrets into the public repository.

## Current State

Reviewed 2026-09-26. Configuration is not evidence of a finished native build.

- Production web URL: `https://dinner.dcss.dev`
- API health URL: `https://dinner.dcss.dev/api/v1/health`
- EAS project owner: `data-centric-software-solutions`
- EAS project ID: `fbe8bf7c-1e7e-4ace-9cd8-68f231173d90`
- Android package: `dev.dcss.dinnerswipe`
- iOS bundle ID: `dev.dcss.dinnerswipe`
- GitHub repo: `git@github.com:Edwarj47/DinnerSwipeApp.git`
- Existing CI: backend lint/typecheck/tests, frontend lint/typecheck/tests/web build, Docker build validation.
- Native app: Expo SDK 51 / React Native 0.74.5. A supported SDK/toolchain upgrade is still needed for store submission.
- Android preview: build 6 completed successfully using the standalone APK profile and existing EAS signing key. APK integrity, bundled JavaScript, package/version, and API URL were checked. Physical-phone verification is pending; see the [build record and phone checklist](android-preview-uat.md).
- EAS access and Android signing-key availability are verified. This does not verify iOS signing or physical-device behavior.
- The owner confirmed on 2026-09-26 that neither Google Play nor Apple developer enrollment is complete. GitHub EAS secrets and iOS signing still need setup/verification.
- Preview currently uses the live API; isolated staging and EAS Update are not configured.

## Next Milestones

1. Install the completed standalone Android preview APK (build 6) and complete a physical-phone smoke test without Metro.
2. Set up a separate staging API/database, Stripe sandbox, and preview application identity before wider UAT or billing tests. Keep production data and credentials separate.
3. Upgrade Expo and native dependencies, then add EAS Update with compatible runtime versions and separate preview/production channels. Rebuild both platforms and test update rollback.
4. Configure store accounts, signing, regional billing, account deletion, privacy disclosures, support, crash monitoring, and review assets.
5. Distribute through Google Play internal testing and Apple TestFlight, resolve tester issues, then submit for public review.

The APK milestone does not need to wait for store approval. Store availability
and TestFlight access are separate milestones, not consequences of a Git push.

## Fast Deployment Model

The preferred backend/web deployment is GitHub plus VPS Docker Compose. The
following is the target flow, not a claim that automatic deployment exists yet:

1. Develop in this repository.
2. Push to GitHub.
3. GitHub Actions validates the build.
4. A controlled deploy step SSHes to the VPS, pulls the approved commit, builds containers, runs migrations, and restarts only Dinner Swipe services.
5. Caddy continues routing `dinner.dcss.dev` to the Dinner Swipe web/API services.

This keeps the live route stable while allowing fast rebuilds. It also avoids changing n8n, unrelated Postgres databases, unrelated Docker containers, or unrelated Caddy routes.

## CI/CD Work Still Needed

- The manual **Android Preview** workflow queues an APK after frontend checks. Add a protected GitHub `preview` environment and `EXPO_TOKEN` secret before using it. A green job means queued, not a finished APK, because it uses `--no-wait`.
- Add EAS Update after the SDK upgrade: install/configure `expo-updates`, define runtime compatibility, separate preview/production channels, require tests and production approval, and document rollback. Compatible JavaScript/assets can update without Metro; native dependencies and SDK changes require a new binary. See [EAS Update setup](https://docs.expo.dev/eas-update/getting-started/).
- Add a deploy workflow that runs only after CI passes on `main`.
- Add GitHub environment protection for production deploys.
- Add SSH deploy secrets:
  - `DINNER_SWIPE_DEPLOY_HOST`
  - `DINNER_SWIPE_DEPLOY_USER`
  - `DINNER_SWIPE_DEPLOY_SSH_KEY`
  - `DINNER_SWIPE_DEPLOY_PATH`
- Keep application secrets on the VPS `.env` or a real secret store. Do not put `DATABASE_URL`, `JWT_SECRET`, `OPENAI_API_KEY`, Stripe secrets, or SMTP passwords in GitHub unless a workflow explicitly needs them.
- Add a deploy script that performs:
  - `git fetch`
  - checkout of the requested commit
  - API/worker image build
  - Expo web export with Node 20
  - static nginx image build from `apps/mobile/dist`
  - database backup before migrations
  - Alembic migrations
  - `docker compose --profile production up -d`
  - API and web health checks
- Add a rollback script:
  - checkout previous known-good commit
  - rebuild/restart Dinner Swipe services
  - restore database only when a failed migration made that necessary

For the current VPS, prefer `infrastructure/scripts/build-web-static.sh` for
fast web-only deploys. Full Docker dependency installs are slow on this host and
should move to GitHub Actions or Azure Container Registry builds.

## Phone Testing Path

Use a standalone preview APK for Android UAT:

```bash
cd /home/codexvps/Desktop/projects/dinner-swipe
infrastructure/scripts/eas-build-android-preview.sh
```

Install the completed build from its EAS link/QR code. There is no development
server URL to enter and no Metro/ngrok dependency. The API still needs internet.
The build uses EAS allowance and must be explicitly started; this roadmap does
not queue it. Full instructions and GitHub prerequisites are in the
[EAS build guide](expo-eas-build-guide.md).

The development client remains optional for active engineering/debugging.
Do not make tester access depend on a VPS tunnel. For iPhone, prefer TestFlight
after the toolchain/signing work below; ad hoc previews require registered
devices and Apple provisioning.

## Google Play Roadmap

As of this review, new apps and updates must target Android 16 / API 36 from
August 31, 2026. Upgrade the Expo/React Native toolchain and verify the built
manifest; changing a version number alone is not sufficient.
[Google target API requirements](https://support.google.com/googleplay/android-developer/answer/11926878?hl=en).

1. Confirm the final package ID before creating the Play app. Current value: `dev.dcss.dinnerswipe`.
2. Create or confirm the DCSS Google Play Developer account.
3. Create the Dinner Swipe app in Play Console.
4. Enable Play App Signing.
5. Build a production Android App Bundle:

```bash
cd /home/codexvps/Desktop/projects/dinner-swipe
infrastructure/scripts/eas-build-android-production.sh
```

6. Complete Play Console app setup:
   - app name
   - short description
   - full description
   - app category
   - contact email
   - privacy policy URL
   - Data Safety form
   - content rating
   - target audience
   - app access instructions and demo credentials if required
   - screenshots and feature graphic
7. Add internal testers and upload the `.aab`.
8. Move from internal testing to closed/open/production only after smoke tests pass.

Personal Play accounts created after November 13, 2023 require at least 12
testers opted into a closed test continuously for 14 days before applying for
production access. Confirm the account type rather than assuming this applies
to the organization's account.
[Google testing requirements](https://support.google.com/googleplay/android-developer/answer/14151465?hl=en).

## Apple App Store and TestFlight Roadmap

Since April 28, 2026, App Store Connect uploads require Xcode 26 or later and
the iOS 26 SDK or later. Upgrade the SDK/toolchain and verify the EAS build
image before upload. TestFlight does not bypass these upload requirements.
[Apple SDK requirements](https://developer.apple.com/news/upcoming-requirements/).

1. Confirm the final iOS bundle ID before creating the App Store Connect record. Current value: `dev.dcss.dinnerswipe`.
2. Create or confirm the DCSS Apple Developer Program membership.
3. Create the Dinner Swipe app in App Store Connect.
4. Configure EAS credentials with either Expo-managed credentials or an App Store Connect API key.
5. Build the iOS production/TestFlight build:

```bash
cd /home/codexvps/Desktop/projects/dinner-swipe
npx eas-cli@latest build --platform ios --profile production
```

6. Complete App Store Connect setup:
   - app name
   - subtitle
   - description
   - keywords
   - support URL
   - marketing URL if used
   - privacy policy URL
   - app privacy details
   - screenshots
   - review contact
   - demo account and notes for review
7. Submit the first TestFlight build for beta review.
8. Invite internal testers first, then external testers after Apple approves the first beta build.

## Premium and Billing Decision

Dinner Swipe currently implements Stripe Checkout for web subscriptions:

- Basic: a card-backed 30-day trial, then `5.99 USD/month` unless canceled.
- Premium: Basic plus macro tracking, `9.99 USD/month`, charged immediately.
- The September 23 UAT diagnostic verified live Stripe configuration; no paid test transaction was made. Preview currently shares that API, so use private access grants for charge-free UAT.

For store release, billing must be handled carefully:

- Web subscriptions can use Stripe.
- Choose launch countries and either implement Apple In-App Purchase / Google Play Billing or validate the applicable regional alternative billing/link-out rules and enrollment obligations.
- Existing generic external Stripe buttons are not evidence of a globally store-compliant native purchase flow. Do not ship them unchanged without that review.

Check the current [Apple payments guidelines](https://developer.apple.com/app-store/review/guidelines/#payments)
and [Google payments policy](https://support.google.com/googleplay/android-developer/answer/10281818?hl=en)
for the actual storefronts before implementation or submission.

Recommended MVP path:

1. Keep native beta free while testing.
2. Keep Stripe checkout for web subscriptions.
3. Use local UAT codes only for private testers, then rotate or remove them.
4. Show subscription status in native, but do not link to external Stripe checkout from public native builds.
5. Add native subscription support before public native monetization.

## Store Assets Needed

- Final app icon and adaptive Android icon.
- Splash screen.
- App Store screenshots.
- Google Play screenshots.
- Google Play feature graphic.
- Short app description.
- Full app description.
- Support URL.
- Privacy policy URL.
- Terms URL.
- Demo/review account.
- Clear explanation of account creation, recipe ingestion, group voting, grocery links, and premium features.

## Product Readiness Before Store Submission

- Finish current phone UX cleanup.
- Verify standalone cold startup, background/resume, biometric cancellation, expired sessions, and offline/retry behavior on physical Android and iOS devices.
- Verify email verification from a fresh account.
- Verify URL recipe import and approval using live public recipe pages.
- Verify manual recipe creation with uploaded photo.
- Finish group creation and multi-group switching before promising unlimited Premium groups; verify invites, votes, ownership, and tier enforcement.
- Verify allergens/dislikes warnings or blocking settings.
- Verify grocery list generation and preferred grocery search links.
- Verify data export and end-to-end account deletion, including a web request path and retention handling. A recorded manual deletion request alone does not demonstrate that deletion is fulfilled.
- Add crash/error monitoring before production release.
- Add automated backups and restore drill documentation.
- Complete a security review of auth, SSRF protections, recipe import safety, file upload limits, and secret handling.

## Long-Term Deployment Path

The VPS is suitable for MVP and private beta. For growth, keep the app portable:

- Keep Docker images as the deployable unit.
- Keep app state in PostgreSQL plus object/media storage.
- Keep EAS for native builds.
- Move media to object storage before large public usage.
- Add managed Postgres, Redis/rate limiting, CDN/static hosting, and centralized logs when traffic grows.
- The Azure migration path should use container images, managed Postgres, object storage, and GitHub-based deployment approvals.
