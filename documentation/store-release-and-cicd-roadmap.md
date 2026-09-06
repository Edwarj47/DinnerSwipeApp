# Store Release and CI/CD Roadmap

This roadmap keeps Dinner Swipe easy to edit, test, deploy, and eventually submit to Google Play and the Apple App Store without mixing secrets into the public repository.

## Current State

- Production web URL: `https://dinner.dcss.dev`
- API health URL: `https://dinner.dcss.dev/api/v1/health`
- EAS project owner: `data-centric-software-solutions`
- EAS project ID: `fbe8bf7c-1e7e-4ace-9cd8-68f231173d90`
- Android package: `dev.dcss.dinnerswipe`
- iOS bundle ID: `dev.dcss.dinnerswipe`
- GitHub repo: `git@github.com:Edwarj47/DinnerSwipeApp.git`
- Existing CI: backend lint/typecheck/tests, frontend lint/typecheck/tests/web build, Docker build validation.

## Fast Deployment Model

The preferred short-term deployment is GitHub plus VPS Docker Compose:

1. Develop in this repository.
2. Push to GitHub.
3. GitHub Actions validates the build.
4. A controlled deploy step SSHes to the VPS, pulls the approved commit, builds containers, runs migrations, and restarts only Dinner Swipe services.
5. Caddy continues routing `dinner.dcss.dev` to the Dinner Swipe web/API services.

This keeps the live route stable while allowing fast rebuilds. It also avoids changing n8n, unrelated Postgres databases, unrelated Docker containers, or unrelated Caddy routes.

## CI/CD Work Still Needed

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

## Development Build Path

Use the Android development build for phone testing while the app is changing quickly.

When Metro is running on the VPS, the dev client needs the active Expo tunnel URL, not a local Wi-Fi IP. Print the current URL with:

```bash
cd /home/codexvps/Desktop/projects/dinner-swipe
infrastructure/scripts/current-expo-tunnel.sh
```

If Metro is not running, start it with:

```bash
cd /home/codexvps/Desktop/projects/dinner-swipe
infrastructure/scripts/start-expo-dev-client.sh
```

Paste the printed `http://...exp.direct` URL into the Android development build's manual URL field.

## Google Play Roadmap

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

Note: Google requires app setup items such as Data Safety and privacy information before broader release. Personal Play accounts created after November 13, 2023 may have additional closed-testing requirements before production access.

## Apple App Store and TestFlight Roadmap

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

Dinner Swipe currently has a Stripe-ready subscription foundation:

- Basic web subscription: app access after the first free month, planned at `5.99 USD/month`.
- Premium web subscription: Basic plus macro tracking, planned at `9.99 USD/month`.

For store release, billing must be handled carefully:

- Web subscriptions can use Stripe.
- Native iOS premium digital features generally need Apple In-App Purchase if purchasing is offered inside the app.
- Native Android premium digital features generally need Google Play Billing if purchasing is offered inside the app.

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
- Verify dev-client startup and biometric resume behavior.
- Verify email verification from a fresh account.
- Verify URL recipe import and approval using live public recipe pages.
- Verify manual recipe creation with uploaded photo.
- Verify group creation, invite, vote, and vote summary.
- Verify allergens/dislikes warnings or blocking settings.
- Verify grocery list generation and preferred grocery search links.
- Verify data export and delete request.
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
