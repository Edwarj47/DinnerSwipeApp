from __future__ import annotations

from collections.abc import Callable
from datetime import date, timedelta
from typing import Any

import pytest
from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from app.models.entities import (
    MealMacroConfirmation,
    MealSwipe,
    User,
    UserSubscription,
    WeeklyPlanSlot,
)
from app.services.billing import PREMIUM_PLAN_KEY


def add_meal(
    client: TestClient, headers: dict[str, str], name: str = "Reset pasta"
) -> tuple[dict[str, Any], dict[str, Any], dict[str, Any]]:
    recipe = client.post(
        "/api/v1/recipes",
        headers=headers,
        json={
            "name": name,
            "photo_url": "https://example.com/meal.jpg",
            "servings": 4,
            "ingredients": [{"original_text": "1 lb pasta"}],
            "instructions": [{"step_number": 1, "text": "Boil pasta"}],
        },
    ).json()
    client.post(
        "/api/v1/recipes/swipes",
        headers=headers,
        json={"recipe_id": recipe["id"], "action": "add", "session_id": "reset-test"},
    )
    plan = client.get("/api/v1/weekly-plans/current", headers=headers).json()
    slot = next(slot for slot in plan["slots"] if slot["recipe_id"] == recipe["id"])
    return recipe, plan, slot


def test_reset_day_preserves_other_days_recipes_macros_and_manual_groceries(
    client: TestClient, auth_headers: dict[str, str], db_session: Session
) -> None:
    recipe, plan, monday = add_meal(client, auth_headers)
    _, _, tuesday = add_meal(client, auth_headers, "Tuesday soup")
    monday_date = plan["week_start"]
    tuesday_date = str(date.fromisoformat(monday_date) + timedelta(days=1))
    for slot, day in [(monday, monday_date), (tuesday, tuesday_date)]:
        client.put(
            f"/api/v1/weekly-plans/current/slots/{slot['id']}",
            headers=auth_headers,
            json={"slot_date": day, "is_locked": True, "servings": 6},
        )
    user = db_session.query(User).filter_by(email="owner@example.com").one()
    log = MealMacroConfirmation(
        user_id=user.id,
        recipe_id=recipe["id"],
        weekly_plan_slot_id=monday["id"],
        meal_date=date.fromisoformat(monday_date),
        calories=400,
    )
    db_session.add(log)
    db_session.commit()
    client.post(
        "/api/v1/grocery-lists/current/items",
        headers=auth_headers,
        json={"display_name": "Paper towels"},
    )
    response = client.post(
        "/api/v1/weekly-plans/current/reset", headers=auth_headers, json={"slot_date": monday_date}
    )
    assert response.status_code == 200
    slots = {slot["id"]: slot for slot in response.json()["slots"]}
    assert slots[monday["id"]]["recipe_id"] is None
    assert slots[monday["id"]]["slot_date"] == monday_date
    assert slots[monday["id"]]["is_locked"] is False
    assert slots[monday["id"]]["servings"] == 2
    assert slots[tuesday["id"]]["recipe_id"] == tuesday["recipe_id"]
    assert slots[tuesday["id"]]["is_locked"] is True
    db_session.refresh(log)
    assert log.calories == 400 and log.weekly_plan_slot_id is None
    assert client.get(f"/api/v1/recipes/{recipe['id']}", headers=auth_headers).status_code == 200
    items = client.get("/api/v1/grocery-lists/current", headers=auth_headers).json()["items"]
    assert any(item["display_name"] == "Paper towels" for item in items)


def test_reset_week_restores_profile_defaults_and_is_repeatable(
    client: TestClient, auth_headers: dict[str, str], db_session: Session
) -> None:
    _, plan, slot = add_meal(client, auth_headers)
    user = db_session.query(User).filter_by(email="owner@example.com").one()
    user.profile.weekly_meal_target = 3
    user.profile.household_size = 4
    db_session.add(
        WeeklyPlanSlot(
            weekly_plan_id=plan["id"],
            recipe_id=slot["recipe_id"],
            servings=9,
            is_locked=True,
            sort_order=99,
        )
    )
    db_session.commit()
    for _ in range(2):
        response = client.post("/api/v1/weekly-plans/current/reset", headers=auth_headers, json={})
        assert response.status_code == 200
        result = response.json()
        assert result["meal_target"] == 3 and len(result["slots"]) == 3
        assert all(
            slot["recipe_id"] is None
            and slot["slot_date"] is None
            and slot["slot_type"] == "flexible"
            and not slot["is_locked"]
            and slot["servings"] == 4
            for slot in result["slots"]
        )
        assert [slot["sort_order"] for slot in result["slots"]] == [0, 1, 2]


def test_discover_add_is_unscheduled_after_resetting_a_dated_slot(
    client: TestClient, auth_headers: dict[str, str]
) -> None:
    recipe, plan, slot = add_meal(client, auth_headers)
    sunday = str(date.fromisoformat(plan["week_start"]) + timedelta(days=6))
    moved = client.put(
        f"/api/v1/weekly-plans/current/slots/{slot['id']}",
        headers=auth_headers,
        json={"slot_date": sunday},
    )
    assert moved.status_code == 200
    monday = client.post(
        "/api/v1/weekly-plans/current/slots",
        headers=auth_headers,
        json={"recipe_id": recipe["id"], "slot_date": plan["week_start"]},
    )
    assert monday.status_code == 200
    reset = client.post(
        "/api/v1/weekly-plans/current/reset",
        headers=auth_headers,
        json={"slot_date": sunday},
    )
    assert reset.status_code == 200
    _, after, added = add_meal(client, auth_headers, "New Discover meal")
    assert added["id"] == slot["id"]
    assert added["slot_date"] is None
    assert any(
        item["recipe_id"] == recipe["id"] and item["slot_date"] == plan["week_start"]
        for item in after["slots"]
    )


def test_reset_and_move_reject_dates_outside_current_week(
    client: TestClient, auth_headers: dict[str, str]
) -> None:
    plan = client.get("/api/v1/weekly-plans/current", headers=auth_headers).json()
    invalid = str(date.fromisoformat(plan["week_start"]) + timedelta(days=7))
    assert (
        client.post(
            "/api/v1/weekly-plans/current/reset", headers=auth_headers, json={"slot_date": invalid}
        ).status_code
        == 422
    )
    assert (
        client.put(
            f"/api/v1/weekly-plans/current/slots/{plan['slots'][0]['id']}",
            headers=auth_headers,
            json={"slot_date": invalid},
        ).status_code
        == 422
    )
    assert client.post("/api/v1/weekly-plans/current/reset", json={}).status_code == 401


def test_reset_is_scoped_to_the_signed_in_account(
    client: TestClient,
    auth_headers: dict[str, str],
    grant_basic_access: Callable[[str], UserSubscription],
) -> None:
    _, _, slot = add_meal(client, auth_headers)
    other = client.post(
        "/api/v1/auth/register",
        json={
            "email": "other-planner@example.com",
            "password": "fixture-password",
            "terms_accepted": True,
            "privacy_accepted": True,
        },
    ).json()
    grant_basic_access("other-planner@example.com")
    other_headers = {"Authorization": f"Bearer {other['access_token']}"}
    assert (
        client.post(
            "/api/v1/weekly-plans/current/reset", headers=other_headers, json={}
        ).status_code
        == 200
    )
    assert (
        client.put(
            f"/api/v1/weekly-plans/current/slots/{slot['id']}",
            headers=other_headers,
            json={"slot_date": None},
        ).status_code
        == 404
    )
    owner_plan = client.get("/api/v1/weekly-plans/current", headers=auth_headers).json()
    assert (
        next(item for item in owner_plan["slots"] if item["id"] == slot["id"])["recipe_id"]
        == slot["recipe_id"]
    )


def test_weekly_slot_partial_update_preserves_existing_fields(
    client: TestClient, auth_headers: dict[str, str]
) -> None:
    recipe = client.post(
        "/api/v1/recipes",
        headers=auth_headers,
        json={
            "name": "Plan pasta",
            "photo_url": "https://example.com/pasta.jpg",
            "servings": 4,
            "ingredients": [{"original_text": "1 lb pasta"}],
            "instructions": [{"step_number": 1, "text": "Boil pasta"}],
        },
    ).json()
    client.post(
        "/api/v1/recipes/swipes",
        headers=auth_headers,
        json={"recipe_id": recipe["id"], "action": "add", "session_id": "s1"},
    )
    plan = client.get("/api/v1/weekly-plans/current", headers=auth_headers).json()
    slot = next(item for item in plan["slots"] if item["recipe_id"] == recipe["id"])

    updated = client.put(
        f"/api/v1/weekly-plans/current/slots/{slot['id']}",
        headers=auth_headers,
        json={"servings": 6, "is_locked": True},
    )

    assert updated.status_code == 200
    changed = next(item for item in updated.json()["slots"] if item["id"] == slot["id"])
    assert changed["recipe_id"] == recipe["id"]
    assert changed["slot_type"] == "meal"
    assert changed["servings"] == 6
    assert changed["is_locked"] is True


def test_weekly_slot_non_meal_type_clears_recipe(
    client: TestClient, auth_headers: dict[str, str]
) -> None:
    recipe = client.post(
        "/api/v1/recipes",
        headers=auth_headers,
        json={
            "name": "Leftover chili",
            "photo_url": "https://example.com/chili.jpg",
            "servings": 4,
            "ingredients": [{"original_text": "1 can beans"}],
            "instructions": [{"step_number": 1, "text": "Warm chili"}],
        },
    ).json()
    client.post(
        "/api/v1/recipes/swipes",
        headers=auth_headers,
        json={"recipe_id": recipe["id"], "action": "add", "session_id": "s1"},
    )
    plan = client.get("/api/v1/weekly-plans/current", headers=auth_headers).json()
    slot = next(item for item in plan["slots"] if item["recipe_id"] == recipe["id"])

    updated = client.put(
        f"/api/v1/weekly-plans/current/slots/{slot['id']}",
        headers=auth_headers,
        json={"slot_type": "leftovers"},
    )

    assert updated.status_code == 200
    changed = next(item for item in updated.json()["slots"] if item["id"] == slot["id"])
    assert changed["recipe_id"] is None
    assert changed["recipe_name"] is None
    assert changed["slot_type"] == "leftovers"


def test_add_multiple_meals_to_a_day_without_overwriting_other_days(
    client: TestClient, auth_headers: dict[str, str]
) -> None:
    recipe, plan, first = add_meal(client, auth_headers)
    monday = plan["week_start"]
    tuesday = str(date.fromisoformat(monday) + timedelta(days=1))
    client.put(
        f"/api/v1/weekly-plans/current/slots/{first['id']}",
        headers=auth_headers,
        json={"slot_date": tuesday},
    )
    for _ in range(6):
        response = client.post(
            "/api/v1/weekly-plans/current/slots",
            headers=auth_headers,
            json={"recipe_id": recipe["id"], "slot_date": monday},
        )
        assert response.status_code == 200
    slots = response.json()["slots"]
    assert len([slot for slot in slots if slot["slot_date"] == monday and slot["recipe_id"]]) == 6
    assert next(slot for slot in slots if slot["id"] == first["id"])["slot_date"] == tuesday
    assert len(slots) == 7
    removed = next(slot for slot in slots if slot["slot_date"] == monday)
    response = client.delete(
        f"/api/v1/weekly-plans/current/slots/{removed['id']}", headers=auth_headers
    )
    assert len([slot for slot in response.json()["slots"] if slot["recipe_id"]]) == 6
    bad_day = str(date.fromisoformat(monday) + timedelta(days=8))
    assert (
        client.post(
            "/api/v1/weekly-plans/current/slots",
            headers=auth_headers,
            json={"recipe_id": recipe["id"], "slot_date": bad_day},
        ).status_code
        == 422
    )
    assert (
        client.post(
            "/api/v1/weekly-plans/current/slots",
            headers=auth_headers,
            json={"recipe_id": "not-accessible", "slot_date": monday},
        ).status_code
        == 404
    )


@pytest.mark.parametrize("day_offset", [None, 0, 6])
def test_copy_meal_preserves_portions_without_copying_logs_or_swipe_history(
    client: TestClient, auth_headers: dict[str, str], db_session: Session, day_offset: int | None
) -> None:
    recipe, plan, source = add_meal(client, auth_headers)
    source_plan = client.put(
        f"/api/v1/weekly-plans/current/slots/{source['id']}",
        headers=auth_headers,
        json={"slot_date": plan["week_start"], "servings": 3, "is_locked": True},
    ).json()
    source = next(slot for slot in source_plan["slots"] if slot["id"] == source["id"])
    user = db_session.query(User).filter_by(email="owner@example.com").one()
    log = MealMacroConfirmation(
        user_id=user.id,
        recipe_id=recipe["id"],
        weekly_plan_slot_id=source["id"],
        meal_date=date.fromisoformat(plan["week_start"]),
        calories=600,
        servings_consumed=3,
    )
    db_session.add(log)
    db_session.commit()
    before_groceries = client.get(
        "/api/v1/grocery-lists/current", headers=auth_headers
    ).json()["items"]
    destination = (
        str(date.fromisoformat(plan["week_start"]) + timedelta(days=day_offset))
        if day_offset is not None else None
    )
    copied = client.post(
        "/api/v1/weekly-plans/current/slots",
        headers=auth_headers,
        json={"recipe_id": recipe["id"], "slot_date": destination, "servings": source["servings"]},
    )
    assert copied.status_code == 200
    meals = [slot for slot in copied.json()["slots"] if slot["recipe_id"]]
    assert len(meals) == 2
    assert next(slot for slot in meals if slot["id"] == source["id"]) == source
    copy = next(slot for slot in meals if slot["id"] != source["id"])
    assert copy["recipe_id"] == recipe["id"]
    assert copy["slot_date"] == destination and copy["servings"] == 3
    assert copy["slot_type"] == "meal" and not copy["is_locked"]
    assert db_session.query(MealMacroConfirmation).count() == 1
    db_session.refresh(log)
    assert log.weekly_plan_slot_id == source["id"] and log.calories == 600
    assert db_session.query(MealSwipe).count() == 1
    after_groceries = client.get(
        "/api/v1/grocery-lists/current", headers=auth_headers
    ).json()["items"]
    assert len(before_groceries) == len(after_groceries) == 1
    assert after_groceries[0]["quantity"] == pytest.approx(before_groceries[0]["quantity"] * 2)


def test_copy_meal_rejects_invalid_portions_dates_and_inaccessible_recipes(
    client: TestClient,
    auth_headers: dict[str, str],
    grant_basic_access: Callable[[str], UserSubscription],
) -> None:
    recipe, plan, _ = add_meal(client, auth_headers)
    invalid_date = str(date.fromisoformat(plan["week_start"]) + timedelta(days=7))
    invalid_changes: list[dict[str, Any]] = [
        {"servings": 0}, {"servings": 31}, {"slot_date": invalid_date}
    ]
    for change in invalid_changes:
        response = client.post(
            "/api/v1/weekly-plans/current/slots",
            headers=auth_headers,
            json={"recipe_id": recipe["id"], "servings": 2, **change},
        )
        assert response.status_code == 422
    assert client.post(
        "/api/v1/weekly-plans/current/slots", json={"recipe_id": recipe["id"], "servings": 2}
    ).status_code == 401
    other = client.post(
        "/api/v1/auth/register",
        json={
            "email": "other-copier@example.com", "password": "fixture-password",
            "terms_accepted": True, "privacy_accepted": True,
        },
    ).json()
    grant_basic_access("other-copier@example.com")
    assert client.post(
        "/api/v1/weekly-plans/current/slots",
        headers={"Authorization": f"Bearer {other['access_token']}"},
        json={"recipe_id": recipe["id"], "servings": 2},
    ).status_code == 404
    after = client.get("/api/v1/weekly-plans/current", headers=auth_headers).json()
    assert after["slots"] == plan["slots"]


def test_weekly_ate_skipped_and_remove_preserve_distinct_analytics(
    client: TestClient, auth_headers: dict[str, str], db_session: Session
) -> None:
    recipe, plan, slot = add_meal(client, auth_headers)
    subscription = db_session.query(UserSubscription).one()
    subscription.plan_key = PREMIUM_PLAN_KEY
    db_session.commit()
    payload = {
        "recipe_id": recipe["id"], "weekly_plan_slot_id": slot["id"],
        "meal_date": plan["week_start"], "servings_consumed": slot["servings"],
        "calories": 500, "protein_g": 30,
    }
    ate = client.post(
        "/api/v1/macros/confirmations", headers=auth_headers, json={**payload, "status": "ate"}
    )
    skipped = client.post(
        "/api/v1/macros/confirmations", headers=auth_headers, json={**payload, "status": "skipped"}
    )
    assert ate.status_code == skipped.status_code == 200
    assert ate.json()["calories"] == 500 and skipped.json()["calories"] == 0
    summary_url = f"/api/v1/macros/summary?days=7&end_date={plan['week_start']}"
    before = client.get(summary_url, headers=auth_headers).json()
    assert before["eaten_meals"] == before["skipped_meals"] == 1
    assert before["totals"]["calories"] == 500
    removed = client.delete(
        f"/api/v1/weekly-plans/current/slots/{slot['id']}", headers=auth_headers
    )
    assert removed.status_code == 200
    assert not any(item["recipe_id"] for item in removed.json()["slots"])
    after = client.get(summary_url, headers=auth_headers).json()
    assert after["totals"] == before["totals"]
    assert after["eaten_meals"] == after["skipped_meals"] == 1
    assert all(row.weekly_plan_slot_id is None for row in db_session.query(MealMacroConfirmation))
    assert db_session.query(MealSwipe).count() == 1
    assert db_session.query(MealSwipe).one().undone_at is not None
