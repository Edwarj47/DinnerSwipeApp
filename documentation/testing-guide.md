# Testing Guide

Backend:

```bash
cd apps/api
../../.venv/bin/ruff check app
../../.venv/bin/pytest
```

Frontend:

```bash
npm run lint -w apps/mobile
npm run typecheck -w apps/mobile
npm test -w apps/mobile -- --runInBand
```

Coverage currently focuses on parsing, CSV import, SSRF blocklist behavior, auth/recipe creation, grocery aggregation, and local swipe undo state.

