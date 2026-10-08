# Macro Calculator

## Behavior

Premium Macro Tracker has an icon-only calculator beside Save as recipe. The
modal holds up to 30 items in memory. Each item has a user-entered label,
serving multiplier, and either manual nutrition or a selected database serving.
Search is explicit, not autocomplete. Food results and serving choices appear
inside the calculator only. Added items collapse into an editable/removable
stack. Totals keep unknown nutrients unknown rather than treating them as zero.
The refresh icon beside Total refreshes database values without saving a recipe
or creating a macro entry.

Add to today prompts for a meal name and category and logs one aggregate entry
on the device's local date. Save as recipe prompts for a name, category, and
recipe yield and saves ingredients plus per-serving nutrition. Saved stacks can
be reopened through Edit nutrition or a linked macro entry. Logging a saved
recipe and weekly Ate confirmations retain serving scaling.

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
terms checkbox before search. When store listings are published, include:
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
