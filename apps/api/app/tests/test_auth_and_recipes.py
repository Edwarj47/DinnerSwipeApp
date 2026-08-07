from __future__ import annotations

from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from app.models.entities import AuditEvent, RefreshToken


def test_register_requires_legal_acceptance(client: TestClient) -> None:
    response = client.post(
        "/api/v1/auth/register",
        json={"email": "no-consent@example.com", "password": "change-me-123"},
    )
    assert response.status_code == 422
    assert "Privacy Policy and Terms of Service" in response.json()["detail"]


def test_register_login_and_create_recipe(client: TestClient) -> None:
    register = client.post(
        "/api/v1/auth/register",
        json={
            "email": "cook@example.com",
            "password": "change-me-123",
            "terms_accepted": True,
            "privacy_accepted": True,
        },
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
        "/api/v1/auth/register",
        json={
            "email": "account@example.com",
            "password": "change-me-123",
            "terms_accepted": True,
            "privacy_accepted": True,
        },
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
    assert exported_json["account"]["terms_accepted_at"]
    assert exported_json["account"]["privacy_accepted_at"]
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


def test_refresh_token_rotates_and_logout_revokes(client: TestClient, db_session: Session) -> None:
    register = client.post(
        "/api/v1/auth/register",
        json={
            "email": "tokens@example.com",
            "password": "change-me-123",
            "terms_accepted": True,
            "privacy_accepted": True,
        },
    )
    assert register.status_code == 200
    first_refresh = register.json()["refresh_token"]
    assert db_session.query(RefreshToken).count() == 1

    refreshed = client.post("/api/v1/auth/refresh", json={"refresh_token": first_refresh})
    assert refreshed.status_code == 200
    second_refresh = refreshed.json()["refresh_token"]
    assert second_refresh != first_refresh
    rows = db_session.query(RefreshToken).order_by(RefreshToken.created_at).all()
    assert len(rows) == 2
    assert rows[0].revoked_at is not None
    assert rows[0].replaced_by_token_id == rows[1].id

    reused = client.post("/api/v1/auth/refresh", json={"refresh_token": first_refresh})
    assert reused.status_code == 401

    headers = {"Authorization": f"Bearer {refreshed.json()['access_token']}"}
    logout = client.post(
        "/api/v1/auth/logout", json={"refresh_token": second_refresh}, headers=headers
    )
    assert logout.status_code == 200
    revoked_row = db_session.get(RefreshToken, rows[1].id)
    assert revoked_row is not None
    assert revoked_row.revoked_at is not None
    after_logout = client.post("/api/v1/auth/refresh", json={"refresh_token": second_refresh})
    assert after_logout.status_code == 401
