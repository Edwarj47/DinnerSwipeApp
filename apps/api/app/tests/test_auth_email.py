from __future__ import annotations

from fastapi.testclient import TestClient
from pytest import MonkeyPatch
from sqlalchemy.orm import Session

from app.models.entities import User


def test_email_verification_flow(
    client: TestClient, db_session: Session, monkeypatch: MonkeyPatch
) -> None:
    from app.services import email_auth

    monkeypatch.setattr(email_auth, "_new_token", lambda: "verify-token-for-test-1234567890")
    register = client.post(
        "/api/v1/auth/register", json={"email": "verify@example.com", "password": "change-me-123"}
    )
    assert register.status_code == 200
    user = db_session.query(User).filter_by(email="verify@example.com").one()
    assert user.email_verified is False

    verified = client.post(
        "/api/v1/auth/verify-email", json={"token": "verify-token-for-test-1234567890"}
    )
    assert verified.status_code == 200
    db_session.refresh(user)
    assert user.email_verified is True


def test_password_reset_flow(
    client: TestClient, db_session: Session, monkeypatch: MonkeyPatch
) -> None:
    from app.services import email_auth

    client.post(
        "/api/v1/auth/register", json={"email": "reset@example.com", "password": "change-me-123"}
    )
    monkeypatch.setattr(email_auth, "_new_token", lambda: "reset-token-for-test-1234567890")
    requested = client.post(
        "/api/v1/auth/password-reset/request", json={"email": "reset@example.com"}
    )
    assert requested.status_code == 200
    confirmed = client.post(
        "/api/v1/auth/password-reset/confirm",
        json={"token": "reset-token-for-test-1234567890", "password": "new-password-123"},
    )
    assert confirmed.status_code == 200
    login = client.post(
        "/api/v1/auth/login", json={"email": "reset@example.com", "password": "new-password-123"}
    )
    assert login.status_code == 200
