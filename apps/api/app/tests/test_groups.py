from __future__ import annotations

from fastapi.testclient import TestClient


def test_household_invite_and_vote(client: TestClient, auth_headers: dict[str, str]) -> None:
    household = client.get("/api/v1/households/current", headers=auth_headers)
    assert household.status_code == 200
    assert len(household.json()["invite_code"]) == 8

    recipe = client.post(
        "/api/v1/recipes",
        headers=auth_headers,
        json={
            "name": "Group vote dinner",
            "photo_url": "https://example.com/group.jpg",
            "servings": 4,
            "ingredients": [{"original_text": "1 lb chicken"}],
            "instructions": [{"step_number": 1, "text": "Cook chicken"}],
        },
    ).json()
    vote = client.post(
        "/api/v1/households/current/votes",
        headers=auth_headers,
        json={"recipe_id": recipe["id"], "vote": "yes"},
    )
    assert vote.status_code == 200
    assert vote.json()["votes"][0]["yes"] == 1
