# Header and safety settings release 25

Android preview build 25 aligns the fixed profile circle with each page's
header actions. Its size, theme, and fixed scrolling behavior are unchanged.
The owner-only shared-group disclosure is now called Group safety settings
and uses the existing warning-triangle icon. The top-level Group settings tab
and all safety update/ownership handlers remain unchanged.

## Release scope

- Frontend-only: web and standalone Android preview APK.
- No API, worker, database, provider, credentials, or schedule changes.
- No database migration or customer-plan reset.
- Retain the previous web image before replacement; rollback restores that
  image without database work or changes to other services.

## Validation

Implementation checks passed TypeScript, ESLint, and 247 mobile tests in 37
suites. Playwright verified all five headers and group safety disclosure at
320x720, 390x844, and 1280x900 against isolated synthetic-account data.

Release checks repeat those assertions against the compiled candidate and live
web assets. GitHub CI must pass before deployment. The APK must match the
release commit, package `dev.dcss.dinnerswipe`, build code 25, and build 24's
signing certificate. ZIP integrity and bundled feature checks accompany the
cryptographic signature check. Native physical-device UAT remains separate.

Final evidence is retained in the private `backups/releases/*_preview25`
directory, with release logs under `/tmp/dinner-preview25-*`.
