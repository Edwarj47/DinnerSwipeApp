# Web Voice And Meal Review

The web recorder submits a completed clip once and fills the editable description
automatically. Previewing foods and saving a recipe or daily entry are separate
user actions. A failed upload requires explicit retry; network retries reuse the
request identifier. Closing, cancellation and backgrounding clear the local clip
and ignore late responses. The recording limit remains 60 seconds/6 MB.

Nutrition agreement `fatsecret-terms-v2` covers optional OpenAI meal/voice
processing and FatSecret searches. Existing accounts accept this revision once;
prior acceptance is not silently upgraded. The Privacy and Terms pages contain
the full processing and retention details. Required provider attribution remains
where database content is displayed. No schema migration is required.

Meal review recommends matches using names, brands and preparation methods,
prefills compatible servings and explicit amounts, and leaves ambiguous portions
for user review. The private-space label is Personal in nutrition and workouts.
Calculator Log meal opens final review; Add to today performs the saved write.

Verification uses provider mocks, isolated SQLite accounts, and browser microphone
fixtures at 320, 390 and 1280 pixels. Production rollout replaces only the Dinner
Swipe API, worker and web containers after database/media backup verification.
Previous image tags and private backups provide rollback without dropping tables.

Expo SDK 51 and Android build 27 are unchanged. This is a web/API release, not an
APK build or native recording implementation. No Expo cloud build is submitted.
