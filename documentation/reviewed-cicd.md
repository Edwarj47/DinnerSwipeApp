# Reviewed CI/CD

## Implemented Versus Active

The repository now supplies strengthened CI, a manual reviewed API/web release
workflow, isolated staging templates and a restricted host executor. **Deployment
is not activated**: no GitHub environments/secrets, registry access, host sudo/SSH
rules, production Compose replacement, staging origin or DNS were configured.
Source tests are not a claim that GitHub has run this unpushed commit or that the
host executor has deployed a real environment.

Ordinary pushes run validation, not production deployment. A reviewed staging
candidate is built once, smoke-tested and recorded with immutable GHCR image
digests, source SHA, schema revision and successful exact-commit main CI run.
Production promotes that same manifest without rebuilding. A separately approved
host manifest and short-lived, exact-scope operator approval are also required.

## CI Gates

- Backend Ruff, mypy and the API suite; frontend lint/types, icon/release/native
  runtime contracts, cold-cache unit tests and web export; Docker build validation.
- Real PostgreSQL migrations, preservation of existing paid records, repeat
  upgrades and disposable rollback; concurrent/permission tests must execute,
  not skip. The real staging initializer proves runtime DML and denied DDL.
  Legacy offline rollback checks use their own fresh database, separate from
  current-schema group/nutrition tests, so file order cannot downgrade shared
  fixtures or cross the intentional production data-preservation guards.
- Browser smoke against the built nginx image at desktop and small-phone sizes,
  synthetic accounts only, with nonlocal traffic blocked. Settings, real brand
  pixels, tutorial controls and welcome verification copy are checked.
- Independent release-contract tests. Official actions are commit-pinned;
  Dependabot opens dependency/action update PRs rather than silently upgrading.

The Android Preview workflow is main-only, rechecks exact-commit CI, waits for EAS
completion, verifies the returned source/version/build number and APK archive and
approved signing certificate. A queued build no longer counts as a completed one.
It remains an explicitly dispatched, quota-consuming build, not an automatic
build on every push or an App Store submission. Device acceptance is still needed.

## Staging Isolation

`infrastructure/compose/staging.yml` uses a separate Compose project, internal
network, PostgreSQL database, migration owner, restricted runtime role, media
volume, secrets and loopback web port. It has no production download/backup mounts.
Use `infrastructure/env/staging.env.example` as an unconfigured template only.
Never copy production data or credentials into it. Provider billing, SMTP, AI,
FatSecret refresh and cleanup side effects stay off by default. UI/provider UAT
later requires separately authorized sandbox credentials and egress review.

Exported web API requests use their own browser origin (local development retains
its explicit API override). Nginx proxies to the staging API
and uses runtime Docker DNS so an API replacement does not retain a stale IP.
`APP_ENV=production` is intentional: staging retains secure cookie/secret checks;
`DEPLOYMENT_TIER=staging` identifies the isolated deployment.

The installed native preview still uses production. A native staging client needs
a distinct app identity, native/runtime configuration and build, plus auth/storage
isolation checks. Do not repoint production APKs with an OTA environment change.

## Activation Checklist

These are operator prerequisites, not changes already made by this task:

1. Obtain owner approval for a separate HTTPS staging origin, its reverse-proxy
   route, resource budget and unique secrets. Review free disk/memory and port
   collisions first. Configure protected GitHub `staging`, `production` and
   `preview` environments with approvals and main-only release access.
2. Provision only the isolated staging stack. Initialize its dedicated database,
   apply migrations as the owner, initialize media ownership for UID/GID 10001,
   and verify health, runtime privileges, isolation, backup and a restore drill.
   The automated host executor deliberately refuses first-time bootstrap.
3. Install reviewed `release-contract.cjs`, `release-executor.cjs`, `release-ssh.cjs`
   and `release-job.cjs` root-owned outside any deploy-user-writable checkout,
   e.g. `/opt/dinner-swipe-release`. Use Node 22+, Docker Compose and tmux. Preserve
   staging Compose's `../docker` layout when installing its reviewed mounts.
4. Use separate tier-bound forced SSH keys. The deploy account must not have a
   general shell, Docker group membership, unrestricted sudo, forwarding or PTY.
   Its forced command calls only the root-owned Node entry point with a fixed
   `staging` or `production` argument. If sudo is used, preserve only the required
   `SSH_ORIGINAL_COMMAND` for that exact command; it is parsed by a strict grammar.
   Review and validate sudoers/sshd configuration before activation. The wrappers
   are source only, not an installed privilege boundary.
5. Create root-private `/etc/dinner-swipe/{tier}.json` and approved manifest/approval
   directories, mode 0700 with files 0600. The config keys are `enabled`, `project`,
   `composeFile`, `environmentFile`, `environmentFiles` (all env files to back up),
   `databaseService`, `databaseOwner`, `databaseName`, and `apiService`. Staging
   uses `dinner-swipe-staging`, `postgres`, `dinner_swipe_staging_owner`,
   `dinner_swipe_staging`, `api`. Production uses its existing Dinner Swipe names;
   never substitute shared n8n storage.
6. Supply an independently reviewed **image-only** production Compose file with
   all existing mounts/networks/limits preserved, services matching the selected
   scope, and a `bootstrap`-profile `migrate` service using the approved API digest.
   This is not the current build-context Compose file. Configurations resolving to
   build contexts, mutable service images, wrong database boundaries, ports or
   staging volumes fail closed. Do not run `compose down`, prune or remove orphans.
7. Configure private registry pull access on the host. Publish/download the workflow
   manifest through the reviewed operator path, validate its exact CI and digests,
   and install `/etc/dinner-swipe/manifests/<sha>.json`. Approve only that SHA,
   manifest digest, tier and scope in `approvals/<tier>/<sha>.json` with
   `approved: true`, an ISO `expiresAt` within 24 hours, explicit boolean `migrations`,
   and optional boolean `rollbackCompatible`. Never use string booleans or broad
   automatic approval. Production additionally needs the executor's exact staged
   manifest proof, no older than seven days.
8. In each GitHub release environment set `DINNER_RELEASE_ENABLED=reviewed-v1`,
   `DINNER_DEPLOY_HOST`, `DINNER_DEPLOY_USER`; add tier-specific `DINNER_DEPLOY_KEY`
   and pinned `DINNER_DEPLOY_KNOWN_HOSTS` secrets. Preview separately needs the
   approved `EXPO_TOKEN`. Never disable SSH host-key checks or put application
   credentials in workflow YAML. Keep registry visibility/private access reviewed.
9. Dispatch staging `api-web` first. Test real candidate UAT plus backup/restore,
   failed readiness and rollback on that environment. Then separately approve
   production promotion of that exact manifest. Do not enable production from
   contract tests alone. Protect CI/release/control-plane changes with review.

## Host Behavior And Recovery

The executor acquires `dinner-swipe` then `vps-production` claims atomically and
never takes over existing/partial claims. It uses a clean Docker environment bound
to this VPS's Unix Docker socket,
validates resolved Compose/database boundaries, snapshots only the intended
database/media/env, lists archives and checksums them, and retains old image IDs
plus a recovery journal **before** migrations or service replacement.

Only explicitly scoped services are recreated with no dependencies/builds/pulls;
images must match approved digests and source labels. Checks cover the running
image IDs, API database/schema readiness, web HTML/referenced JavaScript when
web changes, and unchanged unrelated container identities. Production is not
verified from the old API's health alone. No database restore/downgrade is automatic.

The SSH entry point launches a root-private `dinner-release-<id>` tmux job. Logs
and an atomically written result are under `/var/lib/dinner-swipe/jobs/<id>`; SSH
disconnect does not kill the operation. A timeout is **unknown**, not success or
permission to dispatch a duplicate. Inspect the private job, claims and release
journal first. Backups/recovery are under `/var/lib/dinner-swipe/releases` and
successful combined staging proofs under `verified-staging`. No automatic deletion
schedule is installed. Keep logs/backups private; do not upload app data as CI artifacts.

On failure, compatible image rollback is bounded and scoped. If migrations are
not explicitly marked backward-compatible, stop for operator recovery with the
retained journal. Never restore a pre-release dump over subsequent user writes or
erase a shared VPS database. The additive welcome migration can normally remain
while old app images are restored. Record real deployment/UAT evidence before
calling this pipeline active.
