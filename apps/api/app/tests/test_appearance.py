from typing import Any

import pytest
from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from app.models.entities import User


def test_default_and_all_presets(client: TestClient, auth_headers: dict[str, str]) -> None:
    assert client.get("/api/v1/profile", headers=auth_headers).json()["appearance_preferences"] == {
        "accent": "red"
    }
    for accent in ("blue", "green", "teal", "purple", "orange", "red"):
        response = client.patch(
            "/api/v1/profile/appearance", headers=auth_headers, json={"accent": accent}
        )
        assert response.status_code == 200
        assert response.json()["appearance_preferences"] == {"accent": accent}
        assert client.get("/api/v1/profile", headers=auth_headers).json()[
            "appearance_preferences"
        ] == {"accent": accent}


@pytest.mark.parametrize(
    "payload",
    [
        {"accent": "#fff"},
        {"accent": "yellow"},
        {"accent": None},
        {},
        {"accent": "blue", "user_id": "other"},
    ],
)
def test_invalid_preferences_are_rejected(
    client: TestClient, auth_headers: dict[str, str], payload: dict[str, Any]
) -> None:
    assert (
        client.patch("/api/v1/profile/appearance", headers=auth_headers, json=payload).status_code
        == 422
    )
    assert client.get("/api/v1/profile", headers=auth_headers).json()["appearance_preferences"] == {
        "accent": "red"
    }


def test_auth_and_legacy_save_cannot_replace_appearance(
    client: TestClient, auth_headers: dict[str, str]
) -> None:
    assert client.patch("/api/v1/profile/appearance", json={"accent": "blue"}).status_code == 401
    client.patch("/api/v1/profile/appearance", headers=auth_headers, json={"accent": "teal"})
    response = client.put(
        "/api/v1/profile",
        headers=auth_headers,
        json={
            "household_size": 3,
            "notification_preferences": {
                "appearance_preferences": {"accent": "purple"},
                "confirm_plan_reset": False,
            },
        },
    )
    assert response.status_code == 200
    assert response.json()["appearance_preferences"] == {"accent": "teal"}
    assert response.json()["notification_preferences"]["confirm_plan_reset"] is False
    assert client.put("/api/v1/profile", headers=auth_headers, json={"household_size": 4}).json()[
        "appearance_preferences"
    ] == {"accent": "teal"}


def test_appearance_preserves_settings_and_isolates_accounts(
    client: TestClient, auth_headers: dict[str, str], db_session: Session
) -> None:
    user = db_session.query(User).filter_by(email="owner@example.com").one()
    original = {
        "experience_preferences": {"mode": "workouts", "weight_unit": "lb"},
        "confirm_plan_reset": False,
        "default_group_id": "example",
    }
    user.profile.notification_preferences = original
    db_session.commit()
    client.patch("/api/v1/profile/appearance", headers=auth_headers, json={"accent": "green"})
    actual = client.get("/api/v1/profile", headers=auth_headers).json()["notification_preferences"]
    assert actual == {**original, "appearance_preferences": {"accent": "green"}}
    result = client.post(
        "/api/v1/auth/register",
        json={
            "email": "second@example.com",
            "password": "another-password-123",
            "terms_accepted": True,
            "privacy_accepted": True,
        },
    )
    second = {"Authorization": f"Bearer {result.json()['access_token']}"}
    assert client.get("/api/v1/profile", headers=second).json()["appearance_preferences"] == {
        "accent": "red"
    }


def test_invalid_stored_value_falls_back(
    client: TestClient, auth_headers: dict[str, str], db_session: Session
) -> None:
    user = db_session.query(User).filter_by(email="owner@example.com").one()
    user.profile.notification_preferences = {"appearance_preferences": ["invalid"]}
    db_session.commit()
    assert client.get("/api/v1/profile", headers=auth_headers).json()["appearance_preferences"] == {
        "accent": "red"
    }
