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
    title: "Third-Party Services",
    body:
      "Dinner Swipe may use hosting, database, email, analytics, AI, app-build, payment, and infrastructure providers. Retailer links are search links only. Dinner Swipe does not automate retailer login, cart actions, or checkout."
  },
  {
    title: "Subscription And Billing Data",
    body:
      "Dinner Swipe may store subscription status, plan tier, billing provider identifiers, billing events, trial timing, and support records. Payment cards and checkout are handled by the billing provider and are not stored directly by Dinner Swipe."
  },
  {
    title: "Sharing",
    body:
      "Data Centric Software Solutions LLC does not sell personal information. Information may be shared with service providers, infrastructure providers, professional advisors, or other parties when reasonably necessary to operate the app, protect systems, provide support, or comply with legal obligations."
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
      "Dinner Swipe may offer a Basic subscription for app access with a card-on-file trial and a Premium subscription for macro tracking. Paid subscriptions are authorized through the billing checkout flow, renew until cancelled, and are subject to the price and trial terms shown at checkout. App terms acceptance alone does not authorize a card charge."
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
