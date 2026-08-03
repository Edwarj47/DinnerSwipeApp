from __future__ import annotations

from fastapi.testclient import TestClient


def test_register_login_and_create_recipe(client: TestClient) -> None:
    register = client.post(
        "/api/v1/auth/register", json={"email": "cook@example.com", "password": "change-me-123"}
    )
    assert register.status_code == 200
    headers = {"Authorization": f"Bearer {register.json()['access_token']}"}
    payload = {
        "name": "Test tacos",
        "photo_url": "https://example.com/tacos.jpg",
        "servings": 4,
        "ingredients": [{"original_text": "1 lb ground beef"}],
        "instructions": [{"step_number": 1, "text": "Cook beef"}],
        "tags": ["quick"],
    }
    created = client.post("/api/v1/recipes", json=payload, headers=headers)
    assert created.status_code == 200
    assert created.json()["name"] == "Test tacos"
    listed = client.get("/api/v1/recipes", headers=headers)
    assert len(listed.json()) == 1
