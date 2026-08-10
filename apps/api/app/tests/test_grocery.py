from __future__ import annotations

from fastapi.testclient import TestClient


def test_grocery_aggregates_selected_recipe(
    client: TestClient, auth_headers: dict[str, str]
) -> None:
    recipe = client.post(
        "/api/v1/recipes",
        headers=auth_headers,
        json={
            "name": "Rice dinner",
            "photo_url": "https://example.com/rice.jpg",
            "servings": 4,
            "ingredients": [{"original_text": "2 cups rice"}],
            "instructions": [{"step_number": 1, "text": "Cook rice"}],
        },
    ).json()
    client.post(
        "/api/v1/recipes/swipes",
        headers=auth_headers,
        json={"recipe_id": recipe["id"], "action": "add", "session_id": "s1"},
    )
    grocery = client.post("/api/v1/grocery-lists/current/regenerate", headers=auth_headers)
    assert grocery.status_code == 200
    assert grocery.json()["items"][0]["normalized_name"] == "rice"


def test_manual_grocery_item_and_pantry_exclusion(
    client: TestClient, auth_headers: dict[str, str]
) -> None:
    pantry = client.post(
        "/api/v1/grocery-lists/pantry",
        headers=auth_headers,
        json={"normalized_name": "Salt", "category": "pantry"},
    )
    assert pantry.status_code == 200
    duplicate = client.post(
        "/api/v1/grocery-lists/pantry",
        headers=auth_headers,
        json={"normalized_name": "salt", "category": "pantry"},
    )
    assert duplicate.json()["id"] == pantry.json()["id"]

    recipe = client.post(
        "/api/v1/recipes",
        headers=auth_headers,
        json={
            "name": "Salted rice",
            "photo_url": "https://example.com/rice.jpg",
            "servings": 4,
            "ingredients": [{"original_text": "2 cups rice"}, {"original_text": "1 tsp salt"}],
            "instructions": [{"step_number": 1, "text": "Cook rice"}],
        },
    ).json()
    client.post(
        "/api/v1/recipes/swipes",
        headers=auth_headers,
        json={"recipe_id": recipe["id"], "action": "add", "session_id": "s1"},
    )
    grocery = client.post("/api/v1/grocery-lists/current/regenerate", headers=auth_headers).json()
    assert {item["normalized_name"] for item in grocery["items"]} == {"rice"}

    added = client.post(
        "/api/v1/grocery-lists/current/items",
        headers=auth_headers,
        json={"display_name": "Paper towels", "quantity": 1, "unit": "pack"},
    )
    assert added.status_code == 200
    current = client.get("/api/v1/grocery-lists/current", headers=auth_headers).json()
    manual = next(item for item in current["items"] if item["display_name"] == "Paper towels")
    assert manual["match_status"] == "manual"
    assert "walmart.com" in manual["walmart_search_url"]
    assert current["retailer_display_name"] == "Walmart"
    assert "walmart.com" in manual["retailer_search_url"]


def test_preferred_grocery_retailer_changes_search_links(
    client: TestClient, auth_headers: dict[str, str]
) -> None:
    profile = client.get("/api/v1/profile", headers=auth_headers).json()
    profile["preferred_grocery_retailer"] = "publix"
    updated_profile = client.put("/api/v1/profile", headers=auth_headers, json=profile)
    assert updated_profile.status_code == 200

    added = client.post(
        "/api/v1/grocery-lists/current/items",
        headers=auth_headers,
        json={"display_name": "Chicken breast", "quantity": 1, "unit": "lb"},
    )
    assert added.status_code == 200

    current = client.get("/api/v1/grocery-lists/current", headers=auth_headers).json()
    manual = next(item for item in current["items"] if item["display_name"] == "Chicken breast")
    assert current["retailer_display_name"] == "Publix"
    assert manual["retailer_display_name"] == "Publix"
    assert "publix.com/search/products" in manual["retailer_search_url"]
    assert "walmart.com" in manual["walmart_search_url"]


def test_grocery_item_update_is_account_scoped(
    client: TestClient, auth_headers: dict[str, str]
) -> None:
    added = client.post(
        "/api/v1/grocery-lists/current/items",
        headers=auth_headers,
        json={"display_name": "Foil", "quantity": 1, "unit": "roll"},
    )
    assert added.status_code == 200
    other = client.post(
        "/api/v1/auth/register",
        json={
            "email": "other-shopper@example.com",
            "password": "change-me-123",
            "terms_accepted": True,
            "privacy_accepted": True,
        },
    )
    other_headers = {"Authorization": f"Bearer {other.json()['access_token']}"}

    blocked_patch = client.patch(
        f"/api/v1/grocery-lists/items/{added.json()['id']}",
        headers=other_headers,
        json={"is_checked": True},
    )
    blocked_delete = client.delete(
        f"/api/v1/grocery-lists/items/{added.json()['id']}", headers=other_headers
    )

    assert blocked_patch.status_code == 404
    assert blocked_delete.status_code == 404
