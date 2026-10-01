from datetime import datetime
from typing import Any
from unittest.mock import Mock

import pytest
import stripe
from fastapi import HTTPException
from sqlalchemy.orm import Session

from app.core.config import settings
from app.models.entities import AuditEvent, User, UserSubscription
from app.services import billing


@pytest.fixture
def account(auth_headers: dict[str, str], db_session: Session) -> User:
    user = db_session.query(User).one()
    subscription = db_session.query(UserSubscription).one()
    subscription.status = "inactive"
    db_session.commit()
    return user


@pytest.fixture
def provider(monkeypatch: pytest.MonkeyPatch, account: User) -> Mock:
    client = Mock()
    monkeypatch.setattr(billing, "_configured_stripe_client", lambda *args: client)
    monkeypatch.setattr(settings, "stripe_basic_price_id", "price_basic_fixture")
    monkeypatch.setattr(settings, "stripe_premium_price_id", "price_premium_fixture")
    client.v1.subscriptions.retrieve.return_value = {
        "id": "sub_fixture",
        "customer": "cus_fixture",
        "status": "active",
        "metadata": {"user_id": account.id, "tier": "basic"},
        "items": {
            "data": [{"price": {"id": "price_premium_fixture"}, "current_period_end": 1900000000}]
        },
    }
    client.v1.checkout.sessions.create.return_value = stripe.StripeObject.construct_from(
        {"id": "cs_fixture", "url": "https://checkout.stripe.test/fixture", "status": "open"}, None
    )
    client.v1.checkout.sessions.retrieve.return_value = (
        client.v1.checkout.sessions.create.return_value
    )
    return client


def event(
    account: User, kind: str = "customer.subscription.updated", event_id: str = "evt_fixture"
) -> dict[str, Any]:
    return {
        "id": event_id,
        "type": kind,
        "data": {
            "object": {
                "id": "sub_fixture",
                "metadata": {"user_id": account.id},
                "status": "canceled",
            }
        },
    }


def test_price_wins_over_stale_metadata_and_event_snapshot(
    db_session: Session, account: User, provider: Mock
) -> None:
    assert billing.handle_stripe_event(db_session, event(account))["status"] == "processed"
    sub = billing.subscription_for_user(db_session, account)
    assert sub is not None
    assert sub.status == "active"
    assert sub.plan_key == billing.PREMIUM_PLAN_KEY
    assert sub.current_period_end == datetime.utcfromtimestamp(1900000000)
    assert billing.handle_stripe_event(db_session, event(account))["status"] == "duplicate"
    assert provider.v1.subscriptions.retrieve.call_count == 1
    assert db_session.query(UserSubscription).count() == 1
    assert db_session.query(AuditEvent).filter_by(event_type="stripe_event_processed").count() == 1


@pytest.mark.parametrize("payment_status", ["unpaid", "paid", "no_payment_required"])
def test_checkout_requires_confirmed_payment(
    db_session: Session, account: User, provider: Mock, payment_status: str
) -> None:
    payload = event(account, "checkout.session.completed")
    payload["data"]["object"].update(
        mode="subscription", payment_status=payment_status, subscription="sub_fixture"
    )
    result = billing.handle_stripe_event(db_session, payload)
    assert result["status"] == ("ignored" if payment_status == "unpaid" else "processed")
    assert billing.is_basic_access_active(db_session, account) == (payment_status != "unpaid")


def test_late_event_reads_current_status_and_invoice_failure_revokes(
    db_session: Session, account: User, provider: Mock
) -> None:
    billing.handle_stripe_event(db_session, event(account))
    provider.v1.subscriptions.retrieve.return_value["status"] = "past_due"
    payload = event(account, "invoice.payment_failed", "evt_failed")
    payload["data"]["object"]["parent"] = {"subscription_details": {"subscription": "sub_fixture"}}
    assert billing.handle_stripe_event(db_session, payload)["status"] == "processed"
    assert not billing.is_basic_access_active(db_session, account)
    billing.handle_stripe_event(db_session, event(account, event_id="evt_late_active"))
    assert not billing.is_basic_access_active(db_session, account)


def test_provider_failure_requests_retry_without_audit_ack(
    db_session: Session, account: User, provider: Mock
) -> None:
    provider.v1.subscriptions.retrieve.side_effect = RuntimeError("unavailable")
    with pytest.raises(HTTPException) as error:
        billing.handle_stripe_event(db_session, event(account))
    assert error.value.status_code == 503
    assert not db_session.query(AuditEvent).filter_by(event_type="stripe_event_processed").count()


def test_canceled_old_subscription_does_not_erase_coupon_access(
    db_session: Session, account: User, provider: Mock
) -> None:
    sub = billing.subscription_for_user(db_session, account)
    assert sub is not None
    sub.status = "active"
    sub.source = "waiver_code"
    sub.stripe_subscription_id = "sub_fixture"
    db_session.commit()
    provider.v1.subscriptions.retrieve.return_value["status"] = "canceled"
    assert billing.handle_stripe_event(db_session, event(account))["status"] == "ignored"
    assert billing.is_basic_access_active(db_session, account)


@pytest.mark.parametrize("wrong_field", ["price", "user", "customer"])
def test_unrelated_subscription_cannot_grant_access(
    db_session: Session, account: User, provider: Mock, wrong_field: str
) -> None:
    current = provider.v1.subscriptions.retrieve.return_value
    if wrong_field == "price":
        current["items"]["data"][0]["price"]["id"] = "price_unrelated"
    elif wrong_field == "user":
        current["metadata"]["user_id"] = "other_user"
    else:
        sub = billing.subscription_for_user(db_session, account)
        assert sub is not None
        sub.stripe_customer_id = "cus_other"
        db_session.commit()
    assert billing.handle_stripe_event(db_session, event(account))["status"] == "ignored"
    assert not billing.is_basic_access_active(db_session, account)


def test_checkout_reuses_session_and_returning_account_has_no_trial(
    db_session: Session, account: User, provider: Mock
) -> None:
    sub = billing.subscription_for_user(db_session, account)
    assert sub is not None
    sub.stripe_subscription_id = "sub_previous"
    sub.status = "canceled"
    sub.source = "stripe"
    db_session.commit()
    url = billing.create_checkout_session(db_session, account, "basic")
    assert billing.create_checkout_session(db_session, account, "basic") == url
    assert provider.v1.checkout.sessions.create.call_count == 1
    params = provider.v1.checkout.sessions.create.call_args.args[0]
    assert "trial_period_days" not in params["subscription_data"]
    assert not billing.serialize_subscription_status(db_session, account)["basic_trial_eligible"]


def test_checkout_network_retry_reuses_idempotency_key(
    db_session: Session, account: User, provider: Mock
) -> None:
    session = provider.v1.checkout.sessions.create.return_value
    provider.v1.checkout.sessions.create.side_effect = [RuntimeError("timeout"), session]
    with pytest.raises(HTTPException):
        billing.create_checkout_session(db_session, account, "basic")
    billing.create_checkout_session(db_session, account, "basic")
    calls = provider.v1.checkout.sessions.create.call_args_list
    assert calls[0].kwargs == calls[1].kwargs
    assert calls[0].args == calls[1].args


def test_signed_event_must_match_live_mode(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(settings, "stripe_enabled", True)
    monkeypatch.setattr(settings, "stripe_secret_key", "sk_live_fixture_not_a_real_key")
    monkeypatch.setattr(settings, "stripe_webhook_secret", "fixture_secret")
    monkeypatch.setattr(settings, "stripe_premium_price_id", "price_fixture")
    sdk = Mock()
    sdk.Webhook.construct_event.return_value = {"livemode": False}
    monkeypatch.setattr(billing, "stripe_client", sdk)
    with pytest.raises(HTTPException) as error:
        billing.verify_stripe_event(b"{}", "fixture_signature")
    assert error.value.status_code == 400
    sdk.Webhook.construct_event.return_value = {"livemode": True}
    assert billing.verify_stripe_event(b"{}", "fixture_signature") == {"livemode": True}
