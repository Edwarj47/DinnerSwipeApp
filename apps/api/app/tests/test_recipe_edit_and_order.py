from __future__ import annotations

from collections.abc import Callable
from datetime import date
from typing import Any

from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from app.models.entities import MealMacroConfirmation, Recipe, User
from app.tests.test_weekly_plans import add_meal


def edited_payload() -> dict[str, Any]:
    return {
        "name": "Edited soup",
        "description": "New instructions",
        "servings": 1,
        "prep_minutes": 0,
        "cook_minutes": 0,
        "total_minutes": 0,
        "meal_type": "lunch",
        "difficulty": "easy",
        "cuisine": "Italian",
        "source_type": "manual",
        "source_title": "My kitchen",
        "accept_placeholder_photo": True,
        "ingredients": [{"original_text": "2 carrots", "sort_order": 0}],
        "instructions": [{"text": "Serve the carrots", "step_number": 1}],
        "tags": ["vegetarian", "vegetarian"],
        "nutrition": {"calories": 160, "protein_g": 30, "carbs_g": 4, "fat_g": 3, "fiber_g": 2},
    }


def test_full_edit_updates_children_groceries_but_preserves_history(
    client: TestClient, auth_headers: dict[str, str], db_session: Session
) -> None:
    recipe, plan, slot = add_meal(client, auth_headers)
    owned = db_session.get(Recipe, recipe["id"])
    assert owned
    owned.source_type = "ai_assisted"
    user = db_session.query(User).filter_by(email="owner@example.com").one()
    log = MealMacroConfirmation(
        user_id=user.id,
        recipe_id=recipe["id"],
        weekly_plan_slot_id=slot["id"],
        meal_date=date.fromisoformat(plan["week_start"]),
        calories=500,
        protein_g=60,
    )
    db_session.add(log)
    db_session.commit()
    payload = edited_payload()
    response = client.put(f"/api/v1/recipes/{recipe['id']}", headers=auth_headers, json=payload)
    assert response.status_code == 200, response.text
    result = response.json()
    assert result["id"] == recipe["id"] and result["can_edit"]
    assert result["name"] == payload["name"] and result["source_type"] == "ai_assisted"
    assert result["total_minutes"] == 0 and result["cuisine"] == "Italian"
    assert result["tags"] == ["vegetarian"]
    assert [item["original_text"] for item in result["ingredients"]] == ["2 carrots"]
    assert result["nutrition"] == payload["nutrition"]
    current = client.get("/api/v1/weekly-plans/current", headers=auth_headers).json()
    assert (
        next(item for item in current["slots"] if item["id"] == slot["id"])["recipe_name"]
        == "Edited soup"
    )
    grocery = client.get("/api/v1/grocery-lists/current", headers=auth_headers).json()
    assert any("carrot" in item["normalized_name"] for item in grocery["items"])
    assert not any("pasta" in item["normalized_name"] for item in grocery["items"])
    db_session.refresh(log)
    assert log.calories == 500 and log.protein_g == 60
    # Saving unchanged content must not count the recipe itself as a duplicate.
    assert (
        client.put(f"/api/v1/recipes/{recipe['id']}", headers=auth_headers, json=payload).json()[
            "duplicate_status"
        ]
        == "new"
    )


def test_edit_validation_and_ownership_preserve_existing_recipe(
    client: TestClient,
    auth_headers: dict[str, str],
    db_session: Session,
    grant_basic_access: Callable[..., Any],
) -> None:
    recipe, _, _ = add_meal(client, auth_headers)
    payload = edited_payload()
    response = client.put(
        f"/api/v1/recipes/{recipe['id']}", headers=auth_headers, json=payload | {"name": ""}
    )
    assert response.status_code == 422
    assert (
        client.get(f"/api/v1/recipes/{recipe['id']}", headers=auth_headers).json()["name"]
        == recipe["name"]
    )
    token = client.post(
        "/api/v1/auth/register",
        json={
            "email": "other@example.com",
            "password": "another-password-123",
            "terms_accepted": True,
            "privacy_accepted": True,
        },
    ).json()["access_token"]
    grant_basic_access("other@example.com")
    response = client.put(
        f"/api/v1/recipes/{recipe['id']}",
        headers={"Authorization": f"Bearer {token}"},
        json=payload,
    )
    assert response.status_code == 404
    owned = db_session.get(Recipe, recipe["id"])
    assert owned
    owned.owner_user_id = None
    db_session.commit()
    assert (
        client.put(
            f"/api/v1/recipes/{recipe['id']}", headers=auth_headers, json=payload
        ).status_code
        == 404
    )


def test_reorder_is_atomic_persistent_and_rejects_incomplete_or_foreign_ids(
    client: TestClient, auth_headers: dict[str, str]
) -> None:
    _, _, first = add_meal(client, auth_headers, "First meal")
    _, plan, second = add_meal(client, auth_headers, "Second meal")
    slots = sorted(plan["slots"], key=lambda item: item["sort_order"])
    ids = [item["id"] for item in slots]
    first_index, second_index = ids.index(first["id"]), ids.index(second["id"])
    ids[first_index], ids[second_index] = ids[second_index], ids[first_index]
    result = client.post(
        "/api/v1/weekly-plans/current/reorder", headers=auth_headers, json={"ordered_slot_ids": ids}
    )
    assert result.status_code == 200, result.text
    returned = result.json()["slots"]
    assert [item["id"] for item in returned] == ids
    originals = {item["id"]: item for item in slots}
    for item in returned:
        assert {k: v for k, v in item.items() if k != "sort_order"} == {
            k: v for k, v in originals[item["id"]].items() if k != "sort_order"
        }
    for invalid in (ids[:-1], ids[:-1] + ["foreign"], [ids[0]] * len(ids)):
        assert (
            client.post(
                "/api/v1/weekly-plans/current/reorder",
                headers=auth_headers,
                json={"ordered_slot_ids": invalid},
            ).status_code
            == 409
        )
        assert [
            item["id"]
            for item in client.get("/api/v1/weekly-plans/current", headers=auth_headers).json()[
                "slots"
            ]
        ] == ids
