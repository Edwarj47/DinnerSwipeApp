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
        "/api/v1/auth/register",
        json={
            "email": "verify@example.com",
            "password": "change-me-123",
            "terms_accepted": True,
            "privacy_accepted": True,
        },
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


def test_verification_email_uses_hosted_logo(
    client: TestClient, monkeypatch: MonkeyPatch
) -> None:
    from app.services import email_auth

    sent: dict[str, str] = {}

    def capture_email(to_email: str, subject: str, html: str, text: str) -> bool:
        sent["to"] = to_email
        sent["subject"] = subject
        sent["html"] = html
        sent["text"] = text
        return True

    monkeypatch.setattr(email_auth, "_new_token", lambda: "verify-token-for-test-1234567890")
    monkeypatch.setattr(email_auth, "_send_html_email", capture_email)
    response = client.post(
        "/api/v1/auth/register",
        json={
            "email": "logo@example.com",
            "password": "change-me-123",
            "terms_accepted": True,
            "privacy_accepted": True,
        },
    )

    assert response.status_code == 200
    assert sent["to"] == "logo@example.com"
    assert "/api/v1/brand/logo.png" in sent["html"]
    assert "alt=\"Dinner Swipe\"" in sent["html"]
    assert "Verify your Dinner Swipe email" in sent["text"]


def test_brand_logo_route(client: TestClient) -> None:
    response = client.get("/api/v1/brand/logo.png")

    assert response.status_code == 200
    assert response.headers["content-type"] == "image/png"
    assert response.content.startswith(b"\x89PNG\r\n\x1a\n")


def test_password_reset_flow(
    client: TestClient, db_session: Session, monkeypatch: MonkeyPatch
) -> None:
    from app.services import email_auth

    client.post(
        "/api/v1/auth/register",
        json={
            "email": "reset@example.com",
            "password": "change-me-123",
            "terms_accepted": True,
            "privacy_accepted": True,
        },
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
