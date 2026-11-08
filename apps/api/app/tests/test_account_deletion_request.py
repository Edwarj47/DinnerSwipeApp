from datetime import datetime
from types import SimpleNamespace
from typing import cast
from unittest.mock import Mock

import pytest
from fastapi.testclient import TestClient
from httpx import Response
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.config import settings
from app.models.entities import AuditEvent, User, UserSubscription

PASSWORD = "change-me-123"


def request(client: TestClient, headers: dict[str, str], password: str = PASSWORD) -> Response:
    return cast(
        Response,
        client.post(
            "/api/v1/auth/account/delete-request",
            headers=headers,
            json={"current_password": password, "confirmation": "DELETE"},
        ),
    )


def test_receipt_reuses_original_request_without_exposing_audit_payload(
    client: TestClient, db_session: Session, auth_headers: dict[str, str]
) -> None:
    before = client.get("/api/v1/auth/account/deletion-request", headers=auth_headers)
    assert before.json() == {"status": "not_requested", "requested_at": None}
    assert before.headers["cache-control"] == "no-store"
    first = request(client, auth_headers)
    assert first.status_code == 200
    assert first.json() == {"status": "deletion_requested"}
    assert first.headers["cache-control"] == "no-store"
    event = db_session.scalars(
        select(AuditEvent).where(AuditEvent.event_type == "account_deletion_requested")
    ).one()
    event.created_at = datetime(2026, 1, 2, 3, 4, 5)
    db_session.commit()
    again = request(client, auth_headers)
    assert again.json() == first.json()
    receipt = client.get("/api/v1/auth/account/deletion-request", headers=auth_headers)
    assert receipt.json() == {
        "status": "pending_manual_review",
        "requested_at": "2026-01-02T03:04:05Z",
    }
    assert (
        db_session.query(AuditEvent).filter_by(event_type="account_deletion_requested").count() == 1
    )
    assert request(client, auth_headers, "incorrect-password").status_code == 401
    assert db_session.query(User).filter_by(email="owner@example.com").one().is_active


def test_unpaid_unverified_accounts_can_request_and_read_only_their_own_receipt(
    client: TestClient, db_session: Session, auth_headers: dict[str, str]
) -> None:
    assert request(client, auth_headers).status_code == 200
    other = client.post(
        "/api/v1/auth/register",
        json={
            "email": "unpaid@example.com",
            "password": PASSWORD,
            "terms_accepted": True,
            "privacy_accepted": True,
        },
    )
    headers = {"Authorization": f"Bearer {other.json()['access_token']}"}
    assert client.get("/api/v1/auth/account/deletion-request", headers=headers).json() == {
        "status": "not_requested",
        "requested_at": None,
    }
    assert request(client, headers).status_code == 200
    user = db_session.scalar(select(User).where(User.email == "unpaid@example.com"))
    assert user and not user.email_verified
    assert not db_session.scalar(
        select(UserSubscription).where(UserSubscription.user_id == user.id)
    )
    assert client.get("/api/v1/auth/account/deletion-request").status_code == 401


def test_throttle_happens_before_password_check(
    client: TestClient, auth_headers: dict[str, str], monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr("app.core.rate_limit.time", SimpleNamespace(time=lambda: 120.1))
    for _ in range(5):
        assert request(client, auth_headers, "incorrect-password").status_code == 401
    verify = Mock(side_effect=AssertionError("Password checked after throttle"))
    monkeypatch.setattr("app.api.routes.auth.verify_password", verify)
    limited = request(client, auth_headers)
    assert limited.status_code == 429
    assert limited.headers["retry-after"]
    assert limited.json()["detail"]["code"] == "rate_limit"
    verify.assert_not_called()


def test_invalid_confirmation_never_creates_request(
    client: TestClient, db_session: Session, auth_headers: dict[str, str]
) -> None:
    response = client.post(
        "/api/v1/auth/account/delete-request",
        headers=auth_headers,
        json={"current_password": PASSWORD, "confirmation": "delete"},
    )
    assert response.status_code == 422
    assert not db_session.scalar(
        select(AuditEvent).where(AuditEvent.event_type == "account_deletion_requested")
    )


def test_stale_account_binding_cannot_read_or_submit_for_the_new_session(
    client: TestClient, db_session: Session, auth_headers: dict[str, str]
) -> None:
    original = db_session.scalar(select(User).where(User.email == "owner@example.com"))
    assert original
    other = client.post(
        "/api/v1/auth/register",
        json={
            "email": "other-session@example.com",
            "password": PASSWORD,
            "terms_accepted": True,
            "privacy_accepted": True,
        },
    )
    headers = {
        "Authorization": f"Bearer {other.json()['access_token']}",
        "X-Dinner-Account": original.id,
    }
    assert client.get("/api/v1/auth/account/deletion-request", headers=headers).status_code == 409
    assert request(client, headers).status_code == 409
    assert not db_session.scalar(
        select(AuditEvent).where(AuditEvent.event_type == "account_deletion_requested")
    )


def test_cookie_deletion_request_requires_csrf(
    client: TestClient, db_session: Session, auth_headers: dict[str, str]
) -> None:
    headers = {"X-Dinner-Web-Session": "cookie", "Origin": settings.allowed_origin_list[0]}
    login = client.post(
        "/api/v1/auth/login",
        headers=headers,
        json={"email": "owner@example.com", "password": PASSWORD},
    )
    assert login.status_code == 200
    assert request(client, headers).status_code == 403
    assert not db_session.scalar(
        select(AuditEvent).where(AuditEvent.event_type == "account_deletion_requested")
    )
    csrf = client.cookies.get("ds_csrf")
    assert csrf
    headers["X-CSRF-Token"] = csrf
    assert request(client, headers).status_code == 200
