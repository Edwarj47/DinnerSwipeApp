from datetime import datetime, timedelta
from types import SimpleNamespace
from typing import Any, cast
from unittest.mock import Mock

import pytest
import stripe
from fastapi.testclient import TestClient
from httpx import Response
from sqlalchemy.orm import Session

from app.core.config import AccessCoupon, settings
from app.models.entities import UserSubscription
from app.services import billing, coupons


def apply(
    client: TestClient, headers: dict[str, str], code: str = "fixture-promo", **extra: Any
) -> Response:
    return cast(
        Response,
        client.post(
            "/api/v1/subscription/coupon-code", headers=headers, json={"code": code, **extra}
        ),
    )


def test_legacy_access_code_is_still_redeemable(
    client: TestClient, auth_headers: dict[str, str], monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(settings, "premium_waiver_codes", "fixture-premium")
    response = apply(client, auth_headers, "fixture-premium")
    assert response.status_code == 200
    assert response.json()["subscription"]["premium_active"]
    assert response.json()["checkout_url"] is None


def test_limited_coupon_expires_and_cannot_extend_by_replaying(
    client: TestClient,
    auth_headers: dict[str, str],
    db_session: Session,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    sub = db_session.query(UserSubscription).one()
    sub.status = "inactive"
    db_session.commit()
    code_hash = billing.waiver_code_hash("fixture-month")
    monkeypatch.setattr(
        settings, "access_coupon_grants", {code_hash: AccessCoupon(tier="premium", months=1)}
    )
    response = apply(client, auth_headers, "fixture-month")
    assert response.status_code == 200, response.text
    assert response.json()["subscription"]["premium_active"]
    end = sub.current_period_end
    assert end is not None
    assert 27 <= (end - datetime.utcnow()).days <= 31
    assert apply(client, auth_headers, "fixture-month").status_code == 409
    assert sub.current_period_end == end
    sub.current_period_end = datetime.utcnow() - timedelta(seconds=1)
    db_session.commit()
    assert not client.get("/api/v1/subscription/status", headers=auth_headers).json()[
        "basic_active"
    ]
    assert apply(client, auth_headers, "fixture-month").status_code == 409


@pytest.fixture
def stripe_mock(monkeypatch: pytest.MonkeyPatch) -> Mock:
    client = Mock()
    client.v1.promotion_codes.list.return_value = SimpleNamespace(
        data=[stripe.StripeObject.construct_from({"id": "promo_fixture", "customer": None}, None)]
    )
    client.v1.checkout.sessions.create.return_value = SimpleNamespace(
        url="https://checkout.stripe.test/fixture"
    )
    client.v1.subscriptions.retrieve.return_value = stripe.StripeObject.construct_from(
        {
            "customer": "cus_fixture",
            "status": "active",
            "discounts": [],
        },
        None,
    )
    monkeypatch.setattr(coupons, "_configured_stripe_client", lambda *args: client)
    monkeypatch.setattr(billing, "_configured_stripe_client", lambda *args: client)
    return client


def test_billing_coupon_uses_checkout_without_unlocking(
    client: TestClient, auth_headers: dict[str, str], db_session: Session, stripe_mock: Mock
) -> None:
    db_session.query(UserSubscription).one().status = "inactive"
    db_session.commit()
    response = apply(client, auth_headers, tier="basic")
    assert response.status_code == 200, response.text
    assert response.json()["subscription"] is None
    assert response.json()["checkout_url"].startswith("https://checkout.stripe.test/")
    params = stripe_mock.v1.checkout.sessions.create.call_args.args[0]
    assert params["discounts"] == [{"promotion_code": "promo_fixture"}]
    assert "allow_promotion_codes" not in params
    assert params["payment_method_collection"] == "always"
    assert params["subscription_data"]["trial_period_days"] == 30
    assert not client.get("/api/v1/subscription/status", headers=auth_headers).json()[
        "basic_active"
    ]


def test_paid_subscriber_discount_does_not_create_another_subscription(
    client: TestClient,
    auth_headers: dict[str, str],
    db_session: Session,
    stripe_mock: Mock,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    sub = db_session.query(UserSubscription).one()
    sub.source = "stripe"
    sub.stripe_subscription_id = "sub_fixture"
    sub.stripe_customer_id = "cus_fixture"
    db_session.commit()
    response = apply(client, auth_headers)
    assert response.status_code == 200, response.text
    params = stripe_mock.v1.subscriptions.update.call_args.args[1]
    assert params == {
        "discounts": [{"promotion_code": "promo_fixture"}],
        "proration_behavior": "none",
    }
    stripe_mock.v1.checkout.sessions.create.assert_not_called()
    monkeypatch.setattr(settings, "premium_waiver_codes", "fixture-premium")
    assert apply(client, auth_headers, "fixture-premium").status_code == 409
    assert sub.source == "stripe"
    assert (
        client.post(
            "/api/v1/subscription/checkout-session", headers=auth_headers, json={"tier": "basic"}
        ).status_code
        == 409
    )
    stripe_mock.v1.subscriptions.retrieve.return_value["discounts"] = ["discount_existing"]
    assert apply(client, auth_headers).status_code == 409


def test_expired_or_other_customer_promos_rejected(
    client: TestClient, auth_headers: dict[str, str], db_session: Session, stripe_mock: Mock
) -> None:
    db_session.query(UserSubscription).one().status = "inactive"
    db_session.commit()
    stripe_mock.v1.promotion_codes.list.return_value.data = []
    assert apply(client, auth_headers).status_code == 400
    stripe_mock.v1.promotion_codes.list.return_value.data = [
        {"id": "promo_private", "customer": "cus_other"}
    ]
    assert apply(client, auth_headers).status_code == 400
    stripe_mock.v1.checkout.sessions.create.assert_not_called()
