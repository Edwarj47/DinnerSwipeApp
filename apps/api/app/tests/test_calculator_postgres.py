from __future__ import annotations

import os
from concurrent.futures import ThreadPoolExecutor
from datetime import date, datetime
from uuid import uuid4

import pytest
from alembic.config import Config
from sqlalchemy import MetaData, Table, create_engine, func, inspect, select
from sqlalchemy.engine import make_url
from sqlalchemy.orm import Session

from alembic import command
from app.core.config import settings
from app.models.entities import MealMacroConfirmation, User, UserSubscription
from app.models.nutrition import NutritionCalculation
from app.schemas.calculator import CalculatorSave
from app.services.billing import PREMIUM_PLAN_KEY
from app.services.calculator import save_calculation


@pytest.mark.skipif(
    not os.environ.get("CALCULATOR_TEST_DATABASE_URL"), reason="Disposable PostgreSQL only"
)
def test_calculator_additive_migration_and_concurrent_save(monkeypatch: pytest.MonkeyPatch) -> None:
    url = os.environ["CALCULATOR_TEST_DATABASE_URL"]
    parsed = make_url(url)
    assert (
        parsed.host == "127.0.0.1" and parsed.port == 15414 and parsed.database == "calculator_test"
    )
    monkeypatch.setattr(settings, "database_url", url)
    config = Config("alembic.ini")
    command.upgrade(config, "b981fc2a7610")
    engine = create_engine(url)
    legacy_users = Table("users", MetaData(), autoload_with=engine)
    with Session(engine) as db:
        user_id = str(uuid4())
        email, password_hash = f"{uuid4()}@example.com", str(uuid4())
        db.execute(
            legacy_users.insert().values(
                id=user_id,
                email=email,
                password_hash=password_hash,
                email_verified=True,
                is_active=True,
                created_at=datetime.utcnow(),
                updated_at=datetime.utcnow(),
            )
        )
        db.add(
            UserSubscription(
                user_id=user_id, plan_key=PREMIUM_PLAN_KEY, status="active", source="waiver_code"
            )
        )
        db.commit()
        before = (user_id, email, password_hash)
    command.upgrade(config, "head")
    assert inspect(engine).has_table("nutrition_calculations")
    payload = CalculatorSave.model_validate(
        {
            "name": "Concurrent breakfast",
            "meal_date": str(date.today()),
            "destination": "entry",
            "request_id": str(uuid4()),
            "items": [
                {
                    "source": "manual",
                    "name": "My eggs",
                    "portions": 2,
                    "nutrition": {"calories": 74, "protein_g": 6.29},
                }
            ],
        }
    )

    def save(_: int) -> str:
        with Session(engine) as db:
            user = db.get(User, user_id)
            assert user
            return save_calculation(db, user, payload).id

    try:
        with ThreadPoolExecutor(max_workers=5) as workers:
            ids = list(workers.map(save, range(5)))
        assert len(set(ids)) == 1
        with Session(engine) as db:
            preserved_user = db.get(User, user_id)
            assert (
                preserved_user
                and (
                    preserved_user.id,
                    preserved_user.email,
                    preserved_user.password_hash,
                )
                == before
            )
            assert db.scalar(select(func.count()).select_from(NutritionCalculation)) == 1
            assert db.scalar(select(func.count()).select_from(MealMacroConfirmation)) == 1
            entry = db.scalar(select(MealMacroConfirmation))
            assert entry and entry.calories == 148
    finally:
        engine.dispose()
