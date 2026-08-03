.PHONY: api-install api-test api-run mobile-install mobile-web test docker-up docker-down migrate seed

api-install:
	cd apps/api && python3 -m venv .venv && . .venv/bin/activate && pip install -U pip && pip install -e ".[dev]"

api-test:
	cd apps/api && . .venv/bin/activate && pytest

api-run:
	cd apps/api && . .venv/bin/activate && uvicorn app.main:app --host 127.0.0.1 --port 8108 --reload

mobile-install:
	npm install

mobile-web:
	npm run web -w apps/mobile

test:
	cd apps/api && . .venv/bin/activate && pytest
	npm test -w apps/mobile -- --runInBand

migrate:
	cd apps/api && . .venv/bin/activate && alembic upgrade head

seed:
	cd apps/api && . .venv/bin/activate && python -m app.workers.seed

docker-up:
	docker compose --profile production up --build

docker-down:
	docker compose --profile production down

