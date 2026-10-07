"""Opt-in test against a disposable local PostgreSQL database, never production."""

import os
from collections.abc import Generator
from concurrent.futures import ThreadPoolExecutor
from uuid import uuid4

import pytest
from alembic.config import Config
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, event, inspect
from sqlalchemy.engine import make_url
from sqlalchemy.orm import Session

from alembic import command
from app.core.config import settings
from app.core.security import create_access_token
from app.database.session import get_db
from app.main import app
from app.models.entities import MealMacroConfirmation, OfflineReceipt, User, UserSubscription


@pytest.mark.skipif(
    not os.environ.get("OFFLINE_TEST_DATABASE_URL"), reason="Disposable PostgreSQL only"
)
def test_postgres_migration_concurrent_retry_and_atomic_rollback(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    url = os.environ["OFFLINE_TEST_DATABASE_URL"]
    parsed = make_url(url)
    assert parsed.host == "127.0.0.1" and parsed.port == 15413 and parsed.database == "offline_test"
    monkeypatch.setattr(settings, "database_url", url)
    config = Config("alembic.ini")
    command.upgrade(config, "d8126c4ab391")
    engine = create_engine(url)
    with Session(engine) as db:
        user = User(email=f"{uuid4()}@example.com", password_hash=str(uuid4()), email_verified=True)
        db.add(user)
        db.flush()
        user_id = user.id
        db.add(
            UserSubscription(
                user_id=user.id,
                plan_key="macro_tracker_monthly",
                status="active",
                source="waiver_code",
            )
        )
        db.commit()
    # Exercise the legacy downgrade before installing the non-destructive group revision.
    command.upgrade(config, "f20b84e901ac")

    def isolated_session() -> Generator[Session, None, None]:
        with Session(engine) as db:
            yield db

    app.dependency_overrides[get_db] = isolated_session
    token = create_access_token(user_id)
    headers = {"Authorization": f"Bearer {token}"}
    edit = {
        "operation_id": str(uuid4()),
        "kind": "macro_create",
        "values": {
            "entry_name": "Concurrent shake",
            "meal_date": "2026-10-03",
            "calories": 160,
            "protein_g": 30,
            "carbs_g": 4,
            "fat_g": 3,
            "fiber_g": 2,
        },
    }

    def send() -> dict[str, object]:
        response = TestClient(app).post("/api/v1/offline/sync", json=edit, headers=headers)
        assert response.status_code == 200, response.text
        return response.json()  # type: ignore[no-any-return]

    def fail_receipt(*args: object) -> None:
        raise RuntimeError("Simulated receipt storage failure")

    try:
        with ThreadPoolExecutor(max_workers=5) as workers:
            results = list(workers.map(lambda _: send(), range(5)))
        assert all(result == results[0] for result in results)
        with Session(engine) as db:
            assert db.query(MealMacroConfirmation).filter_by(user_id=user_id).count() == 1
            assert db.query(OfflineReceipt).filter_by(user_id=user_id).count() == 1
        # An insert failure after the meal flush must roll back both sides.
        edit["operation_id"] = str(uuid4())
        event.listen(OfflineReceipt, "before_insert", fail_receipt)
        try:
            response = TestClient(app, raise_server_exceptions=False).post(
                "/api/v1/offline/sync", json=edit, headers=headers
            )
            assert response.status_code == 500
        finally:
            event.remove(OfflineReceipt, "before_insert", fail_receipt)
        with Session(engine) as db:
            assert db.get(MealMacroConfirmation, edit["operation_id"]) is None
            assert db.query(OfflineReceipt).filter_by(user_id=user_id).count() == 1
        command.downgrade(config, "d8126c4ab391")
        assert not inspect(engine).has_table("offline_receipts")
        with Session(engine) as db:
            assert db.get(User, user_id) is not None
            assert db.query(MealMacroConfirmation).filter_by(user_id=user_id).count() == 1
        command.upgrade(config, "head")
        assert inspect(engine).has_table("offline_receipts")
    finally:
        app.dependency_overrides.pop(get_db, None)
        engine.dispose()
