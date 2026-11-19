export const privacySections = [
  {
    title: "Nutrition Tools Agreement",
    body:
      "Food database searches and meal AI use a shared, optional agreement saved to your account. We record the agreement revision and acceptance time. Accepting a previous fatsecret-only revision does not opt you into this revision. Acceptance covers the calculator and meal AI without a new agreement for each search or recording, but it does not start recording or send a meal description by itself. You can choose not to use these tools; typing a meal and recording voice are optional."
  },
  {
    title: "Optional Meal AI And Voice",
    body:
      "When you submit a meal description to meal AI, Dinner Swipe sends that text to OpenAI to identify foods and quantities. If you choose voice, a completed recording you submit goes through our server to OpenAI for transcription; it is not live-streamed as you speak. The transcript is returned for your review and, when you submit it as your meal description, goes to OpenAI for food identification. Food search terms derived from the description then go to fatsecret to find nutrition matches. Avoid including personal, sensitive or other people's information that is not needed to describe your food. OpenAI processes submitted text and audio under its applicable data-processing and retention policies. Dinner Swipe does not promise zero retention by OpenAI. OpenAI's API data controls are described at https://developers.openai.com/api/docs/guides/your-data."
  },
  {
    title: "Recording, Transcript And Meal Draft Handling",
    body:
      "Our server handles audio only to validate, convert and transcribe your submitted recording. Temporary conversion files are removed after conversion completes or fails, and audio is not saved to your account. Standalone transcripts are held only in server memory for up to five minutes to handle a repeated request, not stored as transcripts in our database. If you submit transcript text as a meal description, derived meal names, food descriptions, search terms and portions may be stored with food identifiers in a meal draft available for up to one hour. The one-hour limit controls draft access, not automatic deletion from server storage. Discarding a draft clears its draft content. Job status, request fingerprints and usage records may remain for reliability and limits. Saving is a separate action after you review the result."
  },
  {
    title: "Food Database Lookups",
    body: "When you search the nutrition database or submit a meal for AI matching, Dinner Swipe sends your food search terms through our server to fatsecret. Fatsecret receives these food search terms and requested food identifiers, not the voice recording or the full meal description through this integration. Database names, serving descriptions and nutrition are temporary, not stored as permanent copies. Saved calculations retain food and serving identifiers, your labels and portions, and any manually entered nutrition. Database values are refreshed for display and are unavailable offline. Required fatsecret attribution remains wherever its content is displayed."
  },
  {
    title: "Information We Collect",
    body:
      "Dinner Swipe may collect account information, profile preferences, household and group membership, recipe data you create or import, recipe URLs you submit, uploaded photos, weekly meal plans, grocery list items, pantry exclusions, and support communications. We record meal choices (plan, favorite, skip, and hide), when they happen, and when a plan is undone to provide weekly picks and understand product usage. These choices are included in your account data export."
  },
  {
    title: "Recipe And Web Ingestion Data",
    body:
      "When you submit a public recipe URL, Dinner Swipe fetches and analyzes the page to create a reviewable recipe candidate. Source URLs, source titles, detected images, extraction warnings, confidence metadata, and approval history may be stored to preserve attribution and provenance."
  },
  {
    title: "AI Recipe Processing",
    body:
      "When you choose Create draft in Add with AI, Dinner Swipe sends the description and photo you provide to OpenAI to generate a recipe or read a nutrition label. We save the resulting draft, including any extracted nutrition, until you save or discard it, and retain generation status and usage records. The input photo is not added to your recipe or retained in Dinner Swipe's recipe-photo storage. Photos you separately attach to a recipe are stored as recipe photos. OpenAI processes submitted content under its applicable data-processing and retention policies; Dinner Swipe does not promise zero retention by the provider. Avoid submitting personal or sensitive information that is not needed for your recipe."
  },
  {
    title: "Group Voting",
    body:
      "Members of a dinner group can vote on recipe ideas. Group owners may see vote summaries, percentages, counts, winners and non-winning choices, and which member voted for each visible choice. Zero-count choices are not shown in owner vote detail charts. Group owners can also configure whether member allergens and disliked ingredients are used as warnings or filters during group voting."
  },
  {
    title: "Preferences And Allergens",
    body:
      "Cooking preferences, disliked ingredients, and allergens are stored per user. When you join or use a dinner group, allergen and disliked-ingredient matches may be used to warn, block, or annotate recipe choices and may be visible to other group members or owners. These settings are intended to help filter and annotate meal planning, but Dinner Swipe is not a medical, allergy, or nutrition safety system."
  },
  {
    title: "How We Use Information",
    body:
      "Information is used to operate the app, authenticate users, support meal discovery, generate grocery lists, support group voting, preserve recipe attribution, troubleshoot issues, improve the product, and communicate with users."
  },
  {
    title: "App Software Updates",
    body:
      "Native Dinner Swipe builds may check Expo's EAS Update service for compatible app code and assets. These requests include network and technical update information such as platform, app runtime, channel and update identifiers. This delivery integration does not send your meals, voice recordings, nutrition logs or account credentials to Expo. The app keeps its embedded or previously cached code available when an update cannot be downloaded. Native voice clips use temporary private app-cache files; removal is attempted after successful transcription, discard or cancellation. Files may remain in that private cache if the operating system terminates the app before cleanup finishes."
  },
  {
    title: "Third-Party Services",
    body:
      "Dinner Swipe may use hosting, database, email, analytics, AI, app-build, payment, and infrastructure providers. Retailer links are search links only. Dinner Swipe does not automate retailer login, cart actions, or checkout."
  },
  {
    title: "Subscription And Billing Data",
    body:
      "Dinner Swipe stores subscription status, product and billing-provider identifiers, verification and billing events, welcome-access timing, and relevant support records. Where native purchases are offered, Apple or Google handles checkout; supported web checkout uses Stripe. Store evidence is verified by our backend, and provider references are stored encrypted where required by the native billing integration. We retain limited detached billing and purchase-ownership records after account deletion to prevent purchase reassignment and handle legitimate billing obligations. Full payment-card details are handled by the purchasing provider, not stored directly by Dinner Swipe."
  },
  {
    title: "Sharing",
    body:
      "Data Centric Software Solutions LLC does not sell personal information. Information may be shared with service providers, infrastructure providers, professional advisors, or other parties when reasonably necessary to operate the app, protect systems, provide support, or comply with legal obligations."
  },
  {
    title: "Macro Tracking And Workout Records",
    body:
      "If you use macro tracking, Dinner Swipe stores your meal dates, labels, portions, notes, targets and saved calculation references. Manually entered nutrition can be stored; nutrition returned by fatsecret remains temporary as described above. Workout features store your templates, weekly choices and performance logs, including exercise names, sets, repetitions, weights, durations, completion status and notes you enter. These records can reveal health and fitness information. Shared workout templates and group planning choices are visible to the relevant group; your personal performance logs are account-specific. Dinner Swipe does not currently connect to Garmin or read Apple Health or Android Health Connect data."
  },
  {
    title: "Device Settings And Security",
    body:
      "The app can save appearance preferences, selected groups, measurement units and optional planning-reminder preferences. Native session credentials are stored using the device's secure-storage facilities; web sign-in uses session cookies. Optional biometric unlock uses your device's authentication service. Dinner Swipe does not receive or store your fingerprint or facial biometric template. Reminder permission is optional; planning reminders are scheduled locally on your device."
  },
  {
    title: "Account Data And Deletion",
    body:
      "You can export data and initiate account deletion in User settings, Account, Data and legal, or at https://dinner.dcss.dev/delete-account after signing in, without a paid subscription. Confirming permanent deletion revokes access and removes your account records, private content, and original recipes and workouts you shared. Other members' independently owned copies and personal logs remain. Transfer shared-group ownership first, or use the existing leave control for a sole-member group. Cleanup failures remain pending and are retried; a pending receipt is not confirmation of completed erasure. An older app or an unavailable fulfillment service may instead submit a manual-review request. Deletion and uninstalling do not cancel external billing or create a refund; manage renewal with the purchasing provider. Deletion need not wait for a paid period to end, but a deleted account's purchases cannot automatically transfer to a new Dinner Swipe account. We retain minimal deletion-suppression and billing records where necessary. Restricted recovery backups can retain residual data; no automatic backup-expiry period is currently promised. Deleted accounts must not be reactivated through a backup restore. Contact dinnerswipe@dcss.dev with a pending receipt or if you cannot access your account."
  },
  {
    title: "Contact",
    body:
      "Privacy questions can be sent to dinnerswipe@dcss.dev."
  }
];

export const termsSections = [
  {
    title: "Optional Nutrition Tools Agreement",
    body:
      "Before using food database searches or meal AI, you must explicitly accept the current nutrition tools agreement for your account. This agreement covers both tools, the Dinner Swipe Terms of Service, acknowledgement of the Privacy Policy, and the fatsecret Platform API Terms of Use. A previous fatsecret-only acceptance is not acceptance of this revision. We save the accepted revision and time; you are not asked to accept it for each recording or search. If the agreement changes, you must review and accept the new revision before using these tools again. Acceptance alone does not record audio or submit text, and voice and meal AI remain optional."
  },
  {
    title: "Meal AI, Voice And Review Before Saving",
    body:
      "Submitting text to meal AI authorizes Dinner Swipe to send your meal description to OpenAI to identify foods. Choosing to submit a completed voice recording authorizes us to send it to OpenAI for transcription. After you review and submit the transcript, it is processed as a meal description. Derived food search terms then go to fatsecret for nutrition matching. These providers process the submitted content under the policies described in our Privacy Policy; we do not guarantee zero provider retention. You must have permission to submit the text and audio you provide. Review and correct transcripts, food matches, cooking methods, serving sizes, portions and nutrition before saving or using a result. AI and database matches can be wrong; missing or ambiguous amounts require your review. A draft or transcription does not automatically save a meal, recipe or macro entry."
  },
  {
    title: "fatsecret Nutrition Database",
    body: "By using Dinner Swipe's fatsecret food database features, you agree to be bound by the fatsecret Platform API Terms of Use at https://platform.fatsecret.com/terms. Nutrition is provided for factual tracking only, not as health advice or a substitute for medical consultation, evaluation or treatment. Values may change when refreshed; review product labels for accuracy. Database values are temporary and are excluded from permanent offline copies and exports."
  },
  {
    title: "Use Of Dinner Swipe",
    body:
      "Dinner Swipe is provided by Data Centric Software Solutions LLC as a meal discovery, recipe organization, weekly planning, group voting, and grocery list application. You may use the app only in a lawful manner and may not attempt to disrupt, misuse, or gain unauthorized access to related systems."
  },
  {
    title: "Accounts And Groups",
    body:
      "You are responsible for your account activity and group invite codes. Dinner group owners can view group-level vote results and voter detail for visible choices, manage group safety settings, and transfer ownership to another member. Do not join or invite users to a group unless everyone involved has permission to participate."
  },
  {
    title: "Recipes, Photos, And Sources",
    body:
      "You are responsible for recipe content and photos you create, upload, import, approve, or share. URL-ingested and file-imported recipes require review before approval. Preserve attribution and do not use content in ways that violate another party's rights."
  },
  {
    title: "AI-Assisted Recipes And Nutrition",
    body:
      "Add with AI is optional. Selecting Create draft submits your description and any selected photo to OpenAI for processing as described in the Privacy Policy. AI-generated recipes and extracted label values can contain errors. Review ingredients, nutrition amounts, serving sizes and preparation steps before saving or using them. Nutrition is a planning aid, not medical advice. You must have permission to submit the text and photos you provide."
  },
  {
    title: "Food, Allergy, And Nutrition Disclaimer",
    body:
      "Dinner Swipe is not medical, nutritional, allergy, food-safety, or professional advice. If you enter allergens or disliked ingredients and use group features, you acknowledge that related matches or warnings may be shared with group members. Always review ingredients, labels, preparation steps, and allergen risks before cooking or serving food."
  },
  {
    title: "Subscriptions",
    body:
      "Basic is free. Eligible new verified accounts may receive 30 days of complimentary Premium without a payment card. This welcome access expires without an automatic charge; Basic remains free, and paid Premium requires a separate purchase. The intended U.S. Premium reference price is USD 9.99 per month; the purchasing provider displays the actual localized price, applicable tax and renewal terms before confirmation. Existing subscriptions keep their current terms. Usage limits apply to AI, voice, and database requests. Paid subscriptions renew until cancelled through the provider where purchased. Restoring purchases is not a new purchase or a new complimentary month. Deleting an account or uninstalling the app does not cancel billing or create a refund. Refund requests follow the purchasing provider's process and applicable law; mandatory consumer rights are not excluded. Accepting app terms does not authorize a charge."
  },
  {
    title: "Third-Party Links And Retailers",
    body:
      "The app may link to public recipe websites and retailer search pages. Third-party sites control their own content, pricing, policies, availability, and privacy practices. Dinner Swipe does not automate checkout or guarantee product matches."
  },
  {
    title: "Availability And Changes",
    body:
      "The app may change over time, especially during MVP development. Features may be added, changed, limited, or removed as the product is tested and improved."
  },
  {
    title: "Disclaimer",
    body:
      "Dinner Swipe is provided on an as-is and as-available basis without warranties of any kind, to the maximum extent permitted by law."
  },
  {
    title: "Contact",
    body:
      "Questions regarding these Terms can be sent to dinnerswipe@dcss.dev."
  }
];
