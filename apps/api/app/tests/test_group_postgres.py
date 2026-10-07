"""Opt-in group concurrency and FK checks on the same disposable test database."""

import os
from collections.abc import Generator
from concurrent.futures import ThreadPoolExecutor
from uuid import uuid4

import pytest
from alembic.config import Config
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, select
from sqlalchemy.engine import make_url
from sqlalchemy.orm import Session

from alembic import command
from app.core.config import settings
from app.core.security import create_access_token
from app.database.session import get_db
from app.main import app
from app.models.entities import (
    Household,
    HouseholdMember,
    MealMacroConfirmation,
    MealProposal,
    MealProposalMember,
    User,
    UserProfile,
    UserSubscription,
    WeeklyPlanSlot,
)


@pytest.mark.skipif(
    not os.environ.get("OFFLINE_TEST_DATABASE_URL"), reason="Disposable PostgreSQL only"
)
def test_postgres_group_proposals_approval_and_shared_grocery_retries(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    url = os.environ["OFFLINE_TEST_DATABASE_URL"]
    parsed = make_url(url)
    assert parsed.host == "127.0.0.1" and parsed.port == 15413 and parsed.database == "offline_test"
    monkeypatch.setattr(settings, "database_url", url)
    command.upgrade(Config("alembic.ini"), "head")
    engine = create_engine(url)
    with Session(engine) as db:
        group = Household(name="Concurrency kitchen")
        db.add(group)
        db.flush()
        group_id = group.id
        user_ids = []
        for role in ("owner", "member", "member"):
            user = User(
                email=f"{uuid4()}@example.com", password_hash=str(uuid4()), email_verified=True
            )
            db.add(user)
            db.flush()
            user_ids.append(user.id)
            db.add_all(
                [
                    UserProfile(user_id=user.id, household_id=group_id),
                    HouseholdMember(user_id=user.id, household_id=group_id, role=role),
                    UserSubscription(
                        user_id=user.id,
                        plan_key="macro_tracker_monthly",
                        status="active",
                        source="waiver_code",
                    ),
                ]
            )
        db.commit()
    headers = [{"Authorization": f"Bearer {create_access_token(user_id)}"} for user_id in user_ids]
    base = f"/api/v1/households/{group_id}"

    def isolated_session() -> Generator[Session, None, None]:
        with Session(engine) as db:
            yield db

    app.dependency_overrides[get_db] = isolated_session
    client = TestClient(app)
    try:
        recipe = client.post(
            "/api/v1/recipes",
            headers=headers[0],
            json={
                "name": f"Lentils {uuid4()}",
                "servings": 1,
                "accept_placeholder_photo": True,
                "ingredients": [
                    {
                        "normalized_name": "red onion",
                        "original_text": "1 red onion",
                        "quantity": 1,
                        "unit": "each",
                    }
                ],
                "instructions": [],
                "nutrition": {"calories": 150, "protein_g": 10},
            },
        ).json()
        assert (
            client.patch(
                f"{base}/discover-choices", headers=headers[0], json={"enable_ids": [recipe["id"]]}
            ).status_code
            == 200
        )
        payload = {
            "household_id": group_id,
            "recipe_id": recipe["id"],
            "action": "add",
            "session_id": "concurrent",
            "request_id": "member-choice",
        }

        def swipe(index: int) -> int:
            return int(
                TestClient(app)
                .post("/api/v1/recipes/swipes", headers=headers[1 + index % 2], json=payload)
                .status_code
            )

        with ThreadPoolExecutor(max_workers=6) as workers:
            assert list(workers.map(swipe, range(6))) == [200] * 6
        with Session(engine) as db:
            proposals = db.scalars(
                select(MealProposal).where(MealProposal.household_id == group_id)
            ).all()
            assert len(proposals) == 1
            proposal_id = proposals[0].id
            assert (
                len(
                    db.scalars(
                        select(MealProposalMember).where(
                            MealProposalMember.proposal_id == proposal_id
                        )
                    ).all()
                )
                == 2
            )

        def approve(_: int) -> int:
            return int(
                TestClient(app)
                .post(
                    f"{base}/proposals/{proposal_id}/decision",
                    headers=headers[0],
                    json={"action": "approve", "servings": 4},
                )
                .status_code
            )

        with ThreadPoolExecutor(max_workers=3) as workers:
            assert sorted(workers.map(approve, range(3))) == [200, 409, 409]
        plan = client.get(f"{base}/weekly-plans/current", headers=headers[1]).json()
        assert len(plan["slots"]) == 1 and plan["slots"][0]["servings"] == 4
        slot_id = plan["slots"][0]["id"]
        logged = client.post(
            "/api/v1/macros/confirmations",
            headers=headers[1],
            json={
                "weekly_plan_slot_id": slot_id,
                "recipe_id": recipe["id"],
                "status": "ate",
                "servings_consumed": 1,
            },
        )
        assert logged.status_code == 200 and logged.json()["calories"] == 150
        item = client.get(f"{base}/grocery-lists/current", headers=headers[1]).json()["items"][0]
        edit = {
            "operation_id": str(uuid4()),
            "kind": "grocery_update",
            "household_id": group_id,
            "target_id": item["id"],
            "revision": item["revision"],
            "values": {"is_checked": True},
        }

        def sync(_: int) -> dict[str, object]:
            result = TestClient(app).post("/api/v1/offline/sync", headers=headers[1], json=edit)
            assert result.status_code == 200, result.text
            return result.json()  # type: ignore[no-any-return]

        with ThreadPoolExecutor(max_workers=4) as workers:
            results = list(workers.map(sync, range(4)))
        assert all(result == results[0] for result in results)
        assert (
            client.post(
                f"{base}/weekly-plans/current/reset", headers=headers[0], json={}
            ).status_code
            == 200
        )
        with Session(engine) as db:
            assert db.get(WeeklyPlanSlot, slot_id) is None
            entry = db.get(MealMacroConfirmation, logged.json()["id"])
            assert entry and entry.weekly_plan_slot_id is None and entry.calories == 150
    finally:
        app.dependency_overrides.pop(get_db, None)
        engine.dispose()
