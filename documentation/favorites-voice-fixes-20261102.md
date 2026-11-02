# Favorites, Search Hints and Native Meal Voice

## Behavior

Recipe Library now includes a collapsible Favorites section. It uses server-side favorites filtering before pagination/search, not filtering of the first downloaded library page. Existing recipe details/editing and library actions remain available; the heart-removal control removes only the current user's favorite association. Hidden favorites remain manageable there; archived favorites stay archived until restored. Removal does not change a recipe, hidden state, weekly plan, macro history or recorded swipe history. Favorites retain Basic subscription/authentication checks and accessible-recipe restrictions. No schema change is needed.

Shared search fields have a search icon and an explicit theme-colored placeholder, including a generic fallback when no label was supplied. Custom labels/colors, clear controls, disabled state and stable layout remain supported.

Native recording lets the OS permission request finish and waits for the app to become active before preparing the microphone. Android can pause its host Activity for that permission dialog, which must not cancel a take before it starts. Genuine backgrounding during preparation or recording still stops/discards audio. The assistant no longer duplicates the native hook's background cleanup.

Each take uses a fresh Expo recorder through the supported fileName option and a UUID cache basename. This binds native callbacks to one session, including Android hardware failures that omit ID/URL. Late callbacks from a released recorder cannot discard a replacement take. Audio remains private-cache mono AAC, bounded to 59 seconds/6 MB; cancellation, unmount and backgrounding retain existing cleanup and stale-upload protection. The OS recording permission remains mandatory; manual typing remains available.

## Verification and Release

Regression coverage includes per-user favorites privacy/search/pagination/removal, archived/hidden separation, failed/offline removal, placeholder propagation, deferred Android permission transitions, foreground-only recording, missing-metadata native errors, late previous-session errors, and installed Expo hook/assistant integration with mocked hardware. Browser fixtures exercise Favorites/details/removal/search at desktop and narrow phone sizes without production-account writes.

These are JavaScript/backend changes compatible with native runtime 0.2.0 / APK 28. Keep the existing native contract unchanged. Deploy the API before web and the preview EAS Update; the new client needs the favorites collection/removal routes. Do not claim actual microphone/device verification from mocks. The user should verify native recording/transcription after receiving the update.

Private backup/evidence: backups/favorites-voice-release-20261102 and /tmp/dinner-favorites-voice-20261102. Preserve rollback API/web images and the preceding preview update group. A web/API rollback does not revert an already installed OTA: use EAS republish/rollback separately if needed, respecting the unchanged runtime. No database restore is required for this release.
