from __future__ import annotations

from datetime import datetime
from types import SimpleNamespace
from unittest.mock import AsyncMock, Mock
from uuid import uuid4

import pytest
from fastapi import HTTPException
from fastapi.testclient import TestClient
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.core.config import settings
from app.models.entities import IngestionJob, User, UserSubscription
from app.models.nutrition import NutritionCall, NutritionProviderState
from app.services import meal_assistant, meal_voice, nutrition
from app.services.billing import PREMIUM_PLAN_KEY
from app.services.fatsecret import ATTRIBUTION
from app.services.nutrition_consent import (
    FATSECRET_TERMS_URL,
    FATSECRET_TERMS_VERSION,
    NUTRITION_DISCLOSURE,
    accept_nutrition_terms,
    consent_status,
    require_nutrition_consent,
)

CONSENT_URL = "/api/v1/nutrition/consent"
PRIOR_ACCEPTANCE = datetime(2026, 10, 1, 12)


@pytest.mark.parametrize(
    ("version", "accepted_at", "accepted"),
    [
        (None, None, False),
        (None, PRIOR_ACCEPTANCE, False),
        ("fatsecret-terms-v1", None, False),
        ("fatsecret-terms-v1", PRIOR_ACCEPTANCE, False),
        ("unknown", PRIOR_ACCEPTANCE, False),
        (FATSECRET_TERMS_VERSION, None, False),
        (FATSECRET_TERMS_VERSION, PRIOR_ACCEPTANCE, True),
    ],
)
def test_current_revision_requires_both_version_and_explicit_acceptance(
    version: str | None, accepted_at: datetime | None, accepted: bool
) -> None:
    user = User(fatsecret_terms_version=version, fatsecret_terms_accepted_at=accepted_at)
    result = consent_status(user)
    assert result["accepted"] is accepted
    assert result["terms_version"] == "fatsecret-terms-v2"
    assert result["accepted_at"] == accepted_at
    assert user.fatsecret_terms_version == version
    assert user.fatsecret_terms_accepted_at == accepted_at
    if accepted:
        require_nutrition_consent(user)
    else:
        with pytest.raises(HTTPException) as error:
            require_nutrition_consent(user)
        assert error.value.status_code == 403
        assert "nutrition tools agreement" in error.value.detail


@pytest.mark.parametrize("version", ["fatsecret-terms-v1", "unknown", "", "FATSECRET-TERMS-V2"])
def test_stale_or_unknown_acceptance_never_changes_existing_fields(version: str) -> None:
    user = User(
        fatsecret_terms_version="fatsecret-terms-v1",
        fatsecret_terms_accepted_at=PRIOR_ACCEPTANCE,
    )
    with pytest.raises(HTTPException) as error:
        accept_nutrition_terms(user, version)
    assert error.value.status_code == 409
    assert user.fatsecret_terms_version == "fatsecret-terms-v1"
    assert user.fatsecret_terms_accepted_at == PRIOR_ACCEPTANCE


@pytest.mark.parametrize("prior_version", [None, "fatsecret-terms-v1", FATSECRET_TERMS_VERSION])
def test_explicit_current_acceptance_is_idempotent(prior_version: str | None) -> None:
    user = User(fatsecret_terms_version=prior_version)
    accept_nutrition_terms(user, FATSECRET_TERMS_VERSION)
    accepted_at = user.fatsecret_terms_accepted_at
    assert accepted_at is not None
    accept_nutrition_terms(user, FATSECRET_TERMS_VERSION)
    assert user.fatsecret_terms_accepted_at == accepted_at
    assert consent_status(user)["accepted"] is True


@pytest.fixture()
def premium_headers(auth_headers: dict[str, str], db_session: Session) -> dict[str, str]:
    subscription = db_session.scalar(select(UserSubscription))
    assert subscription
    subscription.plan_key = PREMIUM_PLAN_KEY
    db_session.add(NutritionProviderState(provider="fatsecret"))
    db_session.commit()
    return auth_headers


@pytest.fixture(autouse=True)
def provider_mocks(monkeypatch: pytest.MonkeyPatch) -> SimpleNamespace:
    search = Mock(return_value={"foods": {"food": {"food_id": "42"}}})
    prepare = AsyncMock(return_value={"status": "ready", "items": []})
    transcribe = AsyncMock(return_value={"text": "two eggs"})
    monkeypatch.setattr(nutrition.nutrition_client, "request", search)
    monkeypatch.setattr(meal_assistant, "prepare", prepare)
    monkeypatch.setattr(meal_voice, "transcribe", transcribe)
    monkeypatch.setattr(settings, "nutrition_ai_enabled", True)
    monkeypatch.setattr(settings, "openai_api_key", "test-no-external-provider-calls")
    monkeypatch.setattr(settings, "email_smtp_host", "")
    return SimpleNamespace(search=search, prepare=prepare, transcribe=transcribe)


def test_consent_contract_is_additive_and_read_only(
    client: TestClient,
    premium_headers: dict[str, str],
    db_session: Session,
    monkeypatch: pytest.MonkeyPatch,
    provider_mocks: SimpleNamespace,
) -> None:
    monkeypatch.setattr(settings, "app_public_url", "https://app.example.test/dinner/")
    user = db_session.scalar(select(User))
    assert user and user.terms_accepted_at and user.privacy_accepted_at
    response = client.get(CONSENT_URL, headers=premium_headers)
    assert response.status_code == 200
    assert response.headers["cache-control"] == "no-store"
    assert response.json() == {
        "accepted": False,
        "terms_version": FATSECRET_TERMS_VERSION,
        "terms_url": FATSECRET_TERMS_URL,
        "accepted_at": None,
        "disclosure": NUTRITION_DISCLOSURE,
        "app_terms_url": "https://app.example.test/dinner/terms",
        "privacy_url": "https://app.example.test/dinner/privacy",
    }
    assert "OpenAI" in NUTRITION_DISCLOSURE and "fatsecret" in NUTRITION_DISCLOSURE
    assert "completed voice recording" in NUTRITION_DISCLOSURE
    assert "both the calculator and meal AI" in NUTRITION_DISCLOSURE
    db_session.refresh(user)
    assert user.fatsecret_terms_version is None and user.fatsecret_terms_accepted_at is None
    provider_mocks.search.assert_not_called()
    provider_mocks.prepare.assert_not_awaited()
    provider_mocks.transcribe.assert_not_awaited()


def test_consent_keeps_authentication_and_premium_requirements(
    client: TestClient, auth_headers: dict[str, str], db_session: Session
) -> None:
    body = {"terms_version": FATSECRET_TERMS_VERSION}
    assert client.get(CONSENT_URL).status_code == 401
    assert client.post(CONSENT_URL, json=body).status_code == 401
    assert client.get(CONSENT_URL, headers=auth_headers).status_code == 402
    assert client.post(CONSENT_URL, headers=auth_headers, json=body).status_code == 402
    user = db_session.scalar(select(User))
    assert user and user.fatsecret_terms_version is None
    assert user.fatsecret_terms_accepted_at is None


@pytest.mark.parametrize("prior_version", [None, "fatsecret-terms-v1"])
def test_unaccepted_revision_blocks_calculator_text_and_audio_before_dispatch(
    client: TestClient,
    premium_headers: dict[str, str],
    db_session: Session,
    provider_mocks: SimpleNamespace,
    prior_version: str | None,
) -> None:
    user = db_session.scalar(select(User))
    assert user
    user.fatsecret_terms_version = prior_version
    user.fatsecret_terms_accepted_at = PRIOR_ACCEPTANCE if prior_version else None
    db_session.commit()
    responses = [
        client.get("/api/v1/nutrition/foods/search?query=eggs", headers=premium_headers),
        client.get("/api/v1/nutrition/foods/42", headers=premium_headers),
        client.post(
            "/api/v1/nutrition/calculations/preview",
            headers=premium_headers,
            json={
                "items": [
                    {"source": "fatsecret", "name": "Eggs", "food_id": "42", "serving_id": "7"}
                ]
            },
        ),
        client.post(
            "/api/v1/nutrition/ai/drafts",
            headers=premium_headers,
            json={"description": "two eggs", "request_id": str(uuid4())},
        ),
        client.post(
            "/api/v1/nutrition/ai/transcriptions",
            headers=premium_headers,
            data={"request_id": str(uuid4())},
            files={"audio": ("meal.webm", b"not-decoded-before-consent", "audio/webm")},
        ),
    ]
    assert [response.status_code for response in responses] == [403] * len(responses)
    provider_mocks.search.assert_not_called()
    provider_mocks.prepare.assert_not_awaited()
    provider_mocks.transcribe.assert_not_awaited()
    assert db_session.scalar(select(func.count()).select_from(IngestionJob)) == 0
    assert db_session.scalar(select(func.count()).select_from(NutritionCall)) == 0
    db_session.refresh(user)
    assert user.fatsecret_terms_version == prior_version
    assert not consent_status(user)["accepted"]


def test_current_acceptance_unlocks_both_tools_and_stale_retry_cannot_overwrite_it(
    client: TestClient,
    premium_headers: dict[str, str],
    db_session: Session,
    provider_mocks: SimpleNamespace,
) -> None:
    user = db_session.scalar(select(User))
    assert user
    user.fatsecret_terms_version = "fatsecret-terms-v1"
    user.fatsecret_terms_accepted_at = PRIOR_ACCEPTANCE
    db_session.commit()
    before = client.get(CONSENT_URL, headers=premium_headers).json()
    assert not before["accepted"] and before["terms_version"] == FATSECRET_TERMS_VERSION
    assert client.post(
        CONSENT_URL, headers=premium_headers, json={"terms_version": "fatsecret-terms-v1"}
    ).status_code == 409
    first = client.post(
        CONSENT_URL, headers=premium_headers, json={"terms_version": FATSECRET_TERMS_VERSION}
    )
    assert first.status_code == 200 and first.headers["cache-control"] == "no-store"
    assert first.json()["accepted"] and first.json()["accepted_at"] != before["accepted_at"]
    second = client.post(
        CONSENT_URL, headers=premium_headers, json={"terms_version": FATSECRET_TERMS_VERSION}
    )
    assert second.status_code == 200 and second.json() == first.json()
    assert client.post(
        CONSENT_URL, headers=premium_headers, json={"terms_version": "fatsecret-terms-v1"}
    ).status_code == 409
    assert client.get(CONSENT_URL, headers=premium_headers).json() == first.json()
    search = client.get("/api/v1/nutrition/foods/search?query=eggs", headers=premium_headers)
    assert search.status_code == 200
    assert search.json()["attribution"] == ATTRIBUTION
    assert search.json()["persist_identifiers_only"] is True
    assert client.post(
        "/api/v1/nutrition/ai/drafts",
        headers=premium_headers,
        json={"description": "two eggs", "request_id": str(uuid4())},
    ).status_code == 200
    assert client.post(
        "/api/v1/nutrition/ai/transcriptions",
        headers=premium_headers,
        data={"request_id": str(uuid4())},
        files={"audio": ("meal.webm", b"mocked-audio", "audio/webm")},
    ).status_code == 200
    provider_mocks.search.assert_called_once()
    provider_mocks.prepare.assert_awaited_once()
    provider_mocks.transcribe.assert_awaited_once()


def test_acceptance_does_not_opt_in_another_account(db_session: Session) -> None:
    users = [
        User(email=f"nutrition-{index}@example.com", password_hash=uuid4().hex)
        for index in range(2)
    ]
    db_session.add_all(users)
    db_session.commit()
    accept_nutrition_terms(users[0], FATSECRET_TERMS_VERSION)
    db_session.commit()
    for user in users:
        db_session.refresh(user)
    assert consent_status(users[0])["accepted"] is True
    assert consent_status(users[1])["accepted"] is False
    assert users[1].fatsecret_terms_version is None
    assert users[1].fatsecret_terms_accepted_at is None
