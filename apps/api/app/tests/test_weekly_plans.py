from __future__ import annotations

from fastapi.testclient import TestClient


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
