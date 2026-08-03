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
