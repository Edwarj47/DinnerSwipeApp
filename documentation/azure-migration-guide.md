# Azure Migration Guide

This guide describes how to package Dinner Swipe for Azure when the app outgrows the VPS.

Current source-of-truth packaging:

- API image: `infrastructure/docker/api.Dockerfile`
- Worker image: `infrastructure/docker/api.Dockerfile` with command `python -m app.workers.runner`
- Web image: `infrastructure/docker/web.Dockerfile`
- Web static export command: `npm run build:web -w apps/mobile`
- Database migrations: `cd apps/api && alembic upgrade head`

## Recommended Azure Shape

For the first Azure move, avoid Kubernetes. Use managed services:

- Azure Container Registry for API and worker images.
- Azure Container Apps for the FastAPI API.
- Azure Container Apps for the continuous background worker.
- Azure Static Web Apps for the Expo web export, or keep the current nginx web container in Container Apps for the first lift.
- Azure Database for PostgreSQL flexible server for Postgres.
- Azure Blob Storage for recipe photos and future media.
- Azure Key Vault or Container Apps secrets for environment variables.

Microsoft docs used for this recommendation:

- Azure Container Apps runs containerized apps without managing orchestration, supports APIs, background jobs, HTTPS ingress, secrets, logs, revisions, and autoscale: <https://learn.microsoft.com/en-us/azure/container-apps/overview>
- Azure Static Web Apps deploys static web apps from GitHub/Azure DevOps and serves static assets globally: <https://learn.microsoft.com/en-us/azure/static-web-apps/overview>
- Azure Container Registry stores and manages Docker-compatible images and integrates with CI/CD: <https://learn.microsoft.com/en-us/azure/container-registry/container-registry-intro>
- Azure Database for PostgreSQL flexible server is managed PostgreSQL with backups, scaling, TLS, monitoring, and migration paths: <https://learn.microsoft.com/en-us/azure/postgresql/overview>
- Azure Blob Storage is object storage suited for images, documents, backups, and distributed file access: <https://learn.microsoft.com/en-us/azure/storage/blobs/storage-blobs-overview>

## Phase 1: Low-Risk Lift

This keeps the app closest to the VPS deployment.

1. Create an Azure resource group.
2. Create Azure Container Registry.
3. Build and push:

```bash
docker build -f infrastructure/docker/api.Dockerfile -t <acr>.azurecr.io/dinner-swipe-api:<sha> .
docker build -f infrastructure/docker/web.Dockerfile -t <acr>.azurecr.io/dinner-swipe-web:<sha> .
docker push <acr>.azurecr.io/dinner-swipe-api:<sha>
docker push <acr>.azurecr.io/dinner-swipe-web:<sha>
```

4. Create Azure Database for PostgreSQL flexible server.
5. Restore VPS data with `pg_dump` and `pg_restore`, or use Azure Database Migration Service if lower downtime is needed.
6. Create a Blob Storage account/container for recipe media.
7. Configure API Container App environment variables.
8. Run Alembic migrations against Azure Postgres.
9. Deploy API Container App with HTTPS ingress.
10. Deploy worker Container App without public ingress.
11. Deploy web container or Static Web App pointed at the API URL.
12. Move DNS after smoke tests pass.

## Phase 2: Cleaner Production Split

After the first successful Azure run:

- Serve Expo web from Azure Static Web Apps.
- Keep FastAPI in Azure Container Apps.
- Keep the worker as a separate Container App.
- Store media in Azure Blob Storage.
- Use Azure Database for PostgreSQL flexible server with backups and alerts.
- Add Redis-compatible shared storage or Azure-managed edge rules for rate limits before API replicas.

## Required Environment Variables

Minimum API variables on Azure:

```bash
APP_ENV=production
APP_PUBLIC_URL=https://dinner.dcss.dev
PUBLIC_API_URL=https://api-or-app-url
DATABASE_URL=postgresql+psycopg://...
JWT_SECRET=<secret>
OPENAI_API_KEY=<secret>
AI_INGESTION_ENABLED=true
EMAIL_SMTP_HOST=smtp.gmail.com
EMAIL_SMTP_PORT=587
EMAIL_SMTP_USERNAME=DSAsupport@dcss.dev
EMAIL_SMTP_USE_TLS=true
MEDIA_STORAGE_BACKEND=azure_blob
MEDIA_PUBLIC_BASE_URL=https://<storage-account>.blob.core.windows.net/<container>
AZURE_STORAGE_CONTAINER=<container>
ALLOWED_ORIGINS=https://dinner.dcss.dev
```

Set these separately as Azure/GitHub secrets, never in repo files:

- `EMAIL_SMTP_PASSWORD`
- `AZURE_STORAGE_CONNECTION_STRING`

Minimum Expo web build variable:

```bash
EXPO_PUBLIC_API_URL=https://api-or-app-url
```

## Cutover Checklist

- Confirm Azure API `/api/v1/health`.
- Run Alembic migrations.
- Run seed only if this is a fresh environment.
- Register a test user.
- Upload a test photo.
- Import one URL-ingested recipe.
- Generate a grocery list.
- Confirm media URLs load from Blob Storage.
- Confirm SMTP sends verification email.
- Confirm OpenAI ingestion works only when enabled.
- Lower VPS DNS TTL before cutover.
- Move DNS.
- Keep the VPS stack intact until Azure has run cleanly for several days.

## Rollback

Do not destroy the VPS deployment during migration.

Rollback is DNS-based:

1. Point `dinner.dcss.dev` back to the VPS.
2. Stop writes to Azure if data divergence matters.
3. Export any Azure-only data before attempting a second cutover.

## Notes

- Azure Container Apps jobs are useful later for finite tasks. The current worker is a continuous polling process, so it should initially run as a normal Container App.
- Use `pg_dump`/`pg_restore` for a small planned downtime migration. Use Azure Database Migration Service when downtime must be minimized.
- Do not put secrets in GitHub Actions files. Use Azure/GitHub secrets.
