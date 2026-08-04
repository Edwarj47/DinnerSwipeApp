from __future__ import annotations

from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from app.models.entities import AuditEvent


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


def test_change_password_export_and_delete_request(client: TestClient, db_session: Session) -> None:
    register = client.post(
        "/api/v1/auth/register", json={"email": "account@example.com", "password": "change-me-123"}
    )
    headers = {"Authorization": f"Bearer {register.json()['access_token']}"}

    changed = client.post(
        "/api/v1/auth/password/change",
        json={"current_password": "change-me-123", "new_password": "new-password-123"},
        headers=headers,
    )
    assert changed.status_code == 200
    assert changed.json()["status"] == "password_changed"

    old_login = client.post(
        "/api/v1/auth/login", json={"email": "account@example.com", "password": "change-me-123"}
    )
    assert old_login.status_code == 401
    new_login = client.post(
        "/api/v1/auth/login", json={"email": "account@example.com", "password": "new-password-123"}
    )
    assert new_login.status_code == 200
    headers = {"Authorization": f"Bearer {new_login.json()['access_token']}"}

    exported = client.get("/api/v1/auth/account/export", headers=headers)
    assert exported.status_code == 200
    exported_json = exported.json()
    assert exported_json["account"]["email"] == "account@example.com"
    assert "password_hash" not in str(exported_json)

    deletion = client.post(
        "/api/v1/auth/account/delete-request",
        json={"current_password": "new-password-123", "confirmation": "DELETE"},
        headers=headers,
    )
    assert deletion.status_code == 200
    assert deletion.json()["status"] == "deletion_requested"
    event = db_session.query(AuditEvent).filter_by(event_type="account_deletion_requested").one()
    assert event.payload["status"] == "pending_manual_review"


def test_login_rate_limit(client: TestClient) -> None:
    for _ in range(8):
        response = client.post(
            "/api/v1/auth/login",
            json={"email": "limited@example.com", "password": "wrong-password"},
        )
        assert response.status_code == 401
    blocked = client.post(
        "/api/v1/auth/login", json={"email": "limited@example.com", "password": "wrong-password"}
    )
    assert blocked.status_code == 429
