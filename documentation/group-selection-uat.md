# Group Selection And Default Group

Status: implemented and locally verified on 2026-10-07. These changes have not
been pushed, deployed, or included in a new Android APK. Release 23 is unchanged.

## Behavior

- The group picker says "Choose a group" and "Search groups".
- Discover keeps its group picker below the content, including loading, error,
  and empty states. Empty shared groups show an in-flow card instead of an
  overlapping logo/header. It identifies the owner by saved display name and
  email; accounts without a name show the email without inventing a name.
- Owners can open their Discover choices from the empty card. Members cannot
  access the owner-only action.
- Profile > Group has a Default group selector. Saving a default also activates
  that group immediately. Temporary switches on Discover, This Week, Grocery,
  or Profile share the active selection without replacing the saved default.
- Successful password login restores the explicit default. Token refresh does
  not change the active group. Unlocking an existing session retains that
  session's selection. Accounts without an explicit default retain legacy
  selection behavior. Leaving a default group, or losing membership in it,
  falls back to the private kitchen.
- Profile > Account has an optional display name. Changing it updates owner
  identity in group metadata without changing authentication or account email.

## API And Compatibility

No database migration is required. The default group and display name use the
existing profile preferences JSON, with dedicated validated endpoints:

- `POST /api/v1/households/{household_id}/default`
- `PATCH /api/v1/profile/identity`

Group responses add `is_default` and nullable `owner` metadata; profile responses
add nullable `display_name`. Owner details remain behind group membership
authorization. Ordinary profile updates preserve these managed preferences.
The client handles older cached group metadata that lacks the new fields.

## Verification

- API: Ruff and mypy passed; 178 tests passed, with two opt-in PostgreSQL tests
  skipped in the standard run. Both opt-in tests then passed separately against
  a disposable PostgreSQL container. Production databases were not used.
- Frontend: lint and TypeScript passed; 227 tests passed across 33 suites.
- Production-configured web export built successfully. Intercepted browser
  fixtures passed at 320 x 720, 390 x 844, and 1280 x 800, plus 200% text.
  Checks covered empty owner/member states, long identity text, picker/search,
  default versus active group, populated decks, error recovery, and cross-page
  selection, without customer requests or mutations.
- A separate localhost development export passed an end-to-end check against
  the actual updated API with synthetic SQLite data. It verified default
  restoration, temporary switching, identity updates, permissions, and shared
  selection across pages. No production API requests were made.
- Physical Android checks remain pending. Browser layout and mocked native
  tests do not establish phone behavior.

## Isolated Preview

Open `http://127.0.0.1:19013/preview-start.html` on this VPS to enter the synthetic
preview account. The preview API listens only on `127.0.0.1:18108`. Its database,
identity data, and session tokens are temporary test fixtures, not customer data.

The frontend container is `dinner-group-default-preview`, using
`dinner-swipe-web:group-default-dev`. The API runs in tmux session
`codex-dinner-group-default-api`. Neither is a production service. Do not deploy
the development image: it embeds a localhost API URL. A release must build a
fresh export with the normal production configuration.

Test logs and browser screenshots are under `/tmp/dinner-group-default-*`.
Live Dinner Swipe and unrelated VPS services, data, routes, and provider
settings were not changed.
