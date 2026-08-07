from __future__ import annotations

import pytest
from fastapi.testclient import TestClient

from app.core.config import settings


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


def test_stripe_checkout_is_disabled_until_configured(
    client: TestClient, auth_headers: dict[str, str], monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(settings, "stripe_enabled", False)
    response = client.post("/api/v1/premium/checkout-session", headers=auth_headers)
    assert response.status_code == 503
    assert "Stripe billing is not configured" in response.text

    portal = client.post("/api/v1/premium/billing-portal-session", headers=auth_headers)
    assert portal.status_code == 503
    assert "Stripe billing is not configured" in portal.text


def test_stripe_account_mismatch_blocks_checkout(
    client: TestClient, auth_headers: dict[str, str], monkeypatch: pytest.MonkeyPatch
) -> None:
    class FakeAccount:
        @staticmethod
        def retrieve() -> dict[str, str]:
            return {"id": "acct_wrong"}

    class FakeStripe:
        api_key = ""
        Account = FakeAccount

    monkeypatch.setattr(settings, "stripe_enabled", True)
    monkeypatch.setattr(settings, "stripe_secret_key", "sk_test_fake")
    monkeypatch.setattr(settings, "stripe_webhook_secret", "webhook_secret_for_test")
    monkeypatch.setattr(settings, "stripe_premium_price_id", "price_fake")
    monkeypatch.setattr(settings, "stripe_expected_account_id", "acct_expected")
    monkeypatch.setattr("app.services.billing.stripe_client", FakeStripe)

    response = client.post("/api/v1/premium/checkout-session", headers=auth_headers)
    assert response.status_code == 503
    assert "Stripe account mismatch" in response.text
