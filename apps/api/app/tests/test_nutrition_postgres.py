from __future__ import annotations

import os
from concurrent.futures import ThreadPoolExecutor

import pytest
from alembic.config import Config
from sqlalchemy import create_engine, delete, func, select
from sqlalchemy.engine import make_url
from sqlalchemy.orm import Session, sessionmaker

from alembic import command
from app.core.config import Settings, settings
from app.models.nutrition import NutritionCall, NutritionProviderState
from app.services.nutrition_budget import NutritionBudget, NutritionError


@pytest.mark.skipif(
    not os.environ.get("OFFLINE_TEST_DATABASE_URL"), reason="Disposable PostgreSQL only"
)
def test_nutrition_concurrent_global_quota(monkeypatch: pytest.MonkeyPatch) -> None:
    url = os.environ["OFFLINE_TEST_DATABASE_URL"]
    parsed = make_url(url)
    assert parsed.host == "127.0.0.1" and parsed.port == 15413 and parsed.database == "offline_test"
    monkeypatch.setattr(settings, "database_url", url)
    command.upgrade(Config("alembic.ini"), "head")
    engine = create_engine(url)
    sessions = sessionmaker(bind=engine)
    with sessions() as db:
        db.execute(delete(NutritionCall))
        state = db.get(NutritionProviderState, "fatsecret")
        assert state
        state.next_request_at = None
        state.blocked_until = None
        db.commit()
    config = Settings(fatsecret_daily_budget=7, fatsecret_background_budget=3)
    config.fatsecret_min_interval_seconds = 0
    budget = NutritionBudget(sessions, config)

    def reserve(_: int) -> str:
        try:
            budget.reserve("foods.search")
            return "reserved"
        except NutritionError as error:
            return error.code

    try:
        with ThreadPoolExecutor(max_workers=12) as pool:
            results = list(pool.map(reserve, range(30)))
        assert results.count("reserved") == 7
        assert results.count("daily_budget_exhausted") == 23
        with Session(engine) as db:
            assert db.scalar(select(func.count()).select_from(NutritionCall)) == 7
    finally:
        engine.dispose()
