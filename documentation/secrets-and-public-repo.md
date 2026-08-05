# Secrets and Public Repository Setup

Do not commit runtime secrets. The production values live only in the ignored local `.env` on the VPS.

## Runtime Secrets

Set these in the VPS `.env` or a deployment secret store:

- `JWT_SECRET`: generated production signing secret.
- `DINNER_SWIPE_POSTGRES_PASSWORD`: generated password for the isolated `dinner_swipe_app` Postgres role.
- `DATABASE_URL`: includes the Dinner Swipe database password and must stay secret.
- `OPENAI_API_KEY`: app-scoped OpenAI key for recipe URL normalization.
- `EMAIL_SMTP_HOST`, `EMAIL_SMTP_USERNAME`, `EMAIL_SMTP_PASSWORD`: SMTP credentials for verification and password reset email.

## Public Configuration

These are safe to keep in `.env.example` or app config:

- `APP_PUBLIC_URL=https://dinner.dcss.dev`
- `PUBLIC_API_URL=https://dinner.dcss.dev`
- `ALLOWED_ORIGINS=https://dinner.dcss.dev`
- `OPENAI_MODEL=gpt-5-mini`
- `EMAIL_FROM=dinnerswipe@dcss.dev`
- `EMAIL_FROM_NAME=Dinner Swipe`
- feature flags and upload limits

## GitHub Repository

Remote:

```bash
git@github.com:Edwarj47/DinnerSwipeApp.git
```

The repository can be public as long as `.env`, backups, logs, local databases, media uploads, and build outputs remain ignored.

## GitHub Actions Secrets

The current CI workflow does not need production secrets. Add deployment secrets only when automated deployment is implemented.

Likely future deployment secrets:

- `DINNER_SWIPE_DEPLOY_HOST`
- `DINNER_SWIPE_DEPLOY_USER`
- `DINNER_SWIPE_DEPLOY_SSH_KEY`
- `DINNER_SWIPE_DEPLOY_PATH`

Do not add `OPENAI_API_KEY`, `JWT_SECRET`, or `DATABASE_URL` to GitHub unless a workflow explicitly needs them.
