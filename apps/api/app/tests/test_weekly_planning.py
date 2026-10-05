from contextlib import AbstractContextManager
from datetime import date, datetime, timedelta
from typing import Any, cast
from unittest.mock import patch

import pytest
from fastapi.testclient import TestClient
from httpx import Response
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.models.entities import MealMacroConfirmation, User, WeeklyPlan, WeeklyPlanSlot
from app.services.planning import (
    CURSOR_KEY,
    SETTINGS_KEY,
    planning_settings,
    reconcile_current_plan,
    week_bounds,
)


def user_for(db: Session) -> User:
    return db.scalars(select(User)).one()


def freeze(iso: str) -> AbstractContextManager[Any]:
    return patch("app.services.planning.now_utc", return_value=datetime.fromisoformat(iso))


def settings(client: TestClient, headers: dict[str, str], **changes: Any) -> Response:
    values = {"mode": "manual", "reset_day": 0, "notify": True, "time_zone": "America/New_York"}
    return cast(
        Response, client.patch("/api/v1/profile/planning", headers=headers, json=values | changes)
    )


def create_meal(client: TestClient, headers: dict[str, str]) -> str:
    return str(
        client.post(
            "/api/v1/recipes",
            headers=headers,
            json={
                "name": "Carryover dinner",
                "servings": 2,
                "ingredients": [],
                "instructions": [],
            },
        ).json()["id"]
    )


def test_default_manual_and_no_utc_early_rollover(
    client: TestClient, auth_headers: dict[str, str], db_session: Session
) -> None:
    assert planning_settings(user_for(db_session))["mode"] == "manual"
    with freeze("2026-10-05T00:30:00+00:00"):
        assert settings(client, auth_headers).status_code == 200
        plan = client.get("/api/v1/weekly-plans/current", headers=auth_headers).json()
        assert plan["week_start"] == "2026-09-28"
    with freeze("2026-10-05T04:01:00+00:00"):
        assert (
            client.get("/api/v1/weekly-plans/current", headers=auth_headers).json()["week_start"]
            == "2026-10-05"
        )


def test_manual_carryover_preserves_order_portions_locks_and_history(
    client: TestClient, auth_headers: dict[str, str], db_session: Session
) -> None:
    recipe = create_meal(client, auth_headers)
    with freeze("2026-10-04T18:00:00+00:00"):
        settings(client, auth_headers)
        plan = client.post(
            "/api/v1/weekly-plans/current/slots",
            headers=auth_headers,
            json={"recipe_id": recipe, "slot_date": "2026-09-30"},
        ).json()
        slot = next(item for item in plan["slots"] if item["recipe_id"])
        client.put(
            f"/api/v1/weekly-plans/current/slots/{slot['id']}",
            headers=auth_headers,
            json={"servings": 3, "is_locked": True},
        )
        user = user_for(db_session)
        db_session.add(
            MealMacroConfirmation(
                user_id=user.id,
                weekly_plan_slot_id=slot["id"],
                recipe_id=recipe,
                meal_date=date(2026, 9, 30),
                status="ate",
                servings_consumed=3,
            )
        )
        db_session.commit()
    with freeze("2026-10-05T04:01:00+00:00"):
        current = client.get("/api/v1/weekly-plans/current", headers=auth_headers).json()
        carried = next(item for item in current["slots"] if item["recipe_id"])
        assert carried["slot_date"] == "2026-10-07"
        assert carried["servings"] == 3 and carried["is_locked"] is True
        assert carried["sort_order"] == slot["sort_order"]
        assert carried["id"] != slot["id"]
        assert db_session.scalar(select(func.count()).select_from(MealMacroConfirmation)) == 1
        assert (
            db_session.scalars(select(MealMacroConfirmation)).one().weekly_plan_slot_id
            == slot["id"]
        )
        assert (
            client.get("/api/v1/recipes?weekly_picks=true", headers=auth_headers).json()[0]["id"]
            == recipe
        )
        assert client.get("/api/v1/weekly-plans/current", headers=auth_headers).json() == current
        assert db_session.scalar(select(func.count()).select_from(WeeklyPlan)) == 2
    with freeze("2026-11-23T12:00:00+00:00"):
        future = client.get("/api/v1/weekly-plans/current", headers=auth_headers).json()
        assert (
            next(item for item in future["slots"] if item["recipe_id"])["slot_date"] == "2026-11-25"
        )
        assert db_session.scalar(select(func.count()).select_from(WeeklyPlan)) == 3


def test_automatic_reset_on_chosen_day_exactly_once(
    client: TestClient, auth_headers: dict[str, str], db_session: Session
) -> None:
    recipe = create_meal(client, auth_headers)
    with freeze("2026-10-04T18:00:00+00:00"):
        assert settings(client, auth_headers, mode="automatic", reset_day=1).status_code == 200
        plan = client.post(
            "/api/v1/weekly-plans/current/slots",
            headers=auth_headers,
            json={"recipe_id": recipe, "slot_date": "2026-09-30"},
        ).json()
    with freeze("2026-10-05T12:00:00+00:00"):
        monday = client.get("/api/v1/weekly-plans/current", headers=auth_headers).json()
        assert any(item["recipe_id"] == recipe for item in monday["slots"])
    with freeze("2026-10-06T03:59:00+00:00"):
        assert any(
            item["recipe_id"]
            for item in client.get("/api/v1/weekly-plans/current", headers=auth_headers).json()[
                "slots"
            ]
        )
    with freeze("2026-10-06T04:00:00+00:00"):
        reset = client.get("/api/v1/weekly-plans/current", headers=auth_headers).json()
        assert not any(item["recipe_id"] for item in reset["slots"])
        assert reset["reset_cycle"] == "2026-10-06"
        added = client.post(
            "/api/v1/weekly-plans/current/slots", headers=auth_headers, json={"recipe_id": recipe}
        ).json()
        assert client.get("/api/v1/weekly-plans/current", headers=auth_headers).json() == added
        assert any(
            slot.recipe_id
            for slot in db_session.scalars(
                select(WeeklyPlanSlot).where(WeeklyPlanSlot.weekly_plan_id == plan["id"])
            )
        )
        assert (
            settings(client, auth_headers, mode="automatic", reset_day=1, notify=False).status_code
            == 200
        )
        assert any(
            item["recipe_id"]
            for item in client.get("/api/v1/weekly-plans/current", headers=auth_headers).json()[
                "slots"
            ]
        )


def test_settings_changes_never_clear_current_meals_and_protected_cursor(
    client: TestClient, auth_headers: dict[str, str], db_session: Session
) -> None:
    recipe = create_meal(client, auth_headers)
    with freeze("2026-10-05T12:00:00+00:00"):
        client.post(
            "/api/v1/weekly-plans/current/slots", headers=auth_headers, json={"recipe_id": recipe}
        )
        settings(client, auth_headers, mode="automatic")
        profile = client.get("/api/v1/profile", headers=auth_headers).json()
        profile["notification_preferences"][CURSOR_KEY] = "1900-01-01"
        profile["notification_preferences"][SETTINGS_KEY] = {"mode": "bad", "time_zone": "bad"}
        assert client.put("/api/v1/profile", headers=auth_headers, json=profile).status_code == 200
        assert any(
            item["recipe_id"]
            for item in client.get("/api/v1/weekly-plans/current", headers=auth_headers).json()[
                "slots"
            ]
        )
        assert planning_settings(user_for(db_session))["mode"] == "automatic"
        assert (
            settings(client, auth_headers, time_zone="UTC", initialize_only=True).json()[
                "weekly_planning"
            ]["time_zone"]
            == "America/New_York"
        )


@pytest.mark.parametrize(
    "changes",
    [
        {"reset_day": 7},
        {"reset_day": -1},
        {"mode": "invalid"},
        {"time_zone": "bad/zone"},
        {"time_zone": "../etc/passwd"},
    ],
)
def test_invalid_settings_rejected(
    client: TestClient, auth_headers: dict[str, str], changes: dict[str, Any]
) -> None:
    assert settings(client, auth_headers, **changes).status_code == 422


def test_dst_bounds_are_local_midnights(
    client: TestClient, auth_headers: dict[str, str], db_session: Session
) -> None:
    settings(client, auth_headers)
    start, end = week_bounds(user_for(db_session), date(2026, 10, 26))
    assert end - start == timedelta(hours=169)
    start, end = week_bounds(user_for(db_session), date(2026, 3, 2))
    assert end - start == timedelta(hours=167)


def test_worker_applies_reset_without_open_app_and_leaves_manual_accounts(
    client: TestClient,
    auth_headers: dict[str, str],
    db_session: Session,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    from app.workers import runner

    recipe = create_meal(client, auth_headers)
    with freeze("2026-10-04T18:00:00+00:00"):
        settings(client, auth_headers, mode="automatic")
        client.post(
            "/api/v1/weekly-plans/current/slots", headers=auth_headers, json={"recipe_id": recipe}
        )

    class BorrowedSession:
        def __enter__(self) -> Session:
            return db_session

        def __exit__(self, *_: object) -> None:
            db_session.rollback()

    monkeypatch.setattr(runner, "SessionLocal", BorrowedSession)
    with freeze("2026-10-05T04:00:00+00:00"):
        runner.process_weekly_resets()
        user = user_for(db_session)
        plan = reconcile_current_plan(db_session, user)
        assert not any(
            slot.recipe_id
            for slot in db_session.scalars(
                select(WeeklyPlanSlot).where(WeeklyPlanSlot.weekly_plan_id == plan.id)
            )
        )
        assert user.profile.notification_preferences[CURSOR_KEY] == "2026-10-05"
