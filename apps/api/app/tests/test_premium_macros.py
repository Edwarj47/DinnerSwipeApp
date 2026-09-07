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
from app.models.entities import User, UserSubscription


def test_premium_waiver_unlocks_macro_tracking(
    client: TestClient, auth_headers: dict[str, str], monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(settings, "premium_waiver_codes", "premium-unit-test-code")
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
        json={"code": "premium-unit-test-code"},
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

    manual_entry = client.post(
        "/api/v1/macros/entries",
        headers=auth_headers,
        json={
            "entry_name": "Protein shake",
            "meal_label": "snack",
            "status": "ate",
            "calories": 300,
            "protein_g": 40,
            "carbs_g": 12,
            "fat_g": 6,
            "fiber_g": 2,
            "notes": "Post workout",
        },
    )
    assert manual_entry.status_code == 200
    entry_body = manual_entry.json()
    assert entry_body["entry_name"] == "Protein shake"
    assert entry_body["meal_label"] == "snack"

    updated_entry = client.put(
        f"/api/v1/macros/entries/{entry_body['id']}",
        headers=auth_headers,
        json={"calories": 325, "protein_g": 42, "notes": "Adjusted serving"},
    )
    assert updated_entry.status_code == 200
    assert updated_entry.json()["calories"] == 325
    assert updated_entry.json()["macro_source"] == "manual"

    entries = client.get("/api/v1/macros/entries?days=30", headers=auth_headers)
    assert entries.status_code == 200
    assert any(item["entry_name"] == "Protein shake" for item in entries.json())

    analytics = client.get("/api/v1/macros/analytics?days=30", headers=auth_headers)
    assert analytics.status_code == 200
    assert analytics.json()["totals"]["calories"] >= 845

    exported = client.get("/api/v1/macros/export?days=30", headers=auth_headers)
    assert exported.status_code == 200
    assert exported.json()["export_format_version"] == "2026-09-07"
    assert any(item["entry_name"] == "Protein shake" for item in exported.json()["entries"])

    deleted = client.delete(f"/api/v1/macros/entries/{entry_body['id']}", headers=auth_headers)
    assert deleted.status_code == 200
    assert deleted.json()["status"] == "deleted"


def test_basic_access_requires_subscription_or_stripe_trial(
    client: TestClient, db_session: Session
) -> None:
    registered = client.post(
        "/api/v1/auth/register",
        json={
            "email": "nosub@example.com",
            "password": "change-me-123",
            "terms_accepted": True,
            "privacy_accepted": True,
        },
    )
    token = registered.json()["access_token"]
    headers = {"Authorization": f"Bearer {token}"}

    status = client.get("/api/v1/subscription/status", headers=headers)
    assert status.status_code == 200
    body = status.json()
    assert body["current_tier"] == "none"
    assert body["basic_active"] is False
    assert body["premium_active"] is False
    assert body["trial_days_remaining"] == 0

    blocked_recipes = client.get("/api/v1/recipes", headers=headers)
    assert blocked_recipes.status_code == 402
    assert "card on file" in blocked_recipes.json()["detail"]

    user = db_session.query(User).filter_by(email="nosub@example.com").one()
    db_session.add(
        UserSubscription(
            user_id=user.id,
            plan_key="basic_monthly",
            status="trialing",
            source="stripe",
            stripe_customer_id="cus_trial",
            stripe_subscription_id="sub_trial",
            current_period_end=datetime.utcnow() + timedelta(days=30),
        )
    )
    db_session.commit()

    trial_status = client.get("/api/v1/subscription/status", headers=headers).json()
    assert trial_status["current_tier"] == "trial"
    assert trial_status["basic_active"] is True
    assert trial_status["trial_days_remaining"] > 0
    recipes = client.get("/api/v1/recipes", headers=headers)
    assert recipes.status_code == 200
    still_can_manage_profile = client.get("/api/v1/profile", headers=headers)
    assert still_can_manage_profile.status_code == 200


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


def test_basic_checkout_uses_basic_price_and_card_required_trial(
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
    assert params["subscription_data"]["trial_period_days"] == settings.basic_free_trial_days
    missing_payment_method = params["subscription_data"]["trial_settings"]["end_behavior"][
        "missing_payment_method"
    ]
    assert missing_payment_method == "cancel"
    assert params["payment_method_collection"] == "always"
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
