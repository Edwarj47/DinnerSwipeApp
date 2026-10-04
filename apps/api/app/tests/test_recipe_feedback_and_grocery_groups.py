from __future__ import annotations

from collections.abc import Callable
from typing import Any, cast

from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from app.models.entities import Recipe
from app.services.validation import validate_recipe_payload


def save_meal(
    client: TestClient, headers: dict[str, str], name: str, ingredients: list[dict[str, Any]]
) -> dict[str, Any]:
    response = client.post(
        "/api/v1/recipes",
        headers=headers,
        json={"name": name, "servings": 2, "ingredients": ingredients},
    )
    assert response.status_code == 200, response.text
    recipe = cast(dict[str, Any], response.json())
    response = client.post(
        "/api/v1/weekly-plans/current/slots", headers=headers, json={"recipe_id": recipe["id"]}
    )
    assert response.status_code == 200, response.text
    return recipe


def test_title_only_recipe_can_be_saved_edited_and_planned(
    client: TestClient, auth_headers: dict[str, str]
) -> None:
    saved = client.post(
        "/api/v1/recipes", headers=auth_headers, json={"name": "Protein shake", "total_minutes": 0}
    )
    assert saved.status_code == 200, saved.text
    recipe = saved.json()
    assert recipe["validation_status"] == "approved"
    assert recipe["ingredients"] == recipe["instructions"] == []
    assert "Ingredients not added" in recipe["validation_warnings"]
    assert "Instructions not added" in recipe["validation_warnings"]
    assert "Missing timing information" not in recipe["validation_warnings"]
    assert recipe["total_minutes"] == 0
    assert (
        client.post(
            "/api/v1/weekly-plans/current/slots",
            headers=auth_headers,
            json={"recipe_id": recipe["id"]},
        ).status_code
        == 200
    )
    assert (
        client.put(
            f"/api/v1/recipes/{recipe['id']}", headers=auth_headers, json={"name": "My shake"}
        ).status_code
        == 200
    )
    assert (
        client.post("/api/v1/recipes", headers=auth_headers, json={"name": "  "}).status_code == 422
    )
    assert (
        client.post(
            "/api/v1/recipes",
            headers=auth_headers,
            json={"name": "Bad photo", "photo_url": "http://localhost/image"},
        ).json()["validation_status"]
        == "requires_review"
    )
    # Automated extraction still flags incomplete drafts; a user can save them deliberately.
    assert validate_recipe_payload({"name": "Imported shake"}, True)["errors"] == [
        "Empty ingredients",
        "Empty instructions",
    ]


def test_shared_recipe_groups_and_pantry_are_connected(
    client: TestClient, auth_headers: dict[str, str]
) -> None:
    onion = {"original_text": "1 red onion", "normalized_name": "red onion", "quantity": 1}
    first = save_meal(client, auth_headers, "Tacos", [onion, {"original_text": "2 cups rice"}])
    second = save_meal(client, auth_headers, "Salad", [onion])
    # A recipe selected twice appears once with the sum of its planned portions.
    client.post(
        "/api/v1/weekly-plans/current/slots", headers=auth_headers, json={"recipe_id": first["id"]}
    )
    client.post(
        "/api/v1/grocery-lists/current/items",
        headers=auth_headers,
        json={"display_name": "Foil", "quantity": 1},
    )
    result = client.get("/api/v1/grocery-lists/current", headers=auth_headers).json()
    groups = {group["recipe_id"]: group for group in result["recipe_groups"]}
    assert set(groups) == {first["id"], second["id"], None}
    assert groups[first["id"]]["servings"] == 4
    taco_onion = next(
        item for item in groups[first["id"]]["items"] if item["normalized_name"] == "red onion"
    )
    salad_onion = groups[second["id"]]["items"][0]
    assert taco_onion["id"] == salad_onion["id"]
    assert taco_onion["recipe_quantity"] == 2 and salad_onion["recipe_quantity"] == 1
    assert taco_onion["quantity"] == 3 and taco_onion["recipe_count"] == 2
    assert groups[None]["recipe_name"] == "Additional items"
    rice = next(item for item in result["items"] if item["normalized_name"] == "rice")
    client.patch(
        f"/api/v1/grocery-lists/items/{rice['id']}",
        headers=auth_headers,
        json={"quantity": 7, "is_checked": True},
    )
    client.patch(
        f"/api/v1/grocery-lists/items/{taco_onion['id']}",
        headers=auth_headers,
        json={"is_checked": True},
    )
    checked = client.get("/api/v1/grocery-lists/current", headers=auth_headers).json()
    assert all(
        item["is_checked"]
        for group in checked["recipe_groups"]
        for item in group["items"]
        if item["id"] == taco_onion["id"]
    )
    added = client.post(
        f"/api/v1/grocery-lists/items/{taco_onion['id']}/pantry", headers=auth_headers
    )
    assert added.status_code == 200, added.text
    current = client.get("/api/v1/grocery-lists/current", headers=auth_headers).json()
    assert not any(item["normalized_name"] == "red onion" for item in current["items"])
    unchanged_rice = next(item for item in current["items"] if item["id"] == rice["id"])
    assert unchanged_rice["quantity"] == 7 and unchanged_rice["is_checked"]
    duplicate = client.post(
        "/api/v1/grocery-lists/pantry", headers=auth_headers, json={"normalized_name": "Red onion"}
    )
    assert duplicate.json()["id"] == added.json()["id"]
    restored = client.delete(
        f"/api/v1/grocery-lists/pantry/{added.json()['id']}", headers=auth_headers
    )
    assert restored.status_code == 200
    current = client.get("/api/v1/grocery-lists/current", headers=auth_headers).json()
    assert (
        next(item for item in current["items"] if item["normalized_name"] == "red onion")[
            "quantity"
        ]
        == 3
    )
    assert (
        next(item for item in current["items"] if item["normalized_name"] == "rice")["quantity"]
        == 7
    )
    assert any(item["display_name"] == "Foil" for item in current["items"])
    regenerated = client.post(
        "/api/v1/grocery-lists/current/regenerate", headers=auth_headers
    ).json()
    assert any(item["display_name"] == "Foil" for item in regenerated["items"])


def test_grocery_groups_do_not_guess_units_or_unknown_amounts(
    client: TestClient, auth_headers: dict[str, str]
) -> None:
    recipe = save_meal(
        client,
        auth_headers,
        "Rice bowl",
        [
            {
                "original_text": "1 cup rice",
                "normalized_name": "rice",
                "quantity": 1,
                "unit": "cup",
            },
            {"original_text": "rice to taste", "normalized_name": "rice", "unit": "cup"},
            {
                "original_text": "100 g rice",
                "normalized_name": "rice",
                "quantity": 100,
                "unit": "g",
            },
        ],
    )
    result = client.get("/api/v1/grocery-lists/current", headers=auth_headers).json()
    assert result["recipe_groups"][0]["recipe_id"] == recipe["id"]
    items = {item["unit"]: item for item in result["items"]}
    assert items["cup"]["quantity"] is None and items["g"]["quantity"] == 100
    pantry = client.post(
        f"/api/v1/grocery-lists/items/{items['cup']['id']}/pantry", headers=auth_headers
    )
    assert pantry.status_code == 200
    assert client.get("/api/v1/grocery-lists/current", headers=auth_headers).json()["items"] == []


def test_feedback_ignored_per_user_preserves_warning_and_settings(
    client: TestClient,
    auth_headers: dict[str, str],
    db_session: Session,
    grant_basic_access: Callable[[str], object],
) -> None:
    stale_profile = client.get("/api/v1/profile", headers=auth_headers).json()
    recipe = client.post(
        "/api/v1/recipes", headers=auth_headers, json={"name": "Simple shake"}
    ).json()
    path = f"/api/v1/recipes/{recipe['id']}/feedback-preference"
    ignored = client.put(path, headers=auth_headers, json={"ignored": True})
    assert ignored.status_code == 200, ignored.text
    assert (
        ignored.json()["feedback_ignored"]
        and ignored.json()["validation_warnings"] == recipe["validation_warnings"]
    )
    assert not ignored.json()["is_hidden"] and not ignored.json()["is_archived"]
    stale_profile["notification_preferences"] = {"confirm_plan_reset": False}
    assert (
        client.put("/api/v1/profile", headers=auth_headers, json=stale_profile).status_code == 200
    )
    assert client.get(f"/api/v1/recipes/{recipe['id']}", headers=auth_headers).json()[
        "feedback_ignored"
    ]
    other = client.post(
        "/api/v1/auth/register",
        json={
            "email": "feedback@example.com",
            "password": "change-me-123",
            "terms_accepted": True,
            "privacy_accepted": True,
        },
    ).json()
    grant_basic_access("feedback@example.com")
    other_headers = {"Authorization": f"Bearer {other['access_token']}"}
    assert client.put(path, headers=other_headers, json={"ignored": True}).status_code == 404
    owned = db_session.get(Recipe, recipe["id"])
    assert owned
    owned.owner_user_id = None
    db_session.commit()
    assert not client.get(f"/api/v1/recipes/{recipe['id']}", headers=other_headers).json()[
        "feedback_ignored"
    ]
    assert client.put(path, headers=other_headers, json={"ignored": True}).json()[
        "feedback_ignored"
    ]
    # Changed feedback returns for review without discarding the stored old choice.
    owned.validation_warnings = [*owned.validation_warnings, "New quality warning"]
    db_session.commit()
    assert not client.get(f"/api/v1/recipes/{recipe['id']}", headers=auth_headers).json()[
        "feedback_ignored"
    ]
    assert not client.put(path, headers=auth_headers, json={"ignored": False}).json()[
        "feedback_ignored"
    ]


def test_quick_pantry_and_group_list_cannot_access_another_account(
    client: TestClient, auth_headers: dict[str, str], grant_basic_access: Callable[[str], object]
) -> None:
    added = client.post(
        "/api/v1/grocery-lists/current/items", headers=auth_headers, json={"display_name": "Milk"}
    ).json()
    grocery = client.get("/api/v1/grocery-lists/current", headers=auth_headers).json()
    other = client.post(
        "/api/v1/auth/register",
        json={
            "email": "pantry@example.com",
            "password": "change-me-123",
            "terms_accepted": True,
            "privacy_accepted": True,
        },
    ).json()
    grant_basic_access("pantry@example.com")
    headers = {"Authorization": f"Bearer {other['access_token']}"}
    assert (
        client.post(
            f"/api/v1/grocery-lists/items/{added['id']}/pantry", headers=headers
        ).status_code
        == 404
    )
    assert (
        client.get(
            f"/api/v1/grocery-lists/current?grocery_id={grocery['id']}", headers=headers
        ).status_code
        == 404
    )
    assert client.get("/api/v1/grocery-lists/pantry", headers=headers).json() == []
