# Security and calculator release 26

This release includes the pending security remediation, Premium macro settings,
account-level food database consent, clearable search fields, calculator draft
totals and serving controls, and saving a logged meal as a separate recipe.
Food database recipes retain references and portions, not provider macros.

## Deployment requirements

- Back up the Dinner Swipe database, media volume, environment and current
  application images before the additive migration `e43b2d801a9c`.
- Provision `dinner_swipe_runtime` with the existing owner connection. Runtime
  API/worker connections must not own the database or hold DDL privileges.
- Store the runtime connection in the ignored mode-0600 `.env`; keep the owner
  connection only in the ignored mode-0600 `.env.migrations`.
- Set trusted proxy addresses to the inspected Dinner Swipe bridge gateway.
  Never use a wildcard proxy allowlist.
- Allow UID/GID 10001 to write the Dinner Swipe media directories. Back up the
  volume and ownership inventory first; do not change other application volumes.
- Keep media cleanup disabled until a separate legacy-media inventory/backfill.
- Replace only Dinner Swipe API, worker and web. Do not restart PostgreSQL,
  n8n, other applications or the reverse proxy. The API enforces body limits;
  the example reverse-proxy update is not required for this rollout.

## Verification and rollback

Check backend/mobile tests, static checks, GitHub CI, production health, cookie
security, anonymous access rejection, runtime database privileges, signed photo
access and unchanged weekly selections. Use synthetic accounts for interactive
browser tests rather than modifying customer records. Verify APK code 26,
source commit, ZIP integrity and the existing Android signing certificate.
Physical-device UAT remains separate.

Rollback restores the saved environment, previous Compose configuration and
previous API/worker/web images. Retain the additive security schema and runtime
role; do not run a destructive downgrade or restore a stale database over new
user activity. Private release evidence is retained in `backups/releases/`.
This release does not assert that every dependency advisory has been eliminated.
