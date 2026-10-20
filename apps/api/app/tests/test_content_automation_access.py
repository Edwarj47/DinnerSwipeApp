from __future__ import annotations

import asyncio
from datetime import UTC, date, datetime
from uuid import UUID, uuid4

import pytest
from fastapi.testclient import TestClient
from pydantic import ValidationError
from sqlalchemy import select
from sqlalchemy.orm import Session, sessionmaker

from app.core.config import Settings, settings
from app.models.content_automation import ContentDailyBatch
from app.models.entities import User
from app.services import content_automation, content_discovery
from app.services.billing import BASIC_PLAN_KEY, PREMIUM_PLAN_KEY
from app.services.content_automation_access import enabled_for
from app.workers import content_daily

ROOT = "/api/v1/content-automation"
NOW = datetime(2026, 10, 20, 12, tzinfo=UTC)


@pytest.mark.parametrize("configured", [None, UUID("00000000-0000-0000-0000-000000000001")])
def test_feature_is_hidden_and_denied_without_matching_server_account(
    client: TestClient,
    auth_headers: dict[str, str],
    monkeypatch: pytest.MonkeyPatch,
    configured: UUID | None,
) -> None:
    monkeypatch.setattr(settings, "content_automation_owner_user_id", configured)
    status = client.get("/api/v1/auth/status", headers=auth_headers)
    assert status.status_code == 200 and status.headers["cache-control"] == "no-store"
    assert status.json()["content_automation_enabled"] is False
    identifier = str(uuid4())
    calls = [
        ("GET", ROOT, None),
        ("GET", f"{ROOT}/sources", None),
        ("GET", f"{ROOT}/batches/{identifier}", None),
        ("PATCH", f"{ROOT}/campaign", {"paused": True}),
        (
            "POST",
            f"{ROOT}/batches/{identifier}/decisions",
            {"action": "approve", "candidate_ids": [identifier]},
        ),
        ("POST", f"{ROOT}/sources/{identifier}/dismiss", {"source_ids": ["a" * 64]}),
    ]
    for method, path, body in calls:
        response = client.request(method, path, headers=auth_headers, json=body)
        assert response.status_code == 404
        assert response.json() == {"detail": "Not found"}
        assert response.headers["cache-control"] == "no-store"


@pytest.mark.parametrize("other_plan", [BASIC_PLAN_KEY, PREMIUM_PLAN_KEY])
def test_configured_owner_only_and_profile_cannot_enable_another_account(
    client: TestClient,
    auth_headers: dict[str, str],
    db_session: Session,
    monkeypatch: pytest.MonkeyPatch,
    other_plan: str,
) -> None:
    owner = db_session.scalar(select(User).where(User.email == "owner@example.com"))
    assert owner
    monkeypatch.setattr(settings, "content_automation_owner_user_id", UUID(owner.id))
    assert enabled_for(owner.id)
    assert client.get("/api/v1/auth/status", headers=auth_headers).json()[
        "content_automation_enabled"
    ]
    assert client.get(ROOT, headers=auth_headers).status_code == 200
    response = client.post(
        "/api/v1/auth/register",
        json={
            "email": "not-pilot@example.com",
            "password": "test-account-password-123",
            "terms_accepted": True,
            "privacy_accepted": True,
        },
    )
    assert response.status_code == 200
    other = db_session.scalar(select(User).where(User.email == "not-pilot@example.com"))
    assert other
    other.email_verified = True
    db_session.commit()
    # Create a historical campaign too: enrollment alone cannot grant pilot access.
    content_automation.create_campaign(db_session, other.id, date(2026, 10, 20))
    db_session.commit()
    headers = {"Authorization": "Bearer " + response.json()["access_token"]}
    assert not enabled_for(other.id)
    assert (
        client.get("/api/v1/auth/status", headers=headers).json()["content_automation_enabled"]
        is False
    )
    # Neither Basic nor Premium access can grant this private pilot.
    from app.models.entities import UserSubscription

    db_session.add(
        UserSubscription(
            user_id=other.id,
            plan_key=other_plan,
            status="active",
            source="waiver_code",
            metadata_json={"fixture": True},
        )
    )
    db_session.commit()
    assert client.get(ROOT, headers=headers).status_code == 404
    client.patch(
        "/api/v1/profile",
        headers=headers,
        json={
            "display_name": owner.email,
            "content_automation_enabled": True,
            "content_automation_owner_user_id": owner.id,
        },
    )
    assert client.get(ROOT, headers=headers).status_code == 404
    owner.email_verified = False
    db_session.commit()
    assert (
        client.get("/api/v1/auth/status", headers=auth_headers).json()["content_automation_enabled"]
        is False
    )
    assert client.get(ROOT, headers=auth_headers).status_code == 403


def test_unconfigured_campaign_cannot_collect_or_discover(
    db_session: Session,
    auth_headers: dict[str, str],
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    owner = db_session.scalar(select(User).where(User.email == "owner@example.com"))
    assert owner
    campaign = content_automation.create_campaign(db_session, owner.id, NOW.date())
    db_session.commit()
    monkeypatch.setattr(settings, "content_automation_owner_user_id", None)
    monkeypatch.setattr(content_daily, "SessionLocal", sessionmaker(bind=db_session.get_bind()))
    monkeypatch.setattr(content_daily, "utcnow", lambda: NOW)
    assert asyncio.run(content_daily.prepare_campaign(campaign.id)) == {"status": "not_enabled"}
    assert content_discovery.begin(db_session, campaign.id, NOW) is None
    assert not db_session.scalars(select(ContentDailyBatch)).all()


def test_config_requires_one_uuid_not_a_public_or_email_allowlist() -> None:
    for value in ("*", "owner@example.com", "true", f"{uuid4()},{uuid4()}"):
        with pytest.raises(ValidationError):
            Settings(_env_file=None, content_automation_owner_user_id=value)
