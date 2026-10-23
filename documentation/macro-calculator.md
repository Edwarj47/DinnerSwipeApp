# Macro Calculator

## Behavior

Premium Macro Tracker has a Calculator button above Save as recipe. The
modal holds up to 30 items in memory. Each item has a user-entered label,
serving multiplier, and either manual nutrition or a selected database serving.
Search is explicit, not autocomplete. Food results and serving choices appear
inside the calculator only. Added items collapse into an editable/removable
stack. Totals keep unknown nutrients unknown rather than treating them as zero.
The refresh icon beside Total refreshes database values without saving a recipe
or creating a macro entry.

The calendar beside New item selects the meal date. New manual and AI calculations
start on the day selected in Macro Tracker, defaulting to the device's local date
when no day is provided. Existing logged calculations open on their saved date;
changing it and confirming Update moves the same entry instead of making a copy.
Selecting a calendar date alone never saves or logs anything. Recipes do not have
a logged date, and copying a calculation to a recipe does not move the original entry.

Log meal opens a name/category/date review; the final Add to today or Add to day
confirmation logs one aggregate entry on the selected date.
Save as recipe prompts for a name, category, and
recipe yield and saves ingredients plus per-serving nutrition. Saved stacks can
be reopened through Edit nutrition or a linked macro entry. Logging a saved
recipe and weekly Ate confirmations retain serving scaling.

AI meal review recommends a food match from the existing bounded search results,
preferring matching food names, stated brands, and preparation methods. Compatible
servings and explicitly reported quantities are prefilled and marked Recommended;
users can change the food, serving, or amount before continuing. Missing amounts
and incompatible measures remain blank instead of guessing weights or density.
Previewing or continuing to the calculator never logs or saves automatically.

Completed web recordings transcribe automatically once and append to the editable
meal description. Preview meal remains a separate action. Failed uploads never
retry automatically; an explicit retry reuses the request ID after a connection
failure. Cancellation, closing and backgrounding abort the request and clear
the browser clip. The recorder no longer shows example food text or repeated
provider disclosures. Nutrition-tool consent covers the provider processing once
per policy revision, with full details on the public Privacy and Terms pages.

Targets remain user-entered daily reference values shown in Trends alongside
totals and averages, and the calorie target scales Calendar bars. Goal is a saved
free-text note only; it does not calculate targets or modify planning.

## Provider Data

fatsecret food/serving identifiers, user labels, and user-entered portions are
persisted. API nutrition, food names, serving descriptions, and derived totals
are not stored in recipe profiles, macro entry columns, offline receipts, or
exports. Manual nutrition remains persistable. Saved provider calculations are
resolved against the existing bounded RAM cache/API when viewed, with a shared
eight-second lookup-start deadline per macro history request. Provider failures leave
entry nutrition unknown and expose an incomplete-total warning.

Client provider views expire after 15 minutes, including on foreground resume.
Expired values are removed before refresh is attempted. Offline copies retain
references and manual entries but strip provider values. Exports include
references instead of provider snapshots. The server cache has a 23-hour
maximum, leaving margin below the provider's 24-hour content lifetime.

The app includes the official attribution link wherever database nutrition is
displayed, public legal-page attribution, provider terms in app terms, and a
one-time account acceptance before using database lookup. When store listings are published, include:
"Powered by fatsecret nutrition API" (www.fatsecret.com).

Sources: https://platform.fatsecret.com/terms,
https://platform.fatsecret.com/docs/guides/storable-data,
https://platform.fatsecret.com/attribution.

## Database And Release

Migration c76219a8410b follows b981fc2a7610 and adds only nutrition_calculations.
It links one recipe or one macro entry, stores validated items and an idempotent
request fingerprint, and cascades on target deletion. It does not alter other
application tables. Downgrade intentionally does not delete user calculations.
Back up Dinner Swipe PostgreSQL before a production migration; roll back the
application image while retaining additive tables if necessary.

Deploy the migration and API before releasing the calculator UI. Secrets stay
in server-side environment files, never in Expo or Git. The existing daily
budget and rate limiting apply; there is no catalog discovery or new scheduled
crawler. Development tests use mock foods and isolated databases, not provider
calls or the production account.
