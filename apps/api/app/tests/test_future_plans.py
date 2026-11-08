from collections.abc import Callable
from copy import deepcopy
from datetime import date
from typing import Any

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.models.entities import (
    GroceryList,
    GroceryListItem,
    Household,
    MealMacroConfirmation,
    UserSubscription,
    WeeklyPlan,
)
from app.services.planning import CURSOR_KEY, preplanned_weeks
from app.tests.test_group_planning import setup_group
from app.tests.test_weekly_planning import create_meal, freeze, settings, user_for

CURRENT = "2026-11-02"
FUTURE = "2026-11-09"
BASE = "/api/v1/weekly-plans/current"


def test_future_view_is_read_only_until_a_meal_is_added(
    client: TestClient, auth_headers: dict[str, str], db_session: Session
) -> None:
    with freeze("2026-11-08T18:00:00+00:00"):
        original = deepcopy(user_for(db_session).profile.notification_preferences)
        result = client.get(f"{BASE}?week_start={FUTURE}", headers=auth_headers)
        assert result.status_code == 200
        assert result.json()["id"] is None and result.json()["slots"] == []
        assert db_session.scalar(select(func.count()).select_from(WeeklyPlan)) == 0
        assert db_session.scalar(select(func.count()).select_from(GroceryList)) == 0
        assert user_for(db_session).profile.notification_preferences == original
        recipe = create_meal(client, auth_headers)
        saved = client.post(
            f"{BASE}/slots?week_start={FUTURE}",
            headers=auth_headers,
            json={"recipe_id": recipe, "slot_date": FUTURE, "servings": 3},
        )
        assert saved.status_code == 200
        plan = saved.json()
        slot = next(row for row in plan["slots"] if row["recipe_id"])
        assert slot["slot_date"] == FUTURE and slot["servings"] == 3
        assert client.get(f"{BASE}?week_start={FUTURE}", headers=auth_headers).json() == plan
        assert not any(
            row["recipe_id"] for row in client.get(BASE, headers=auth_headers).json()["slots"]
        )
        assert db_session.scalar(select(func.count()).select_from(MealMacroConfirmation)) == 0


def test_future_edit_duplicate_order_and_reset_are_scoped_to_that_week(
    client: TestClient, auth_headers: dict[str, str]
) -> None:
    with freeze("2026-11-08T18:00:00+00:00"):
        recipe = create_meal(client, auth_headers)
        current = client.post(
            f"{BASE}/slots", headers=auth_headers, json={"recipe_id": recipe}
        ).json()
        first = client.post(
            f"{BASE}/slots?week_start={FUTURE}",
            headers=auth_headers,
            json={"recipe_id": recipe, "slot_date": FUTURE},
        ).json()
        slot = next(row for row in first["slots"] if row["recipe_id"])
        moved = client.put(
            f"{BASE}/slots/{slot['id']}?week_start={FUTURE}",
            headers=auth_headers,
            json={"slot_date": "2026-11-15", "servings": 4},
        )
        assert moved.status_code == 200
        assert (
            client.put(
                f"{BASE}/slots/{slot['id']}", headers=auth_headers, json={"servings": 9}
            ).status_code
            == 404
        )
        # A failed request must not be committed by the next fixture request.
        copied = client.post(
            f"{BASE}/slots?week_start={FUTURE}",
            headers=auth_headers,
            json={"recipe_id": recipe, "slot_date": None},
        ).json()
        ids = [row["id"] for row in reversed(copied["slots"])]
        assert (
            client.post(
                f"{BASE}/reorder?week_start={FUTURE}",
                headers=auth_headers,
                json={"ordered_slot_ids": ids},
            ).status_code
            == 200
        )
        assert (
            client.post(
                f"{BASE}/reset?week_start={FUTURE}",
                headers=auth_headers,
                json={"slot_date": "2026-11-15"},
            ).status_code
            == 200
        )
        assert client.get(BASE, headers=auth_headers).json() == current


@pytest.mark.parametrize(
    "week,code", [("2026-10-26", 409), ("2026-11-10", 422), ("2027-11-08", 422)]
)
def test_invalid_selected_weeks_never_create_or_reset_plans(
    client: TestClient, auth_headers: dict[str, str], db_session: Session, week: str, code: int
) -> None:
    with freeze("2026-11-08T18:00:00+00:00"):
        recipe = create_meal(client, auth_headers)
        cases: list[tuple[str, str, dict[str, Any] | None]] = [
            ("GET", BASE, None),
            ("POST", f"{BASE}/slots", {"recipe_id": recipe}),
            ("PUT", f"{BASE}/slots/missing", {"servings": 2}),
            ("DELETE", f"{BASE}/slots/missing", None),
            ("POST", f"{BASE}/reset", {}),
            ("POST", f"{BASE}/reorder", {"ordered_slot_ids": ["missing"]}),
        ]
        for method, path, body in cases:
            result = client.request(
                method, f"{path}?week_start={week}", headers=auth_headers, json=body
            )
            assert result.status_code == code, result.text
        assert db_session.scalar(select(func.count()).select_from(WeeklyPlan)) == 0


def test_planned_ahead_meals_survive_first_automatic_rollover(
    client: TestClient,
    auth_headers: dict[str, str],
    db_session: Session,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    from app.workers import runner

    class BorrowedSession:
        def __enter__(self) -> Session:
            return db_session

        def __exit__(self, *_: object) -> None:
            db_session.rollback()

    monkeypatch.setattr(runner, "SessionLocal", BorrowedSession)
    with freeze("2026-11-08T18:00:00+00:00"):
        settings(client, auth_headers, mode="automatic", reset_day=0)
        current = client.get(BASE, headers=auth_headers).json()
        cursor = user_for(db_session).profile.notification_preferences[CURSOR_KEY]
        recipe = create_meal(client, auth_headers)
        saved = client.post(
            f"{BASE}/slots?week_start={FUTURE}",
            headers=auth_headers,
            json={"recipe_id": recipe, "slot_date": FUTURE},
        ).json()
        assert user_for(db_session).profile.notification_preferences[CURSOR_KEY] == cursor
        assert client.get(BASE, headers=auth_headers).json() == current
        assert FUTURE in preplanned_weeks(user_for(db_session).profile.notification_preferences)
    with freeze("2026-11-09T12:00:00+00:00"):
        runner.process_weekly_resets()
        rolled = client.get(BASE, headers=auth_headers).json()
        assert rolled["id"] == saved["id"]
        assert any(row["recipe_id"] == recipe for row in rolled["slots"])
        assert FUTURE not in preplanned_weeks(user_for(db_session).profile.notification_preferences)
        assert client.get(BASE, headers=auth_headers).json() == rolled
    with freeze("2026-11-16T12:00:00+00:00"):
        assert not any(
            row["recipe_id"] for row in client.get(BASE, headers=auth_headers).json()["slots"]
        )
        stored = db_session.scalar(
            select(WeeklyPlan).where(WeeklyPlan.week_start == date(2026, 11, 9))
        )
        assert stored and stored.id == saved["id"]


def test_future_groceries_follow_recipe_edits_and_markers_cannot_be_replaced_by_profile_put(
    client: TestClient, auth_headers: dict[str, str], db_session: Session
) -> None:
    with freeze("2026-11-08T18:00:00+00:00"):
        body = {
            "name": "Future onions",
            "servings": 2,
            "instructions": [],
            "ingredients": [
                {
                    "original_text": "2 onions",
                    "normalized_name": "onion",
                    "quantity": 2,
                    "unit": "each",
                }
            ],
        }
        recipe = client.post("/api/v1/recipes", headers=auth_headers, json=body).json()
        plan = client.post(
            f"{BASE}/slots?week_start={FUTURE}",
            headers=auth_headers,
            json={"recipe_id": recipe["id"], "servings": 2},
        ).json()
        grocery = db_session.scalar(
            select(GroceryList).where(GroceryList.weekly_plan_id == plan["id"])
        )
        assert grocery
        item = db_session.scalar(
            select(GroceryListItem).where(GroceryListItem.grocery_list_id == grocery.id)
        )
        assert item and item.quantity == 2
        body["ingredients"] = [
            {"original_text": "6 onions", "normalized_name": "onion", "quantity": 6, "unit": "each"}
        ]
        assert (
            client.put(
                f"/api/v1/recipes/{recipe['id']}", headers=auth_headers, json=body
            ).status_code
            == 200
        )
        db_session.refresh(item)
        assert item.quantity == 6
        profile = client.get("/api/v1/profile", headers=auth_headers).json()
        profile["notification_preferences"]["weekly_planning_preplanned_weeks"] = ["2099-01-05"]
        assert client.put("/api/v1/profile", headers=auth_headers, json=profile).status_code == 200
        assert preplanned_weeks(user_for(db_session).profile.notification_preferences) == [FUTURE]


def test_preplanned_arrival_does_not_suppress_a_later_scheduled_reset(
    client: TestClient, auth_headers: dict[str, str]
) -> None:
    with freeze("2026-11-08T18:00:00+00:00"):
        settings(client, auth_headers, mode="automatic", reset_day=2, time_zone="UTC")
        recipe = create_meal(client, auth_headers)
        saved = client.post(
            f"{BASE}/slots?week_start={FUTURE}",
            headers=auth_headers,
            json={"recipe_id": recipe},
        ).json()
    with freeze("2026-11-09T12:00:00+00:00"):
        arrived = client.get(BASE, headers=auth_headers).json()
        assert arrived["id"] == saved["id"]
        assert any(row["recipe_id"] == recipe for row in arrived["slots"])
    with freeze("2026-11-11T12:00:00+00:00"):
        reset = client.get(BASE, headers=auth_headers).json()
        assert reset["id"] == saved["id"]
        assert not any(row["recipe_id"] for row in reset["slots"])


def test_future_group_calendar_requires_owner_to_edit_and_survives_rollover(
    client: TestClient,
    auth_headers: dict[str, str],
    db_session: Session,
    grant_basic_access: Callable[[str], UserSubscription],
) -> None:
    with freeze("2026-11-08T18:00:00+00:00"):
        base, member, recipe = setup_group(client, db_session, auth_headers, grant_basic_access)
        path = f"{base}/weekly-plans/current"
        assert (
            client.put(
                f"{base}/planning-settings",
                headers=auth_headers,
                json={"mode": "automatic", "reset_day": 0, "notify": False, "time_zone": "UTC"},
            ).status_code
            == 200
        )
        assert client.get(f"{path}?week_start={FUTURE}", headers=member).json()["id"] is None
        assert db_session.scalar(select(func.count()).select_from(WeeklyPlan)) == 0
        assert (
            client.post(
                f"{path}/slots?week_start={FUTURE}",
                headers=member,
                json={"recipe_id": recipe["id"]},
            ).status_code
            == 403
        )
        result = client.post(
            f"{path}/slots?week_start={FUTURE}",
            headers=auth_headers,
            json={"recipe_id": recipe["id"], "slot_date": FUTURE},
        )
        assert result.status_code == 200, result.text
        plan = result.json()
        slot = plan["slots"][0]
        # Saving public settings cannot discard or forge server-owned rollover metadata.
        config = {"mode": "automatic", "reset_day": 0, "notify": True, "time_zone": "UTC"}
        assert (
            client.put(
                f"{base}/planning-settings",
                headers=auth_headers,
                json=config | {"weekly_planning_preplanned_weeks": ["2099-01-05"]},
            ).status_code
            == 200
        )
        assert (
            client.put(f"{base}/planning-settings", headers=auth_headers, json=config).status_code
            == 200
        )
        group = db_session.get(Household, base.rsplit("/", 1)[-1])
        assert group and preplanned_weeks(group.planning_settings or {}) == [FUTURE]
        assert (
            client.delete(
                f"{path}/slots/{slot['id']}?week_start={FUTURE}", headers=member
            ).status_code
            == 403
        )
        assert (
            client.post(
                f"{path}/reset?week_start=2026-10-26", headers=auth_headers, json={}
            ).status_code
            == 409
        )
    with freeze("2026-11-09T12:00:00+00:00"):
        current = client.get(path, headers=auth_headers).json()
        assert current["id"] == plan["id"] and current["slots"][0]["id"] == slot["id"]
