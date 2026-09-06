from __future__ import annotations

import hashlib
import hmac
import json
import time
from datetime import datetime, timedelta
from types import SimpleNamespace
from typing import Any

import pytest
from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from app.core.config import settings
from app.models.entities import User


def test_premium_waiver_unlocks_macro_tracking(
    client: TestClient, auth_headers: dict[str, str], monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(settings, "premium_waiver_codes", "development")
    status = client.get("/api/v1/premium/status", headers=auth_headers)
    assert status.status_code == 200
    assert status.json()["active"] is False

    blocked = client.post(
        "/api/v1/macros/confirmations",
        headers=auth_headers,
        json={"recipe_id": None, "status": "ate"},
    )
    assert blocked.status_code == 402

    unlocked = client.post(
        "/api/v1/premium/waiver-code",
        headers=auth_headers,
        json={"code": "development"},
    )
    assert unlocked.status_code == 200
    assert unlocked.json()["active"] is True
    assert unlocked.json()["source"] == "waiver_code"

    target = client.put(
        "/api/v1/macros/targets",
        headers=auth_headers,
        json={
            "daily_calories": 2200,
            "daily_protein_g": 160,
            "daily_carbs_g": 220,
            "daily_fat_g": 70,
            "goal": "maintain",
        },
    )
    assert target.status_code == 200
    assert target.json()["daily_protein_g"] == 160

    recipe = client.post(
        "/api/v1/recipes",
        headers=auth_headers,
        json={
            "name": "Macro chicken bowl",
            "photo_url": "https://example.com/bowl.jpg",
            "servings": 4,
            "ingredients": [{"original_text": "1 lb chicken"}],
            "instructions": [{"step_number": 1, "text": "Cook chicken"}],
        },
    ).json()

    confirmation = client.post(
        "/api/v1/macros/confirmations",
        headers=auth_headers,
        json={
            "recipe_id": recipe["id"],
            "status": "ate",
            "servings_consumed": 1,
            "calories": 520,
            "protein_g": 42,
            "carbs_g": 55,
            "fat_g": 16,
        },
    )
    assert confirmation.status_code == 200
    assert confirmation.json()["macro_source"] == "manual"

    skipped = client.post(
        "/api/v1/macros/confirmations",
        headers=auth_headers,
        json={"recipe_id": recipe["id"], "status": "skipped", "servings_consumed": 1},
    )
    assert skipped.status_code == 200
    assert skipped.json()["calories"] == 0

    summary = client.get("/api/v1/macros/summary?days=7", headers=auth_headers)
    assert summary.status_code == 200
    body = summary.json()
    assert body["active"] is True
    assert body["totals"]["calories"] == 520
    assert body["totals"]["protein_g"] == 42
    assert body["eaten_meals"] == 1
    assert body["skipped_meals"] == 1


def test_basic_trial_allows_access_then_expires(
    client: TestClient, auth_headers: dict[str, str], db_session: Session
) -> None:
    status = client.get("/api/v1/subscription/status", headers=auth_headers)
    assert status.status_code == 200
    body = status.json()
    assert body["current_tier"] == "trial"
    assert body["basic_active"] is True
    assert body["premium_active"] is False
    assert body["trial_days_remaining"] > 0

    recipes = client.get("/api/v1/recipes", headers=auth_headers)
    assert recipes.status_code == 200

    user = db_session.query(User).filter_by(email="owner@example.com").one()
    user.created_at = datetime.utcnow() - timedelta(days=settings.basic_free_trial_days + 1)
    db_session.commit()

    expired_recipes = client.get("/api/v1/recipes", headers=auth_headers)
    assert expired_recipes.status_code == 402
    assert "free month has ended" in expired_recipes.json()["detail"]

    still_can_manage_profile = client.get("/api/v1/profile", headers=auth_headers)
    assert still_can_manage_profile.status_code == 200
    expired_status = client.get("/api/v1/subscription/status", headers=auth_headers)
    assert expired_status.status_code == 200
    assert expired_status.json()["current_tier"] == "none"


def test_basic_and_premium_access_codes_unlock_expected_tiers(
    client: TestClient, auth_headers: dict[str, str], monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(settings, "basic_waiver_codes", "basic-test-code")
    monkeypatch.setattr(settings, "premium_waiver_codes", "premium-test-code")

    basic = client.post(
        "/api/v1/subscription/waiver-code",
        headers=auth_headers,
        json={"code": "basic-test-code"},
    )
    assert basic.status_code == 200
    basic_body = basic.json()
    assert basic_body["current_tier"] == "basic"
    assert basic_body["basic_active"] is True
    assert basic_body["premium_active"] is False
    assert basic_body["active"] is False

    blocked_macro = client.put(
        "/api/v1/macros/targets",
        headers=auth_headers,
        json={"daily_calories": 2200},
    )
    assert blocked_macro.status_code == 402

    premium = client.post(
        "/api/v1/subscription/waiver-code",
        headers=auth_headers,
        json={"code": "premium-test-code"},
    )
    assert premium.status_code == 200
    premium_body = premium.json()
    assert premium_body["current_tier"] == "premium"
    assert premium_body["basic_active"] is True
    assert premium_body["premium_active"] is True
    assert premium_body["active"] is True


def test_stripe_checkout_is_disabled_until_configured(
    client: TestClient, auth_headers: dict[str, str], monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(settings, "stripe_enabled", False)
    response = client.post("/api/v1/premium/checkout-session", headers=auth_headers)
    assert response.status_code == 503
    assert "Stripe Premium billing is not configured" in response.text

    portal = client.post("/api/v1/premium/billing-portal-session", headers=auth_headers)
    assert portal.status_code == 503
    assert "Stripe billing is not configured" in portal.text


def test_stripe_account_mismatch_blocks_checkout(
    client: TestClient, auth_headers: dict[str, str], monkeypatch: pytest.MonkeyPatch
) -> None:
    class FakeAccounts:
        @staticmethod
        def retrieve_current() -> dict[str, str]:
            return {"id": "acct_wrong"}

    class FakeV1:
        accounts = FakeAccounts()

    class FakeClient:
        v1 = FakeV1()

        def __init__(self, *_args: Any, **_kwargs: Any) -> None:
            pass

    class FakeStripe:
        StripeClient = FakeClient

    monkeypatch.setattr(settings, "stripe_enabled", True)
    monkeypatch.setattr(settings, "stripe_secret_key", "sk_test_fake")
    monkeypatch.setattr(settings, "stripe_webhook_secret", "webhook_secret_for_test")
    monkeypatch.setattr(settings, "stripe_premium_price_id", "price_fake")
    monkeypatch.setattr(settings, "stripe_expected_account_id", "acct_expected")
    monkeypatch.setattr("app.services.billing.stripe_client", FakeStripe)

    response = client.post("/api/v1/premium/checkout-session", headers=auth_headers)
    assert response.status_code == 503
    assert "Stripe account mismatch" in response.text


def test_basic_checkout_uses_basic_price_and_remaining_trial(
    client: TestClient, auth_headers: dict[str, str], monkeypatch: pytest.MonkeyPatch
) -> None:
    captured: dict[str, Any] = {}

    class FakeAccounts:
        @staticmethod
        def retrieve_current() -> dict[str, str]:
            return {"id": "acct_expected"}

    class FakeSessions:
        @staticmethod
        def create(params: dict[str, Any]) -> SimpleNamespace:
            captured["params"] = params
            return SimpleNamespace(url="https://checkout.stripe.test/basic")

    class FakeCheckout:
        sessions = FakeSessions()

    class FakeV1:
        accounts = FakeAccounts()
        checkout = FakeCheckout()

    class FakeClient:
        def __init__(self, secret_key: str, stripe_version: str) -> None:
            captured["secret_key"] = secret_key
            captured["stripe_version"] = stripe_version
            self.v1 = FakeV1()

    class FakeStripe:
        StripeClient = FakeClient

    monkeypatch.setattr(settings, "stripe_enabled", True)
    monkeypatch.setattr(settings, "stripe_secret_key", "sk_test_fake")
    monkeypatch.setattr(settings, "stripe_webhook_secret", "webhook_secret_for_test")
    monkeypatch.setattr(settings, "stripe_basic_price_id", "price_basic")
    monkeypatch.setattr(settings, "stripe_premium_price_id", "price_premium")
    monkeypatch.setattr(settings, "stripe_expected_account_id", "acct_expected")
    monkeypatch.setattr("app.services.billing.stripe_client", FakeStripe)

    response = client.post(
        "/api/v1/subscription/checkout-session",
        headers=auth_headers,
        json={"tier": "basic"},
    )

    assert response.status_code == 200
    assert response.json()["checkout_url"] == "https://checkout.stripe.test/basic"
    params = captured["params"]
    assert params["line_items"] == [{"price": "price_basic", "quantity": 1}]
    assert params["subscription_data"]["metadata"]["tier"] == "basic"
    assert 1 <= params["subscription_data"]["trial_period_days"] <= settings.basic_free_trial_days
    assert "payment_method_types" not in params
    assert captured["stripe_version"] == settings.stripe_api_version


def test_signed_stripe_webhook_is_processed(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    webhook_secret = "webhook_secret_for_test"
    monkeypatch.setattr(settings, "stripe_enabled", True)
    monkeypatch.setattr(settings, "stripe_secret_key", "sk_test_for_signature_only")
    monkeypatch.setattr(settings, "stripe_webhook_secret", webhook_secret)
    monkeypatch.setattr(settings, "stripe_premium_price_id", "price_for_test")
    monkeypatch.setattr(settings, "stripe_expected_account_id", "")
    payload = json.dumps(
        {
            "id": "evt_local_smoke",
            "object": "event",
            "type": "customer.subscription.updated",
            "data": {
                "object": {
                    "id": "sub_local_smoke",
                    "object": "subscription",
                    "status": "active",
                    "metadata": {},
                }
            },
        },
        separators=(",", ":"),
    ).encode("utf-8")
    timestamp = str(int(time.time()))
    signed_payload = timestamp.encode("utf-8") + b"." + payload
    signature = hmac.new(
        webhook_secret.encode("utf-8"), signed_payload, hashlib.sha256
    ).hexdigest()

    response = client.post(
        "/api/v1/premium/stripe/webhook",
        content=payload,
        headers={
            "Stripe-Signature": f"t={timestamp},v1={signature}",
            "Content-Type": "application/json",
        },
    )

    assert response.status_code == 200
    assert response.json()["status"] == "processed"
