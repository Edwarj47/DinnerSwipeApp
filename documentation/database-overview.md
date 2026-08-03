# Database Overview

The initial migration creates normalized tables for users, households, recipes, recipe ingredients, ordered instruction steps, tags, photos, sources, versions, weekly plans, swipes, favorites, hidden recipes, pantry items, grocery lists, retailer preferences, import batches/files/templates/rows/errors, ingestion jobs, URL candidates, validation results, and audit events.

IDs are UUID strings for portability across PostgreSQL and test SQLite. Ownership fields appear on user-specific tables, and recipes can be global seed data or user-owned.

Run migrations with:

```bash
cd apps/api
../../.venv/bin/alembic upgrade head
```

