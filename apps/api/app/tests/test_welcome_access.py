from datetime import datetime, timedelta
from unittest.mock import Mock

import pytest
from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from app.core.config import settings
from app.models.entities import AuditEvent, ComplimentaryPremiumAccess, User, UserSubscription
from app.services import billing, welcome_access


def new_account(client: TestClient, db: Session) -> tuple[User, dict[str, str]]:
    response = client.post(
        "/api/v1/auth/register",
        json={
            "email": "welcome@example.com",
            "password": "welcome-test-password-123",
            "terms_accepted": True,
            "privacy_accepted": True,
        },
    )
    assert response.status_code == 200
    user = db.query(User).filter_by(email="welcome@example.com").one()
    return user, {"Authorization": "Bearer " + response.json()["access_token"]}


def verified(user: User, db: Session) -> None:
    user.email_verified = True
    user.email_verified_at = datetime.utcnow()
    db.commit()


def test_registration_is_eligible_but_never_starts_or_bills(
    client: TestClient, db_session: Session
) -> None:
    user, headers = new_account(client, db_session)
    status = client.get("/api/v1/subscription/status", headers=headers).json()
    assert status["welcome_eligible"] and status["welcome_requires_verification"]
    assert not status["premium_active"] and not status["basic_trial_eligible"]
    grant = db_session.get(ComplimentaryPremiumAccess, user.id)
    assert grant is not None and grant.started_at is None
    assert db_session.query(UserSubscription).count() == 0
    assert client.post("/api/v1/subscription/welcome/start", headers=headers).status_code == 403


def test_verified_start_is_idempotent_and_unlocks_all_tiers_without_subscription(
    client: TestClient, db_session: Session
) -> None:
    user, headers = new_account(client, db_session)
    verified(user, db_session)
    before = datetime.utcnow()
    response = client.post("/api/v1/subscription/welcome/start", headers=headers)
    assert response.status_code == 200
    assert response.headers["cache-control"] == "no-store"
    body = response.json()
    assert body["welcome_active"] and body["premium_active"] and body["basic_active"]
    assert body["source"] == "complimentary" and body["welcome_days_remaining"] == 30
    assert body["welcome_no_card"] and not body["billing_management_available"]
    grant = db_session.get(ComplimentaryPremiumAccess, user.id)
    assert grant is not None and grant.started_at is not None and grant.ends_at is not None
    assert grant.started_at >= before
    assert grant.ends_at - grant.started_at == timedelta(days=30)
    first = body["welcome_ends_at"]
    for _ in range(2):
        assert (
            client.post("/api/v1/subscription/welcome/start", headers=headers).json()[
                "welcome_ends_at"
            ]
            == first
        )
    assert db_session.query(UserSubscription).count() == 0
    assert (
        db_session.query(AuditEvent).filter_by(event_type="complimentary_premium_started").count()
        == 1
    )
    assert (
        client.post(
            "/api/v1/macros/entries",
            headers=headers,
            json={
                "entry_name": "Welcome meal",
                "status": "ate",
                "servings_consumed": 1,
                "calories": 400,
                "protein_g": 30,
            },
        ).status_code
        == 200
    )
    assert client.get("/api/v1/macros/summary", headers=headers).json()["active"]
    assert client.get("/api/v1/recipes", headers=headers).status_code == 200


def test_expiry_does_not_restart_delete_data_or_issue_payment(
    client: TestClient, db_session: Session, monkeypatch: pytest.MonkeyPatch
) -> None:
    user, headers = new_account(client, db_session)
    verified(user, db_session)
    client.post("/api/v1/subscription/welcome/start", headers=headers)
    grant = db_session.get(ComplimentaryPremiumAccess, user.id)
    assert grant is not None
    grant.started_at = datetime.utcnow() - timedelta(days=31)
    grant.ends_at = grant.started_at + timedelta(days=30)
    db_session.commit()
    old_end = grant.ends_at
    provider = Mock()
    monkeypatch.setattr(billing, "_configured_stripe_client", provider)
    body = client.post("/api/v1/subscription/welcome/start", headers=headers).json()
    assert not body["welcome_active"] and not body["welcome_eligible"]
    assert not body["premium_active"] and body["basic_active"]
    assert body["welcome_days_remaining"] == 0
    assert grant.ends_at == old_end
    assert client.get("/api/v1/recipes", headers=headers).status_code == 200
    assert (
        client.put(
            "/api/v1/macros/targets", headers=headers, json={"daily_calories": 2100}
        ).status_code
        == 402
    )
    assert client.get("/api/v1/auth/account/export", headers=headers).status_code == 200
    assert user.is_active
    assert db_session.query(UserSubscription).count() == 0
    provider.assert_not_called()


@pytest.mark.parametrize("tier", ["basic_monthly", "premium_macros_monthly"])
def test_existing_paid_terms_are_not_replaced_or_granted_another_trial(
    client: TestClient, db_session: Session, tier: str
) -> None:
    user, headers = new_account(client, db_session)
    verified(user, db_session)
    subscription = UserSubscription(
        user_id=user.id,
        source="stripe",
        status="active",
        plan_key=tier,
        stripe_subscription_id="sub_existing",
        current_period_end=datetime.utcnow() + timedelta(days=12),
        metadata_json={"trial_used": True},
    )
    db_session.add(subscription)
    db_session.commit()
    original = subscription.current_period_end
    assert client.post("/api/v1/subscription/welcome/start", headers=headers).status_code == 409
    status = client.get("/api/v1/subscription/status", headers=headers).json()
    assert not status["welcome_eligible"] and not status["welcome_active"]
    assert status["basic_active"] and status["premium_active"] == (tier != "basic_monthly")
    db_session.refresh(subscription)
    assert subscription.source == "stripe" and subscription.stripe_subscription_id == "sub_existing"
    assert subscription.current_period_end == original


def test_offline_access_is_bounded_by_welcome_expiry(
    client: TestClient, db_session: Session
) -> None:
    user, headers = new_account(client, db_session)
    verified(user, db_session)
    client.post("/api/v1/subscription/welcome/start", headers=headers)
    grant = db_session.get(ComplimentaryPremiumAccess, user.id)
    assert grant is not None
    grant.ends_at = datetime.utcnow() + timedelta(minutes=5)
    db_session.commit()
    body = client.get("/api/v1/subscription/status", headers=headers).json()
    assert body["offline_until"] == body["welcome_ends_at"]


def test_new_signup_offer_can_be_disabled_without_revoking_started_access(
    client: TestClient, db_session: Session, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(settings, "complimentary_premium_enabled", False)
    user, headers = new_account(client, db_session)
    verified(user, db_session)
    assert db_session.get(ComplimentaryPremiumAccess, user.id) is None
    assert client.post("/api/v1/subscription/welcome/start", headers=headers).status_code == 409


def test_welcome_start_is_account_bound(client: TestClient, db_session: Session) -> None:
    user, headers = new_account(client, db_session)
    verified(user, db_session)
    headers["X-Dinner-Account"] = "somebody-else"
    assert client.post("/api/v1/subscription/welcome/start", headers=headers).status_code == 409
    grant = db_session.get(ComplimentaryPremiumAccess, user.id)
    assert grant is not None and grant.started_at is None


@pytest.mark.parametrize("started", [False, True])
def test_pending_or_active_welcome_never_creates_checkout(
    client: TestClient, db_session: Session, monkeypatch: pytest.MonkeyPatch, started: bool
) -> None:
    user, headers = new_account(client, db_session)
    verified(user, db_session)
    if started:
        assert client.post("/api/v1/subscription/welcome/start", headers=headers).status_code == 200
    provider = Mock()
    monkeypatch.setattr(billing, "_configured_stripe_client", provider)
    for tier in ("basic", "premium"):
        with pytest.raises(Exception) as error:
            billing.create_checkout_session(db_session, user, tier)
        assert getattr(error.value, "status_code", None) == 409
    provider.assert_not_called()
    assert db_session.query(UserSubscription).count() == 0


@pytest.mark.parametrize("pending_key", ["pending_checkout", "checkout_attempt"])
def test_unresolved_checkout_cannot_overlap_welcome(
    client: TestClient, db_session: Session, pending_key: str
) -> None:
    user, headers = new_account(client, db_session)
    verified(user, db_session)
    db_session.add(
        UserSubscription(
            user_id=user.id, status="inactive", metadata_json={pending_key: {"id": "pending"}}
        )
    )
    db_session.commit()
    assert client.post("/api/v1/subscription/welcome/start", headers=headers).status_code == 409
    grant = db_session.get(ComplimentaryPremiumAccess, user.id)
    assert grant is not None and grant.started_at is None


def test_expired_welcome_checkout_has_no_second_basic_trial(
    client: TestClient, db_session: Session, monkeypatch: pytest.MonkeyPatch
) -> None:
    user, headers = new_account(client, db_session)
    verified(user, db_session)
    client.post("/api/v1/subscription/welcome/start", headers=headers)
    grant = db_session.get(ComplimentaryPremiumAccess, user.id)
    assert grant is not None
    grant.started_at = datetime.utcnow() - timedelta(days=31)
    grant.ends_at = grant.started_at + timedelta(days=30)
    db_session.commit()
    provider = Mock()
    provider.v1.checkout.sessions.create.return_value = {
        "id": "checkout",
        "url": "https://checkout.stripe.com/test",
    }
    monkeypatch.setattr(billing, "_configured_stripe_client", lambda *_: provider)
    billing.create_checkout_session(db_session, user, "premium")
    params = provider.v1.checkout.sessions.create.call_args.args[0]
    assert "trial_period_days" not in params["subscription_data"]
    assert "payment_method_collection" not in params


def test_welcome_end_is_exclusive_and_unverified_access_is_never_active(
    client: TestClient, db_session: Session
) -> None:
    user, headers = new_account(client, db_session)
    verified(user, db_session)
    client.post("/api/v1/subscription/welcome/start", headers=headers)
    grant = db_session.get(ComplimentaryPremiumAccess, user.id)
    assert grant is not None and grant.started_at is not None and grant.ends_at is not None
    assert welcome_access.welcome_active(user, grant, grant.started_at)
    assert welcome_access.welcome_active(user, grant, grant.ends_at - timedelta(microseconds=1))
    assert not welcome_access.welcome_active(user, grant, grant.ends_at)
    user.email_verified = False
    assert not welcome_access.welcome_active(user, grant, grant.started_at)
