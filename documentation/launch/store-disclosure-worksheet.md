# Store Privacy And Health Disclosure Worksheet

Prepared November 18, 2026 from application source and integration review. This is
a draft worksheet, not a submitted or certified Google/Apple declaration. Final
answers must describe the exact released binary, backend, SDKs and actual providers,
including optional paths. Recheck console wording when completing the forms.

## Data Inventory

| App behavior | Google category candidates | Apple category candidates | Purposes and linkage |
| --- | --- | --- | --- |
| Account email and support correspondence | Personal info; messages as applicable | Contact info; customer support | Account and support; linked |
| App user ID, session/account binding | User IDs; device/other IDs only where definition fits | User ID | Authentication, security and service; linked |
| Recipe text, imports, ingredient lists, notes, URLs | Other user-generated content; files/docs for imports | Other user content | App functionality; linked |
| Recipe photos and optional submitted AI images | Photos | Photos or videos | App functionality; optional; linked where saved |
| Completed voice clip sent for transcription | Voice or sound recordings | Audio data | App functionality; optional; evaluate ephemeral-processing definition |
| Macro logs, food amounts, dietary targets and allergens | Health info | Health | Tracking, requested matching, safety preferences; linked and sensitive |
| Personal workout performance and session history | Fitness info | Fitness | Tracking and planning; linked |
| Food search queries and derived matching queries | In-app search history | Search history | App functionality; optional matching; account context exists |
| Votes, favorites, swipes, skips, undo and planning actions | App interactions | Product interaction | App functionality/reliability; linked |
| Store/Stripe subscription status, transaction references | Purchase history; financial info as applicable | Purchase history | Payment verification and fraud prevention; linked |
| Errors, job status, usage counters and delivery diagnostics | Diagnostics; other app-performance data as applicable | Diagnostics | Reliability/security; inspect exact fields before claiming unlinked |
| Optional retailer ZIP preference supported by API/model | Address/coarse-location candidate | Physical address/coarse-location candidate | Verify UI, persistence and actual collection; do not declare absent solely because no current mobile control was found |

Do not declare card numbers collected by Dinner Swipe merely because a platform
handles checkout. Do include purchase identifiers and history received by our
backend. Do not declare biometric templates collected: OS authentication does not
send those templates to Dinner Swipe. Do not declare Garmin/HealthKit/Health Connect
access; those integrations are not implemented. Do not classify every runtime or
update ID as a persistent personal device identifier without examining its meaning.

## Collection, Sharing And Retention Decisions

Data leaving the device for our backend or providers can count as collection even
when optional. Assess Google's ephemeral-processing exemption separately for each
path; audio conversion cleanup does not make the provider's processing automatically
exempt, and stored meal-draft content is not ephemeral. Apple and Google use different
definitions of collection, linkage, sharing and tracking; do not copy one answer
set into the other.

Account, health, fitness, purchase and saved content are generally linked to the
user. A short retention period or a hashed ID does not by itself make data unlinked.
For Google sharing exemptions, verify the service-provider relationship and user-
initiated transfers; a disclosure in the privacy policy alone does not create an
exemption. Include OpenAI, fatsecret, store billing, Stripe web billing, email and
infrastructure in the assessment. Expo update delivery has its own technical data.

No advertising SDK was identified in the reviewed application source. This is not
proof that every transitive native SDK collects nothing. Inspect the final merged
Android permissions and iOS privacy manifests, required-reason APIs and network
behavior. Only answer no tracking after confirming there is no qualifying cross-
company tracking in the released configuration. No ATT prompt is required merely
because the app has an account, but that does not excuse undisclosed tracking.

## Google Play Worksheet

- App access: prepare review credentials with seeded synthetic content; explain any
  verification or paywall steps and keep the credentials private and working.
- Data Safety: describe actual categories above, required/optional collection,
  purposes, linkage-equivalent account relationships, sharing and encryption.
- Account deletion: in-app path plus https://dinner.dcss.dev/delete-account; explain
  retention exceptions and verify fulfillment before claiming it is available.
- Health apps declaration: evaluate Activity and Fitness and Nutrition and Weight
  Management for the existing features. Do not claim medical-device functionality
  or Health Connect permissions that do not exist.
- Target audience, content rating and ads: owner decisions must match product access
  and SDK behavior; minimum age is not established by this draft.
- User-generated content: review group sharing, reporting/blocking and moderation
  obligations before claiming every public-release policy requirement is satisfied.
- Initial availability: U.S. and EU countries only as requested; choose the actual
  countries in Play Console rather than a global release.

Internal testing and public/closed/open tracks have different form requirements;
an internal test working does not establish public-launch compliance. Adding a
person to an internal tester list is not the same as configuring license testing.
Use licensed test payment methods to avoid real subscription charges during QA.

## Apple Worksheet

- App Privacy: declare account-linked health, fitness, user content, purchases,
  searches and usage/diagnostics according to actual collection and purpose.
- Privacy policy/support URLs: public, reachable and consistent with the binary.
- Microphone/photo permission strings: specific to the requested action and optional;
  inspect merged manifests, entitlements and required-reason declarations.
- Subscriptions: product name, monthly period, localized price, renewal/cancellation
  terms, functional restoration, privacy policy and terms links before purchase.
- Deletion: straightforward initiation and confirmation in-app; include original
  shared contributions, not merely account deactivation or a mandatory email request.
- App review notes: test account, instructions and sandbox subscription behavior;
  distinguish 30-day no-card welcome access from paid store subscriptions.
- Territorial availability, EU trader disclosures, age rating, export-compliance and
  agreements require the owner's verified account details. Do not mark them complete
  while enrollment, signing or contracts are pending.

## Required Sign-off Evidence

Record exact app version/runtime, binary hash, backend release, enabled flags, SDK
inventory, provider configurations, test-account roles, screenshots and test dates.
Verify purchase/restoration/refund/pending/expiry, deletion from native and web,
microphone denial and recovery, offline behavior, account switching, and accessibility
on actual Android and iOS devices. No live-customer account should be used for erasure
testing. Publish reviewed legal documents and submit forms only after the owner
confirms the remaining policy decisions.

## Official References

- [Google Data Safety](https://support.google.com/googleplay/android-developer/answer/10787469?hl=en)
- [Google account deletion](https://support.google.com/googleplay/android-developer/answer/13327111?hl=en)
- [Google health declaration](https://support.google.com/googleplay/android-developer/answer/14738291?hl=en)
- [Apple App Privacy](https://developer.apple.com/app-store/app-privacy-details/)
- [Apple account deletion](https://developer.apple.com/help/app-review/guideline-reference/5-1-1-account-deletion)
- [Apple purchase guidelines](https://developer.apple.com/app-store/review/guidelines/#in-app-purchase)
- [EU GDPR](https://eur-lex.europa.eu/eli/reg/2016/679/oj/eng)
- [FTC health-app breach guidance](https://www.ftc.gov/business-guidance/resources/health-breach-notification-rule-basics-business)
