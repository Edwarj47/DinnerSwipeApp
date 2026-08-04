# Scaling Plan

Assessed on 2026-08-04.

Current VPS snapshot:

- 2 vCPUs
- 7.8 GiB RAM
- 42 GiB free disk on a 96 GiB root volume
- Dinner Swipe containers at low load:
  - API: about 110 MiB memory
  - PostgreSQL: about 28 MiB memory
  - web: about 3 MiB memory
  - worker: about 9 MiB memory

## MVP and Private Beta

The current VPS is suitable for MVP development, personal use, and a small private beta. The static web app is cheap to serve, the API footprint is small, and the database is isolated from existing n8n/PostgreSQL systems.

Recommended constraints for this phase:

- Keep media uploads capped.
- Keep URL ingestion response-size limits strict.
- Use local Postgres backups.
- Avoid running multiple API replicas until refresh-token revocation and rate limiting are moved to shared storage.
- Watch disk growth from uploaded recipe photos and Docker images.

## First Public Launch

Before wider public traffic:

- Move recipe image/media storage to S3-compatible object storage.
- Add automated Postgres backups with restore drills.
- Add Redis or a managed edge/WAF layer for shared rate limits.
- Add server-side refresh-token rotation and revocation.
- Add structured application metrics and alerts.
- Put static web assets behind a CDN or object-storage static host.
- Keep the API on the VPS or move it to a small managed container host.

## Growth Path

If usage grows:

- Split the database to managed PostgreSQL or a larger dedicated database VPS.
- Run API and worker as separate horizontally scalable services.
- Use a queue backend for ingestion and image jobs.
- Serve uploaded media from object storage/CDN.
- Keep native app builds with Expo EAS.
- Add staging and production environments with separate databases and secrets.

## When This VPS Becomes Too Small

The likely first bottlenecks are CPU during URL ingestion/AI normalization, disk from media and backups, and database I/O if groups and grocery regeneration become busy. Static web serving is unlikely to be the bottleneck.

Practical upgrade order:

1. Add object storage for media.
2. Add backups and monitoring.
3. Move rate limits/sessions/job queue to Redis.
4. Upgrade VPS CPU/RAM or move the database out.
5. Add separate API/worker replicas.
