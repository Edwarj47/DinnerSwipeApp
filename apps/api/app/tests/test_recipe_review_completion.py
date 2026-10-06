from collections.abc import Callable
from typing import Any

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models.entities import Recipe, UserProfile
from app.services.recipes import COMPLETED_FEEDBACK_KEY


def test_bulk_completion_is_private_atomic_and_preserves_feedback(
    client: TestClient,
    auth_headers: dict[str, str],
    db_session: Session,
    grant_basic_access: Callable[[str], object],
) -> None:
    stale_profile = client.get("/api/v1/profile", headers=auth_headers).json()
    recipes = [
        client.post("/api/v1/recipes", headers=auth_headers, json={"name": name}).json()
        for name in ("Soup", "Protein shake")
    ]
    ids = [recipe["id"] for recipe in recipes]
    path = "/api/v1/recipes/feedback-preferences"
    assert (
        client.put(
            path,
            headers=auth_headers,
            json={"recipe_ids": [ids[0], "unavailable"], "action": "complete"},
        ).status_code
        == 404
    )
    assert not client.get(f"/api/v1/recipes/{ids[0]}", headers=auth_headers).json()[
        "feedback_completed"
    ]
    completed = client.put(
        path, headers=auth_headers, json={"recipe_ids": [*ids, ids[0]], "action": "complete"}
    )
    assert completed.status_code == 200, completed.text
    assert len(completed.json()) == 2
    assert all(
        recipe["feedback_completed"] and not recipe["feedback_ignored"]
        for recipe in completed.json()
    )
    assert {recipe["id"]: recipe["validation_warnings"] for recipe in completed.json()} == {
        recipe["id"]: recipe["validation_warnings"] for recipe in recipes
    }
    assert all(not recipe["is_hidden"] and not recipe["is_archived"] for recipe in completed.json())
    stale_profile["notification_preferences"] = {"confirm_plan_reset": False}
    assert (
        client.put("/api/v1/profile", headers=auth_headers, json=stale_profile).status_code == 200
    )
    assert client.get(f"/api/v1/recipes/{ids[0]}", headers=auth_headers).json()[
        "feedback_completed"
    ]
    other = client.post(
        "/api/v1/auth/register",
        json={
            "email": "review-complete@example.com",
            "password": "change-me-123",
            "terms_accepted": True,
            "privacy_accepted": True,
        },
    ).json()
    grant_basic_access("review-complete@example.com")
    other_headers = {"Authorization": f"Bearer {other['access_token']}"}
    assert (
        client.put(
            path, headers=other_headers, json={"recipe_ids": ids, "action": "complete"}
        ).status_code
        == 404
    )
    owned = db_session.get(Recipe, ids[0])
    assert owned
    owned.owner_user_id = None
    db_session.commit()
    assert not client.get(f"/api/v1/recipes/{ids[0]}", headers=other_headers).json()[
        "feedback_completed"
    ]
    # Changes to warnings invalidate the acknowledgement, not the original warning data.
    owned.validation_warnings = [*owned.validation_warnings, "New quality warning"]
    db_session.commit()
    assert not client.get(f"/api/v1/recipes/{ids[0]}", headers=auth_headers).json()[
        "feedback_completed"
    ]
    ignored = client.put(
        path, headers=auth_headers, json={"recipe_ids": ids, "action": "ignore"}
    ).json()
    assert all(
        recipe["feedback_ignored"] and not recipe["feedback_completed"] for recipe in ignored
    )
    reopened = client.put(
        path, headers=auth_headers, json={"recipe_ids": ids, "action": "review"}
    ).json()
    assert all(
        not recipe["feedback_ignored"] and not recipe["feedback_completed"] for recipe in reopened
    )


@pytest.mark.parametrize(
    "payload",
    [
        {"recipe_ids": [], "action": "complete"},
        {"recipe_ids": ["missing"] * 101, "action": "complete"},
        {"recipe_ids": ["missing"], "action": "approve"},
    ],
)
def test_review_batch_validation(
    client: TestClient, auth_headers: dict[str, str], payload: dict[str, Any]
) -> None:
    assert (
        client.put(
            "/api/v1/recipes/feedback-preferences", headers=auth_headers, json=payload
        ).status_code
        == 422
    )


@pytest.mark.parametrize(
    "timing,total",
    [
        ({"prep_minutes": 10, "cook_minutes": 20, "total_minutes": 99}, 30),
        ({"prep_minutes": 0, "cook_minutes": 0}, 0),
        ({"prep_minutes": 5}, 5),
        ({"cook_minutes": 12}, 12),
        ({"total_minutes": 45}, 45),
        ({}, None),
    ],
)
def test_recipe_times_aggregate_on_create_and_edit(
    client: TestClient, auth_headers: dict[str, str], timing: dict[str, Any], total: int | None
) -> None:
    response = client.post(
        "/api/v1/recipes", headers=auth_headers, json={"name": "My meal", **timing}
    )
    assert response.status_code == 200, response.text
    assert response.json()["total_minutes"] == total
    edited = client.put(
        f"/api/v1/recipes/{response.json()['id']}",
        headers=auth_headers,
        json={"name": "My edited meal", **timing},
    )
    assert edited.status_code == 200, edited.text
    assert edited.json()["total_minutes"] == total


def test_timing_limits_and_legacy_read_aggregation(
    client: TestClient, auth_headers: dict[str, str], db_session: Session
) -> None:
    invalid = client.post(
        "/api/v1/recipes",
        headers=auth_headers,
        json={"name": "Too long", "prep_minutes": 1000, "cook_minutes": 1000},
    )
    assert invalid.status_code == 422
    saved = client.post(
        "/api/v1/recipes", headers=auth_headers, json={"name": "Legacy timing"}
    ).json()
    recipe = db_session.get(Recipe, saved["id"])
    assert recipe
    recipe.prep_minutes, recipe.cook_minutes, recipe.total_minutes = 5, 10, 99
    db_session.commit()
    assert (
        client.get(f"/api/v1/recipes/{recipe.id}", headers=auth_headers).json()["total_minutes"]
        == 15
    )
    unchanged = db_session.get(Recipe, recipe.id)
    assert unchanged is not None and unchanged.total_minutes == 99


def test_completion_limit_is_atomic_and_cannot_approve_unsafe_recipes(
    client: TestClient, auth_headers: dict[str, str], db_session: Session
) -> None:
    saved = client.post(
        "/api/v1/recipes", headers=auth_headers, json={"name": "Limit check"}
    ).json()
    recipe = db_session.get(Recipe, saved["id"])
    assert recipe
    profile = db_session.scalar(
        select(UserProfile).where(UserProfile.user_id == recipe.owner_user_id)
    )
    assert profile
    preferences = {
        "confirm_plan_reset": False,
        COMPLETED_FEEDBACK_KEY: {str(index): "old" for index in range(2000)},
    }
    profile.notification_preferences = preferences
    db_session.commit()
    response = client.put(
        "/api/v1/recipes/feedback-preferences",
        headers=auth_headers,
        json={"recipe_ids": [recipe.id], "action": "complete"},
    )
    assert response.status_code == 422
    db_session.refresh(profile)
    assert profile.notification_preferences == preferences
    recipe.validation_status = "requires_review"
    db_session.commit()
    assert (
        client.put(
            "/api/v1/recipes/feedback-preferences",
            headers=auth_headers,
            json={"recipe_ids": [recipe.id], "action": "complete"},
        ).status_code
        == 404
    )
    db_session.refresh(recipe)
    assert recipe.validation_status == "requires_review"
