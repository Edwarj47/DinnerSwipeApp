from __future__ import annotations

import asyncio
import hashlib
import json
import time
from copy import deepcopy
from datetime import timedelta
from pathlib import Path
from types import SimpleNamespace
from typing import Any, cast
from unittest.mock import AsyncMock, MagicMock, Mock
from uuid import uuid4

import httpx
import pytest
from fastapi import HTTPException
from fastapi.testclient import TestClient
from sqlalchemy import event, func, select
from sqlalchemy.orm import Session
from starlette.types import Message, Receive, Scope, Send

from app.core.body_limits import RequestBodyLimitMiddleware
from app.core.config import Settings, settings
from app.core.rate_limit import auth_rate_limiter
from app.core.security import create_access_token
from app.ingestion.openai_responses import create_response
from app.models.entities import (
    IngestionJob,
    MealMacroConfirmation,
    Recipe,
    User,
    UserSubscription,
)
from app.models.nutrition import (
    NutritionCalculation,
    NutritionFood,
    NutritionProviderState,
    NutritionServing,
    NutritionUsage,
)
from app.services import meal_assistant, meal_voice
from app.services.ai_recipes import now
from app.services.billing import PREMIUM_PLAN_KEY
from app.services.nutrition_budget import NutritionError
from app.services.nutrition_consent import FATSECRET_TERMS_VERSION, accept_nutrition_terms

ROOT = "/api/v1/nutrition/ai"
DESCRIPTION = "I ate two eggs for breakfast"
MENTIONS: dict[str, Any] = {
    "name": "My egg breakfast",
    "meal_label": "breakfast",
    "items": [{"name": "My eggs", "search_term": "eggs", "quantity": 2, "unit": "each"}],
}
SEARCH_NAME = "PROVIDER_SEARCH_NAME_NOT_USER_TEXT"
DETAIL_NAME = "PROVIDER_DETAIL_NAME_NOT_USER_TEXT"
SERVING_NAME = "PROVIDER_SERVING_DESCRIPTION_NOT_USER_TEXT"
PROVIDER_CALORIES = "197.654321"
SEARCH = {
    "foods": {
        "food": [
            {"food_id": "42", "food_name": f"Egg {SEARCH_NAME}"},
            {"food_id": "99", "food_name": "OTHER_PROVIDER_SEARCH_NAME"},
        ]
    }
}
DETAIL = {
    "food": {
        "food_id": "42",
        "food_name": DETAIL_NAME,
        "servings": {
            "serving": {
                "serving_id": "7",
                "serving_description": SERVING_NAME,
                "number_of_units": "1",
                "measurement_description": "each",
                "metric_serving_amount": "50",
                "metric_serving_unit": "g",
                "calories": PROVIDER_CALORIES,
                "protein": "6.2",
            }
        },
    }
}
WEBM = b"\x1aE\xdf\xa3fake-webm-audio"
DECODE_BUDGET_KEY = "nutrition:audio:decode:global"


def ai_output(mentions: dict[str, Any]) -> tuple[dict[str, Any], str]:
    return (
        {"output": [{"content": [{"type": "output_text", "text": json.dumps(mentions)}]}]},
        "fixture-model",
    )


@pytest.fixture(autouse=True)
def providers(monkeypatch: pytest.MonkeyPatch, db_session: Session) -> SimpleNamespace:
    monkeypatch.setattr(settings, "nutrition_ai_enabled", False)
    monkeypatch.setattr(settings, "nutrition_voice_enabled", False)
    monkeypatch.setattr(settings, "nutrition_ai_daily_drafts", 20)
    monkeypatch.setattr(settings, "ai_daily_dispatch_budget", 500)
    monkeypatch.setattr(settings, "openai_api_key", "fixture-not-a-real-provider-key")
    monkeypatch.setattr(settings, "openai_fallback_models", "")
    monkeypatch.setattr(settings, "email_smtp_host", "")
    monkeypatch.setattr(settings, "fatsecret_enabled", True)
    monkeypatch.setattr(settings, "fatsecret_client_id", "fixture-client")
    monkeypatch.setattr(settings, "fatsecret_client_secret", "fixture-not-a-real-secret")
    db_session.add(NutritionProviderState(provider="fatsecret"))
    db_session.commit()

    ai = AsyncMock(return_value=ai_output(MENTIONS))
    monkeypatch.setattr(meal_assistant, "create_response", ai)

    def lookup(method: str, parameters: dict[str, str]) -> dict[str, Any]:
        if method == "foods.search":
            assert parameters["search_expression"] == "eggs"
            return deepcopy(SEARCH)
        assert method == "food.get.v5" and parameters == {"food_id": "42"}
        return deepcopy(DETAIL)

    nutrition = Mock()
    nutrition.request.side_effect = lookup
    monkeypatch.setattr(meal_assistant, "nutrition_client", nutrition)

    # Keep the shared quota boundary real while replacing every outbound HTTP call.
    response = httpx.Response(
        200,
        request=httpx.Request("POST", "https://provider.invalid/fixture"),
        json=ai_output(MENTIONS)[0] | {"text": DESCRIPTION},
    )
    post = AsyncMock(return_value=response)
    http = MagicMock()
    http.__aenter__.return_value = SimpleNamespace(post=post)
    monkeypatch.setattr(httpx, "AsyncClient", Mock(return_value=http))

    process = SimpleNamespace(
        returncode=0,
        communicate=AsyncMock(return_value=(b"\0" * 32000, None)),
        kill=Mock(),
        wait=AsyncMock(),
    )
    decoder = AsyncMock(return_value=process)
    monkeypatch.setattr(asyncio, "create_subprocess_exec", decoder)
    monkeypatch.setattr(meal_voice, "voice_available", Mock(return_value=True))
    monkeypatch.setattr(meal_voice, "_transcripts", {})
    monkeypatch.setattr(meal_voice, "_decode_slots", asyncio.Semaphore(1))
    voice_reserve = Mock(wraps=meal_assistant.reserve)
    monkeypatch.setattr(meal_voice, "reserve", voice_reserve)
    return SimpleNamespace(
        ai=ai,
        nutrition=nutrition,
        post=post,
        decoder=decoder,
        process=process,
        voice_reserve=voice_reserve,
    )


@pytest.fixture()
def premium(auth_headers: dict[str, str], db_session: Session) -> dict[str, str]:
    subscription = db_session.scalar(select(UserSubscription))
    assert subscription
    subscription.plan_key = PREMIUM_PLAN_KEY
    db_session.commit()
    return auth_headers


@pytest.fixture()
def assistant_headers(
    premium: dict[str, str], db_session: Session, monkeypatch: pytest.MonkeyPatch
) -> dict[str, str]:
    user = db_session.scalar(select(User).where(User.email == "owner@example.com"))
    assert user
    accept_nutrition_terms(user, FATSECRET_TERMS_VERSION)
    db_session.commit()
    monkeypatch.setattr(settings, "nutrition_ai_enabled", True)
    return premium


def body(**changes: Any) -> dict[str, Any]:
    return {"description": DESCRIPTION, "request_id": str(uuid4())} | changes


def draft_job(db: Session, request_id: str) -> IngestionJob:
    job = db.scalar(
        select(IngestionJob).where(
            IngestionJob.job_type == meal_assistant.JOB_TYPE,
            IngestionJob.idempotency_key == request_id,
        )
    )
    assert job
    db.refresh(job)
    return job


def assert_no_saved_meal(db: Session) -> None:
    for model in (MealMacroConfirmation, Recipe, NutritionCalculation, NutritionUsage):
        assert db.scalar(select(func.count()).select_from(model)) == 0


def audio_request(
    client: TestClient,
    headers: dict[str, str],
    request_id: str,
    content: bytes = WEBM,
) -> httpx.Response:
    return cast(
        httpx.Response,
        client.post(
            f"{ROOT}/transcriptions",
            headers=headers,
            data={"request_id": request_id},
            files={"audio": ("meal.webm", content, "audio/webm")},
        ),
    )


def voice_job(db: Session, request_id: str) -> IngestionJob:
    job = db.scalar(
        select(IngestionJob).where(
            IngestionJob.job_type == meal_assistant.VOICE_JOB_TYPE,
            IngestionJob.idempotency_key == request_id,
        )
    )
    assert job
    db.refresh(job)
    assert job.progress == {"fingerprint": hashlib.sha256(WEBM).hexdigest()}
    assert_no_saved_meal(db)
    return job


def test_feature_is_disabled_by_default() -> None:
    assert Settings.model_fields["nutrition_ai_enabled"].default is False
    assert Settings.model_fields["nutrition_voice_enabled"].default is False
    assert Settings.model_fields["nutrition_ai_daily_drafts"].default == 20


def test_disabled_assistant_status_and_draft_do_not_call_providers(
    client: TestClient,
    assistant_headers: dict[str, str],
    db_session: Session,
    providers: SimpleNamespace,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(settings, "nutrition_ai_enabled", False)
    status = client.get(f"{ROOT}/status", headers=assistant_headers)
    assert status.status_code == 200
    assert status.json() == {"enabled": False, "voice_enabled": False}
    assert status.headers["cache-control"] == "no-store"
    assert client.post(f"{ROOT}/drafts", headers=assistant_headers, json=body()).status_code == 503
    assert db_session.scalar(select(IngestionJob)) is None
    providers.ai.assert_not_awaited()
    providers.nutrition.request.assert_not_called()


@pytest.mark.parametrize("path", ["/status", "/drafts", "/transcriptions"])
def test_basic_subscription_is_blocked(
    client: TestClient, auth_headers: dict[str, str], providers: SimpleNamespace, path: str
) -> None:
    if path == "/status":
        response = client.get(f"{ROOT}{path}", headers=auth_headers)
    elif path == "/drafts":
        response = client.post(f"{ROOT}{path}", headers=auth_headers, json=body())
    else:
        response = client.post(
            f"{ROOT}{path}",
            headers=auth_headers,
            data={"request_id": str(uuid4())},
            files={"audio": ("meal.webm", WEBM, "audio/webm")},
        )
    assert response.status_code == 402
    providers.ai.assert_not_awaited()
    providers.nutrition.request.assert_not_called()
    providers.decoder.assert_not_awaited()
    providers.post.assert_not_awaited()


def test_missing_consent_blocks_text_and_audio_before_processing(
    client: TestClient,
    premium: dict[str, str],
    db_session: Session,
    providers: SimpleNamespace,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(settings, "nutrition_ai_enabled", True)
    assert client.post(f"{ROOT}/drafts", headers=premium, json=body()).status_code == 403
    response = client.post(
        f"{ROOT}/transcriptions",
        headers=premium,
        data={"request_id": str(uuid4())},
        files={"audio": ("meal.webm", WEBM, "audio/webm")},
    )
    assert response.status_code == 403
    assert db_session.scalar(select(IngestionJob)) is None
    providers.ai.assert_not_awaited()
    providers.decoder.assert_not_awaited()
    providers.post.assert_not_awaited()


@pytest.mark.parametrize(
    ("name", "search_term", "found", "expected"),
    [
        pytest.param(
            "eggs",
            "eggs",
            [
                {
                    "food_id": "99",
                    "food_name": "Egg Breakfast Sandwich",
                    "food_type": "Brand",
                    "brand_name": "Jimmy Dean",
                },
                {"food_id": "42", "food_name": "Egg", "food_type": "Generic"},
            ],
            "42",
            id="generic-egg-over-branded-sandwich",
        ),
        pytest.param(
            "chicken breast",
            "chicken breast",
            [
                {
                    "food_id": "99",
                    "food_name": "Chicken Breast Nuggets",
                    "food_type": "Brand",
                    "brand_name": "Tyson",
                },
                {"food_id": "42", "food_name": "Chicken Breast", "food_type": "Generic"},
            ],
            "42",
            id="exact-food-over-branded-prepared-food",
        ),
        pytest.param(
            "rice",
            "rice",
            [
                {
                    "food_id": "99",
                    "food_name": "Licorice",
                    "food_type": "Brand",
                    "brand_name": "Twizzlers",
                },
                {"food_id": "42", "food_name": "White Rice", "food_type": "Generic"},
            ],
            "42",
            id="whole-word-matching-not-substrings",
        ),
        pytest.param(
            "corn flakes",
            "corn flakes",
            [
                {
                    "food_id": "99",
                    "food_name": "Corn Flakes",
                    "food_type": "Brand",
                    "brand_name": "Kellogg's",
                },
                {"food_id": "42", "food_name": "Corn Flakes", "food_type": "Generic"},
            ],
            "42",
            id="generic-tiebreak-without-explicit-brand",
        ),
        pytest.param(
            "Greek yogurt",
            "Greek yogurt",
            [
                {"food_id": "99", "food_name": "Yogurt", "food_type": "Generic"},
                {
                    "food_id": "42",
                    "food_name": "Greek Yogurt",
                    "food_type": "Brand",
                    "brand_name": "Fage",
                },
            ],
            "42",
            id="food-relevance-before-generic-preference",
        ),
        pytest.param(
            "grilled chicken breasts",
            "chicken breast",
            [
                {"food_id": "99", "food_name": "Chicken Breast (Raw)", "food_type": "Generic"},
                {"food_id": "42", "food_name": "Grilled Chicken Breast", "food_type": "Generic"},
            ],
            "42",
            id="grilled-method-preserved-in-name",
        ),
        pytest.param(
            "rice",
            "cooked rice",
            [
                {"food_id": "99", "food_name": "Rice (Raw)", "food_type": "Generic"},
                {
                    "food_id": "42",
                    "food_name": "White Rice (Long-Grain, Cooked)",
                    "food_type": "Generic",
                },
            ],
            "42",
            id="cooked-state-preserved-in-search-term",
        ),
        pytest.param(
            "uncooked white rice",
            "white rice",
            [
                {"food_id": "99", "food_name": "Cooked White Rice", "food_type": "Generic"},
                {"food_id": "42", "food_name": "White Rice (Raw)", "food_type": "Generic"},
            ],
            "42",
            id="explicit-uncooked-means-raw",
        ),
        pytest.param(
            "raw almonds",
            "almonds",
            [
                {"food_id": "99", "food_name": "Roasted Almonds", "food_type": "Generic"},
                {"food_id": "42", "food_name": "Raw Almonds", "food_type": "Generic"},
            ],
            "42",
            id="raw-over-cooked-method",
        ),
        pytest.param(
            "fried chicken breast",
            "chicken breast",
            [
                {"food_id": "99", "food_name": "Grilled Chicken Breast", "food_type": "Generic"},
                {"food_id": "42", "food_name": "Fried Chicken Breast", "food_type": "Generic"},
            ],
            "42",
            id="specific-method-over-other-cooked-method",
        ),
        pytest.param(
            "steamed white rice",
            "cooked white rice",
            [
                {"food_id": "99", "food_name": "Fried White Rice", "food_type": "Generic"},
                {"food_id": "42", "food_name": "Steamed White Rice", "food_type": "Generic"},
            ],
            "42",
            id="specific-method-before-broad-cooked-state",
        ),
        pytest.param(
            "Kellogg's corn flakes",
            "corn flakes",
            [
                {"food_id": "10", "food_name": "Corn Flakes", "food_type": "Generic"},
                {
                    "food_id": "99",
                    "food_name": "Corn Flakes Cereal",
                    "food_type": "Brand",
                    "brand_name": "Quaker",
                },
                {
                    "food_id": "42",
                    "food_name": "Corn Flakes Cereal",
                    "food_type": "Brand",
                    "brand_name": "KELLOGG'S",
                },
            ],
            "42",
            id="explicit-brand-from-name-over-generic-and-wrong-brand",
        ),
        pytest.param(
            "eggs",
            "Eggland's Best eggs",
            [
                {"food_id": "99", "food_name": "Egg", "food_type": "Generic"},
                {
                    "food_id": "42",
                    "food_name": "Large Brown Eggs",
                    "food_type": "Brand",
                    "brand_name": "Eggland's Best",
                },
            ],
            "42",
            id="explicit-brand-from-search-term",
        ),
        pytest.param(
            "cafe yogurt",
            "cafe yogurt",
            [
                {"food_id": "99", "food_name": "Yogurt", "food_type": "Generic"},
                {
                    "food_id": "42",
                    "food_name": "Yogurt",
                    "food_type": "Brand",
                    "brand_name": "Caf\u00e9",
                },
            ],
            "42",
            id="brand-case-and-accent-normalization",
        ),
        pytest.param(
            "eggs",
            "eggs",
            [
                {"food_id": "42", "food_name": "Egg", "food_type": "Generic"},
                {"food_id": "99", "food_name": "Egg", "food_type": "Generic"},
            ],
            "42",
            id="equal-evidence-preserves-provider-order",
        ),
        pytest.param(
            "eggs",
            "eggs",
            [{"food_id": "42", "food_name": None}],
            None,
            id="missing-name-has-no-recommendation",
        ),
        pytest.param(
            "eggs",
            "eggs",
            [
                {"food_id": "99", "food_name": "White Rice", "food_type": "Generic"},
                {
                    "food_id": "42",
                    "food_name": "Corn Flakes",
                    "food_type": "Brand",
                    "brand_name": "Kellogg's",
                },
            ],
            None,
            id="unrelated-results-have-no-recommendation",
        ),
        pytest.param(
            "2% milk",
            "2% milk",
            [
                {"food_id": "99", "food_name": "Milk (1% Fat)", "food_type": "Generic"},
                {"food_id": "42", "food_name": "Milk (2% Fat)", "food_type": "Generic"},
            ],
            "42",
            id="numeric-food-name-preference",
        ),
        pytest.param(
            "Quaker oats",
            "oats",
            [
                {"food_id": "99", "food_name": "Oats", "food_type": "Generic"},
                {
                    "food_id": "42",
                    "food_name": "Quaker Old Fashioned Oats",
                    "food_type": "Brand",
                    "brand_name": "Quaker",
                },
            ],
            "42",
            id="brand-prefix-in-returned-food-name",
        ),
        pytest.param("eggs", "eggs", [], None, id="empty-results-have-no-recommendation"),
    ],
)
def test_recommended_food_uses_preserved_mention_and_search_metadata_without_calls(
    name: str,
    search_term: str,
    found: list[dict[str, Any]],
    expected: str | None,
    providers: SimpleNamespace,
) -> None:
    mention = meal_assistant.FoodMention(
        name=name, search_term=search_term, quantity=None, unit=None
    )
    original = deepcopy(found)
    assert meal_assistant.recommended_food_id(mention, found) == expected
    assert found == original
    providers.ai.assert_not_awaited()
    providers.nutrition.request.assert_not_called()


@pytest.mark.parametrize("singleton", [False, True])
def test_draft_recommends_nonfirst_result_with_identifiers_only_and_no_extra_calls(
    client: TestClient,
    assistant_headers: dict[str, str],
    db_session: Session,
    providers: SimpleNamespace,
    singleton: bool,
) -> None:
    recommended = {
        "food_id": "42",
        "food_name": "Egg (Whole)",
        "food_type": "Generic",
        "food_description": f"{SEARCH_NAME} - Calories: {PROVIDER_CALORIES}",
    }
    found: Any = (
        recommended
        if singleton
        else [
            None,
            "invalid row",
            {"food_id": "invalid", "food_name": "Eggs"},
            {
                "food_id": "99",
                "food_name": "Egg Breakfast Sandwich",
                "food_type": "Brand",
                "brand_name": "Jimmy Dean",
            },
            recommended,
        ]
    )
    providers.nutrition.request.side_effect = [
        {"foods": {"food": found, "page_number": "0", "max_results": "5"}},
        deepcopy(DETAIL),
    ]
    payload = body()
    response = client.post(f"{ROOT}/drafts", headers=assistant_headers, json=payload)
    assert response.status_code == 200, response.text
    assert response.json()["items"][0]["food_id"] == "42"
    assert response.json()["items"][0]["food_name"] == DETAIL_NAME
    assert draft_job(db_session, payload["request_id"]).progress == {
        "fingerprint": hashlib.sha256(DESCRIPTION.encode()).hexdigest(),
        "draft": MENTIONS | {"items": [MENTIONS["items"][0] | {"food_id": "42"}]},
    }
    assert db_session.get(NutritionFood, "42")
    assert db_session.get(NutritionFood, "invalid") is None
    assert_no_saved_meal(db_session)
    providers.ai.assert_awaited_once()
    assert [call.args for call in providers.nutrition.request.call_args_list] == [
        ("foods.search", {"search_expression": "eggs", "page_number": "0", "max_results": "20"}),
        ("food.get.v5", {"food_id": "42"}),
    ]


@pytest.mark.parametrize(
    "invalid_id", [None, "", "abc", "-1", "1.5", 1.5, True, " 42", "1" * 21, "\u0664\u0662"]
)
def test_invalid_search_ids_are_not_recommended_or_indexed(
    client: TestClient,
    assistant_headers: dict[str, str],
    db_session: Session,
    providers: SimpleNamespace,
    invalid_id: Any,
) -> None:
    found = [{"food_id": invalid_id, "food_name": "Egg", "food_type": "Generic"}]
    mention = meal_assistant.FoodMention(**MENTIONS["items"][0])
    assert meal_assistant.recommended_food_id(mention, found) is None
    assert meal_assistant.recommended_food_id(mention, found + SEARCH["foods"]["food"]) == "42"
    providers.nutrition.request.side_effect = None
    providers.nutrition.request.return_value = {"foods": {"food": found}}
    payload = body()
    response = client.post(f"{ROOT}/drafts", headers=assistant_headers, json=payload)
    assert response.status_code == 200, response.text
    assert response.json()["items"] == MENTIONS["items"]
    assert draft_job(db_session, payload["request_id"]).progress["draft"] == MENTIONS
    assert db_session.scalar(select(func.count()).select_from(NutritionFood)) == 0
    providers.nutrition.request.assert_called_once()
    assert_no_saved_meal(db_session)


def test_unrelated_search_results_leave_user_text_without_recommendation_or_detail_call(
    client: TestClient,
    assistant_headers: dict[str, str],
    db_session: Session,
    providers: SimpleNamespace,
) -> None:
    providers.nutrition.request.side_effect = None
    providers.nutrition.request.return_value = {
        "foods": {
            "food": [
                {"food_id": "99", "food_name": "White Rice", "food_type": "Generic"},
                {
                    "food_id": "42",
                    "food_name": "Corn Flakes",
                    "food_type": "Brand",
                    "brand_name": "Kellogg's",
                },
            ]
        },
    }
    payload = body()
    response = client.post(f"{ROOT}/drafts", headers=assistant_headers, json=payload)
    assert response.status_code == 200, response.text
    assert response.json()["items"] == MENTIONS["items"]
    job = draft_job(db_session, payload["request_id"])
    assert job.status == "succeeded" and job.progress["draft"] == MENTIONS
    providers.ai.assert_awaited_once()
    providers.nutrition.request.assert_called_once_with(
        "foods.search", {"search_expression": "eggs", "page_number": "0", "max_results": "20"}
    )
    assert_no_saved_meal(db_session)


@pytest.mark.parametrize(
    ("name", "search", "fallback", "matched_name", "brand"),
    [
        (
            "cheeseburger with pickles", "cheeseburger pickles", "cheeseburger",
            "Cheese Burger", None,
        ),
        ("waffle fries with ketchup", "ketchup", "waffle fries", "Waffle Fries", None),
        (
            "Example Diner cheeseburger with pickles",
            "Example Diner cheeseburger pickles",
            "Example Diner cheeseburger",
            "Cheeseburger",
            "Example Diner",
        ),
        (
            "chicken breast with sauce",
            "Example Kitchen grilled chicken breast with sauce",
            "Example Kitchen grilled chicken breast",
            "Grilled Chicken Breast",
            "Example Kitchen",
        ),
    ],
)
def test_topping_only_results_retry_main_food_and_persist_only_identifiers(
    client: TestClient,
    assistant_headers: dict[str, str],
    db_session: Session,
    providers: SimpleNamespace,
    name: str,
    search: str,
    fallback: str,
    matched_name: str,
    brand: str | None,
) -> None:
    mention = {"name": name, "search_term": search, "quantity": 3, "unit": "each"}
    providers.ai.return_value = ai_output(MENTIONS | {"items": [mention]})
    providers.nutrition.request.side_effect = [
        {"foods": {"food": [{"food_id": "99", "food_name": "Pickles and Ketchup"}]}},
        {"foods": {"food": [{"food_id": "42", "food_name": matched_name, "brand_name": brand}]}},
        deepcopy(DETAIL),
    ]
    payload = body()
    response = client.post(f"{ROOT}/drafts", headers=assistant_headers, json=payload)
    assert response.status_code == 200, response.text
    assert response.json()["items"][0]["food_id"] == "42"
    assert response.json()["items"][0]["name"] == name
    assert draft_job(db_session, payload["request_id"]).progress["draft"] == MENTIONS | {
        "items": [mention | {"food_id": "42"}]
    }
    assert [call.args for call in providers.nutrition.request.call_args_list] == [
        ("foods.search", {"search_expression": search, "page_number": "0", "max_results": "20"}),
        ("foods.search", {"search_expression": fallback, "page_number": "0", "max_results": "20"}),
        ("food.get.v5", {"food_id": "42"}),
    ]
    assert_no_saved_meal(db_session)


def test_fallback_searches_are_limited_per_draft_and_never_choose_only_toppings(
    client: TestClient,
    assistant_headers: dict[str, str],
    db_session: Session,
    providers: SimpleNamespace,
) -> None:
    mentions = [
        {
            "name": f"{food} with ketchup", "search_term": f"{food} ketchup",
            "quantity": 1, "unit": "each",
        }
        for food in ["cheeseburger", "waffle fries", "chicken", "fish", "potatoes"]
    ]
    providers.ai.return_value = ai_output(MENTIONS | {"items": mentions})
    providers.nutrition.request.side_effect = None
    providers.nutrition.request.return_value = {
        "foods": {"food": [{"food_id": "99", "food_name": "Ketchup"}]}
    }
    response = client.post(f"{ROOT}/drafts", headers=assistant_headers, json=body())
    assert response.status_code == 200, response.text
    assert response.json()["items"] == mentions
    searches = providers.nutrition.request.call_args_list
    assert len(searches) == len(mentions) + 3
    assert all(call.args[0] == "foods.search" for call in searches)
    assert [call.args[1]["search_expression"] for call in searches] == [
        "cheeseburger ketchup", "cheeseburger", "waffle fries ketchup", "waffle fries",
        "chicken ketchup", "chicken", "fish ketchup", "potatoes ketchup",
    ]
    assert_no_saved_meal(db_session)


@pytest.mark.parametrize("code", ["rate_limited", "daily_budget_exhausted", "invalid_response"])
def test_failed_initial_search_does_not_attempt_fallback(
    client: TestClient,
    assistant_headers: dict[str, str],
    providers: SimpleNamespace,
    code: str,
) -> None:
    providers.ai.return_value = ai_output(MENTIONS | {"items": [
        {
            "name": "waffle fries with ketchup", "search_term": "waffle fries ketchup",
            "quantity": 1, "unit": "each",
        }
    ]})
    providers.nutrition.request.side_effect = NutritionError(code)
    response = client.post(f"{ROOT}/drafts", headers=assistant_headers, json=body())
    assert response.status_code == 200, response.text
    assert response.json()["items"][0]["lookup_unavailable"] is True
    providers.nutrition.request.assert_called_once()


def test_draft_canceled_after_initial_search_never_performs_fallback(
    client: TestClient,
    assistant_headers: dict[str, str],
    db_session: Session,
    providers: SimpleNamespace,
) -> None:
    providers.ai.return_value = ai_output(MENTIONS | {"items": [
        {
            "name": "waffle fries with ketchup", "search_term": "waffle fries ketchup",
            "quantity": 1, "unit": "each",
        }
    ]})
    payload = body()

    def cancel(method: str, parameters: dict[str, str]) -> dict[str, Any]:
        job = draft_job(db_session, payload["request_id"])
        job.status = "discarded"
        job.progress = {}
        db_session.commit()
        return {"foods": {"food": [{"food_id": "99", "food_name": "Ketchup"}]}}

    providers.nutrition.request.side_effect = cancel
    response = client.post(f"{ROOT}/drafts", headers=assistant_headers, json=payload)
    assert response.status_code == 410, response.text
    providers.nutrition.request.assert_called_once()
    assert draft_job(db_session, payload["request_id"]).progress == {}
    assert_no_saved_meal(db_session)


def test_valid_draft_is_temporary_recommendation_only_and_does_not_save_a_meal(
    client: TestClient,
    assistant_headers: dict[str, str],
    db_session: Session,
    providers: SimpleNamespace,
) -> None:
    payload = body()
    response = client.post(f"{ROOT}/drafts", headers=assistant_headers, json=payload)
    assert response.status_code == 200, response.text
    assert response.headers["cache-control"] == "no-store"
    result = response.json()
    assert result["request_id"] == payload["request_id"]
    assert result["status"] == "ready" and result["temporary"] is True
    assert result["name"] == MENTIONS["name"] and result["meal_label"] == "breakfast"
    assert result["items"][0]["food_id"] == "42"
    assert result["items"][0]["food_name"] == DETAIL_NAME
    assert result["items"][0]["servings"][0]["calories"] == PROVIDER_CALORIES
    assert draft_job(db_session, payload["request_id"]).status == "succeeded"
    assert_no_saved_meal(db_session)
    providers.ai.assert_awaited_once()
    assert [call.args[0] for call in providers.nutrition.request.call_args_list] == [
        "foods.search",
        "food.get.v5",
    ]
    sent = providers.ai.call_args.args[0]
    assert sent["store"] is False
    assert sent["input"][-1] == {"role": "user", "content": DESCRIPTION}
    assert "main food" in sent["input"][0]["content"]
    assert "separately quantified" in sent["input"][0]["content"]
    schema = sent["text"]["format"]
    assert schema["strict"] is True and schema["schema"]["properties"]["items"]["maxItems"] == 10


def test_provider_names_servings_and_macros_never_enter_sql_writes_or_progress(
    client: TestClient,
    assistant_headers: dict[str, str],
    db_session: Session,
) -> None:
    writes: list[str] = []

    def capture(
        connection: Any,
        cursor: Any,
        statement: str,
        parameters: Any,
        context: Any,
        executemany: bool,
    ) -> None:
        if statement.lstrip().upper().startswith(("INSERT", "UPDATE")):
            writes.append(repr(parameters))

    engine = db_session.get_bind()
    event.listen(engine, "before_cursor_execute", capture)
    payload = body()
    try:
        response = client.post(f"{ROOT}/drafts", headers=assistant_headers, json=payload)
        assert response.status_code == 200, response.text
        response = client.get(f"{ROOT}/drafts/{payload['request_id']}", headers=assistant_headers)
        assert response.status_code == 200, response.text
        assert response.json()["items"][0]["food_name"] == DETAIL_NAME
    finally:
        event.remove(engine, "before_cursor_execute", capture)

    progress = draft_job(db_session, payload["request_id"]).progress
    stored = json.dumps(progress)
    assert writes
    for marker in (SEARCH_NAME, DETAIL_NAME, SERVING_NAME, PROVIDER_CALORIES, '"calories"'):
        assert marker not in stored
        assert all(marker not in write for write in writes)
    assert progress["fingerprint"] == hashlib.sha256(DESCRIPTION.encode()).hexdigest()
    assert progress["draft"] == MENTIONS | {"items": [MENTIONS["items"][0] | {"food_id": "42"}]}
    assert db_session.get(NutritionFood, "42")
    assert db_session.get(NutritionServing, ("42", "7"))
    assert_no_saved_meal(db_session)


def test_duplicate_request_runs_ai_and_search_once(
    client: TestClient,
    assistant_headers: dict[str, str],
    db_session: Session,
    providers: SimpleNamespace,
) -> None:
    payload = body()
    first = client.post(f"{ROOT}/drafts", headers=assistant_headers, json=payload)
    second = client.post(f"{ROOT}/drafts", headers=assistant_headers, json=payload)
    assert first.status_code == second.status_code == 200
    assert first.json() == second.json()
    providers.ai.assert_awaited_once()
    searches = [
        call
        for call in providers.nutrition.request.call_args_list
        if call.args[0] == "foods.search"
    ]
    assert len(searches) == 1
    assert db_session.scalar(select(func.count()).select_from(IngestionJob)) == 1


def test_repeated_mentions_share_normalized_search_and_details_without_merging_quantities(
    client: TestClient,
    assistant_headers: dict[str, str],
    db_session: Session,
    providers: SimpleNamespace,
) -> None:
    mentions = [
        MENTIONS["items"][0],
        {"name": "Eggs", "search_term": "  EGGS  ", "quantity": 3, "unit": "each"},
    ]
    providers.ai.return_value = ai_output(MENTIONS | {"items": mentions})
    payload = body()
    response = client.post(f"{ROOT}/drafts", headers=assistant_headers, json=payload)
    assert response.status_code == 200, response.text
    items = response.json()["items"]
    assert [item["quantity"] for item in items] == [2, 3]
    assert [item["food_id"] for item in items] == ["42", "42"]
    assert all(item["servings"][0]["calories"] == PROVIDER_CALORIES for item in items)
    assert [call.args[0] for call in providers.nutrition.request.call_args_list] == [
        "foods.search",
        "food.get.v5",
    ]
    stored = cast(dict[str, Any], draft_job(db_session, payload["request_id"]).progress["draft"])
    stored_items = stored["items"]
    assert [item["quantity"] for item in stored_items] == [2, 3]
    assert_no_saved_meal(db_session)


def test_different_searches_resolving_same_food_share_one_detail_per_draft_view(
    client: TestClient,
    assistant_headers: dict[str, str],
    providers: SimpleNamespace,
) -> None:
    mentions = [
        MENTIONS["items"][0],
        {"name": "large eggs", "search_term": "large eggs", "quantity": 3, "unit": "each"},
    ]
    providers.ai.return_value = ai_output(MENTIONS | {"items": mentions})
    providers.nutrition.request.side_effect = [deepcopy(SEARCH), deepcopy(SEARCH), deepcopy(DETAIL)]
    payload = body()
    response = client.post(f"{ROOT}/drafts", headers=assistant_headers, json=payload)
    assert response.status_code == 200, response.text
    assert [item["food_id"] for item in response.json()["items"]] == ["42", "42"]
    assert [call.args[0] for call in providers.nutrition.request.call_args_list] == [
        "foods.search",
        "foods.search",
        "food.get.v5",
    ]
    providers.nutrition.request.reset_mock(side_effect=True)
    providers.nutrition.request.return_value = deepcopy(DETAIL)
    read = client.get(f"{ROOT}/drafts/{payload['request_id']}", headers=assistant_headers)
    assert read.status_code == 200 and read.json() == response.json()
    providers.nutrition.request.assert_called_once_with("food.get.v5", {"food_id": "42"})


@pytest.mark.parametrize("code", ["rate_limited", "provider_paused", "daily_budget_exhausted"])
def test_provider_backoff_stops_remaining_searches_and_details_in_same_workflow(
    client: TestClient,
    assistant_headers: dict[str, str],
    providers: SimpleNamespace,
    code: str,
) -> None:
    providers.ai.return_value = ai_output(
        MENTIONS
        | {"items": [
            MENTIONS["items"][0],
            {"name": "rice", "search_term": "rice", "quantity": 1, "unit": "cup"},
            {"name": "salmon", "search_term": "salmon", "quantity": 2, "unit": "oz"},
        ]}
    )
    providers.nutrition.request.side_effect = [deepcopy(SEARCH), NutritionError(code, 86400)]
    response = client.post(f"{ROOT}/drafts", headers=assistant_headers, json=body())
    assert response.status_code == 200, response.text
    assert all(item["lookup_unavailable"] for item in response.json()["items"])
    assert [call.args[0] for call in providers.nutrition.request.call_args_list] == [
        "foods.search",
        "foods.search",
    ]


def test_duplicate_food_specific_search_failure_is_not_retried_or_applied_to_other_foods(
    client: TestClient,
    assistant_headers: dict[str, str],
    providers: SimpleNamespace,
) -> None:
    mentions = [
        MENTIONS["items"][0],
        MENTIONS["items"][0] | {"quantity": 3, "search_term": " EGGS "},
        {"name": "rice", "search_term": "rice", "quantity": 1, "unit": "cup"},
    ]
    providers.ai.return_value = ai_output(MENTIONS | {"items": mentions})
    providers.nutrition.request.side_effect = [
        NutritionError("invalid_response"),
        {"foods": {"food": [{"food_id": "42", "food_name": "Rice"}]}},
        deepcopy(DETAIL),
    ]
    response = client.post(f"{ROOT}/drafts", headers=assistant_headers, json=body())
    assert response.status_code == 200, response.text
    items = response.json()["items"]
    assert all(item["lookup_unavailable"] for item in items[:2])
    assert items[2]["food_id"] == "42" and "lookup_unavailable" not in items[2]
    assert [call.args[0] for call in providers.nutrition.request.call_args_list] == [
        "foods.search",
        "foods.search",
        "food.get.v5",
    ]


def test_draft_read_does_not_consume_shared_food_lookup_bucket(
    client: TestClient,
    assistant_headers: dict[str, str],
    db_session: Session,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(time, "time", lambda: 120.1)
    payload = body()
    assert client.post(f"{ROOT}/drafts", headers=assistant_headers, json=payload).status_code == 200
    user = db_session.scalar(select(User))
    assert user
    for _ in range(20):
        auth_rate_limiter.check(f"nutrition:lookup:{user.id}", 20, 60)
    for _ in range(20):
        read = client.get(f"{ROOT}/drafts/{payload['request_id']}", headers=assistant_headers)
        assert read.status_code == 200, read.text
    read = client.get(f"{ROOT}/drafts/{payload['request_id']}", headers=assistant_headers)
    assert read.status_code == 429 and read.json()["detail"]["code"] == "rate_limit"
    assert read.headers["retry-after"] == "60"


def test_same_request_with_different_description_conflicts_without_another_ai_attempt(
    client: TestClient,
    assistant_headers: dict[str, str],
    providers: SimpleNamespace,
) -> None:
    payload = body()
    assert client.post(f"{ROOT}/drafts", headers=assistant_headers, json=payload).status_code == 200
    payload["description"] = "I ate a bowl of rice instead"
    response = client.post(f"{ROOT}/drafts", headers=assistant_headers, json=payload)
    assert response.status_code == 409
    providers.ai.assert_awaited_once()


def test_cross_user_cannot_get_or_discard_draft(
    client: TestClient,
    assistant_headers: dict[str, str],
    db_session: Session,
) -> None:
    payload = body()
    assert client.post(f"{ROOT}/drafts", headers=assistant_headers, json=payload).status_code == 200
    other = User(email="other@example.com", password_hash=str(uuid4()), email_verified=True)
    accept_nutrition_terms(other, FATSECRET_TERMS_VERSION)
    db_session.add(other)
    db_session.flush()
    db_session.add(
        UserSubscription(
            user_id=other.id, plan_key=PREMIUM_PLAN_KEY, status="active", source="waiver_code"
        )
    )
    db_session.commit()
    headers = {"Authorization": f"Bearer {create_access_token(other.id)}"}
    path = f"{ROOT}/drafts/{payload['request_id']}"
    assert client.get(path, headers=headers).status_code == 404
    assert client.delete(path, headers=headers).status_code == 404
    assert draft_job(db_session, payload["request_id"]).status == "succeeded"
    assert client.get(path, headers=assistant_headers).status_code == 200


@pytest.mark.parametrize(
    "changes",
    [
        {"description": ""},
        {"description": "x"},
        {"description": "x" * 4001},
        {"description": None},
        {"request_id": "not-a-uuid"},
        {"request_id": None},
        {"extra": "untrusted field"},
    ],
)
def test_invalid_request_never_reserves_or_dispatches(
    client: TestClient,
    assistant_headers: dict[str, str],
    db_session: Session,
    providers: SimpleNamespace,
    changes: dict[str, Any],
) -> None:
    response = client.post(f"{ROOT}/drafts", headers=assistant_headers, json=body(**changes))
    assert response.status_code == 422, response.text
    assert db_session.scalar(select(IngestionJob)) is None
    providers.ai.assert_not_awaited()
    providers.nutrition.request.assert_not_called()


@pytest.mark.parametrize("method", ["get", "delete"])
def test_invalid_draft_identifier_is_rejected(
    client: TestClient, assistant_headers: dict[str, str], method: str
) -> None:
    response = getattr(client, method)(f"{ROOT}/drafts/not-a-uuid", headers=assistant_headers)
    assert response.status_code == 422


def test_missing_quantity_remains_null_in_response_and_job(
    client: TestClient,
    assistant_headers: dict[str, str],
    db_session: Session,
    providers: SimpleNamespace,
) -> None:
    mentions = deepcopy(MENTIONS)
    mentions["items"][0].update(quantity=None, unit=None)
    providers.ai.return_value = ai_output(mentions)
    payload = body(description="I ate eggs")
    response = client.post(f"{ROOT}/drafts", headers=assistant_headers, json=payload)
    assert response.status_code == 200, response.text
    assert response.json()["items"][0]["quantity"] is None
    assert response.json()["items"][0]["unit"] is None
    stored = cast(dict[str, Any], draft_job(db_session, payload["request_id"]).progress["draft"])
    assert stored["items"][0]["quantity"] is None and stored["items"][0]["unit"] is None


@pytest.mark.parametrize("count", [0, 11])
def test_ai_item_count_outside_one_to_ten_fails_without_nutrition_lookup(
    client: TestClient,
    assistant_headers: dict[str, str],
    providers: SimpleNamespace,
    db_session: Session,
    count: int,
) -> None:
    providers.ai.return_value = ai_output(MENTIONS | {"items": MENTIONS["items"] * count})
    payload = body()
    response = client.post(f"{ROOT}/drafts", headers=assistant_headers, json=payload)
    assert response.status_code == 503
    assert draft_job(db_session, payload["request_id"]).status == "failed"
    providers.nutrition.request.assert_not_called()
    assert_no_saved_meal(db_session)


def test_expired_draft_returns_gone_on_lookup_and_duplicate_without_ai(
    client: TestClient,
    assistant_headers: dict[str, str],
    db_session: Session,
    providers: SimpleNamespace,
) -> None:
    payload = body()
    assert client.post(f"{ROOT}/drafts", headers=assistant_headers, json=payload).status_code == 200
    job = draft_job(db_session, payload["request_id"])
    job.created_at = now() - meal_assistant.DRAFT_TTL - timedelta(seconds=1)
    db_session.commit()
    response = client.get(f"{ROOT}/drafts/{payload['request_id']}", headers=assistant_headers)
    assert response.status_code == 410
    assert client.post(f"{ROOT}/drafts", headers=assistant_headers, json=payload).status_code == 410
    providers.ai.assert_awaited_once()


def test_discard_clears_progress_and_prevents_get_or_duplicate_revival(
    client: TestClient,
    assistant_headers: dict[str, str],
    db_session: Session,
    providers: SimpleNamespace,
) -> None:
    payload = body()
    assert client.post(f"{ROOT}/drafts", headers=assistant_headers, json=payload).status_code == 200
    path = f"{ROOT}/drafts/{payload['request_id']}"
    response = client.delete(path, headers=assistant_headers)
    assert response.status_code == 200 and response.json() == {"discarded": True}
    assert response.headers["cache-control"] == "no-store"
    assert draft_job(db_session, payload["request_id"]).progress == {}
    assert client.get(path, headers=assistant_headers).status_code == 410
    assert client.post(f"{ROOT}/drafts", headers=assistant_headers, json=payload).status_code == 410
    providers.ai.assert_awaited_once()
    assert_no_saved_meal(db_session)


@pytest.mark.parametrize("kind", [meal_assistant.JOB_TYPE, meal_assistant.VOICE_JOB_TYPE])
def test_recent_active_draft_or_transcription_blocks_new_draft(
    client: TestClient,
    assistant_headers: dict[str, str],
    db_session: Session,
    providers: SimpleNamespace,
    kind: str,
) -> None:
    user = db_session.scalar(select(User).where(User.email == "owner@example.com"))
    assert user
    db_session.add(
        IngestionJob(user_id=user.id, job_type=kind, status="running", idempotency_key=str(uuid4()))
    )
    db_session.commit()
    assert client.post(f"{ROOT}/drafts", headers=assistant_headers, json=body()).status_code == 409
    providers.ai.assert_not_awaited()


def test_stale_active_reservation_is_failed_and_replaced(
    client: TestClient,
    assistant_headers: dict[str, str],
    db_session: Session,
) -> None:
    user = db_session.scalar(select(User).where(User.email == "owner@example.com"))
    assert user
    stale = IngestionJob(
        user_id=user.id,
        job_type=meal_assistant.JOB_TYPE,
        status="running",
        idempotency_key=str(uuid4()),
        created_at=now() - timedelta(minutes=3, seconds=1),
    )
    db_session.add(stale)
    db_session.commit()
    response = client.post(f"{ROOT}/drafts", headers=assistant_headers, json=body())
    assert response.status_code == 200, response.text
    db_session.refresh(stale)
    assert stale.status == "failed"


def test_daily_twenty_attempt_limit_counts_failed_and_discarded_jobs(
    client: TestClient,
    assistant_headers: dict[str, str],
    db_session: Session,
    providers: SimpleNamespace,
) -> None:
    user = db_session.scalar(select(User).where(User.email == "owner@example.com"))
    assert user
    db_session.add_all(
        IngestionJob(
            user_id=user.id,
            job_type=meal_assistant.JOB_TYPE,
            status="failed" if index % 2 else "discarded",
            idempotency_key=str(uuid4()),
        )
        for index in range(20)
    )
    db_session.commit()
    assert client.post(f"{ROOT}/drafts", headers=assistant_headers, json=body()).status_code == 429
    providers.ai.assert_not_awaited()


def test_text_dispatch_uses_shared_ai_quota_reservation(
    client: TestClient,
    assistant_headers: dict[str, str],
    db_session: Session,
    providers: SimpleNamespace,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(meal_assistant, "create_response", create_response)
    reserve = Mock(wraps=auth_rate_limiter.reserve)
    monkeypatch.setattr(auth_rate_limiter, "reserve", reserve)
    response = client.post(f"{ROOT}/drafts", headers=assistant_headers, json=body())
    assert response.status_code == 200, response.text
    user = db_session.scalar(select(User).where(User.email == "owner@example.com"))
    assert user
    budgets = [budget for call in reserve.call_args_list for budget in call.args[0]]
    assert ("ai:dispatch:global", settings.ai_daily_dispatch_budget, 86400) in budgets
    assert (f"ai:dispatch:user:{user.id}", settings.ai_premium_daily_attempts, 86400) in budgets
    providers.post.assert_awaited_once()
    assert_no_saved_meal(db_session)


def test_search_provider_failure_leaves_reviewable_user_text_without_saving(
    client: TestClient,
    assistant_headers: dict[str, str],
    db_session: Session,
    providers: SimpleNamespace,
) -> None:
    providers.nutrition.request.side_effect = NutritionError("provider_unavailable")
    response = client.post(f"{ROOT}/drafts", headers=assistant_headers, json=body())
    assert response.status_code == 200, response.text
    assert response.json()["items"][0]["lookup_unavailable"] is True
    assert "food_id" not in response.json()["items"][0]
    assert_no_saved_meal(db_session)


def test_failed_ai_attempt_is_not_retried_or_leaked_for_the_same_request(
    client: TestClient,
    assistant_headers: dict[str, str],
    db_session: Session,
    providers: SimpleNamespace,
) -> None:
    private_error = "PRIVATE_PROVIDER_ERROR_DO_NOT_PERSIST"
    providers.ai.side_effect = RuntimeError(private_error)
    payload = body()
    first = client.post(f"{ROOT}/drafts", headers=assistant_headers, json=payload)
    retry = client.post(f"{ROOT}/drafts", headers=assistant_headers, json=payload)
    assert first.status_code == retry.status_code == 503
    job = draft_job(db_session, payload["request_id"])
    assert job.status == "failed"
    assert private_error not in first.text + retry.text + str(job.error_message)
    assert private_error not in json.dumps(job.progress)
    providers.ai.assert_awaited_once()
    providers.nutrition.request.assert_not_called()
    assert_no_saved_meal(db_session)


def test_audio_missing_file_is_rejected_before_decoder_or_provider(
    client: TestClient,
    assistant_headers: dict[str, str],
    providers: SimpleNamespace,
) -> None:
    response = client.post(
        f"{ROOT}/transcriptions", headers=assistant_headers, data={"request_id": str(uuid4())}
    )
    assert response.status_code == 422
    providers.decoder.assert_not_awaited()
    providers.post.assert_not_awaited()


@pytest.mark.parametrize(
    "content,mime,expected",
    [
        (b"", "audio/webm", 413),
        (b"x" * (meal_voice.MAX_AUDIO_BYTES + 1), "audio/webm", 413),
        (WEBM, "text/html", 422),
        (b"#EXTM3U\nhttp://127.0.0.1/private", "audio/webm", 422),
        (b"<script>alert(1)</script>", "audio/wav", 422),
    ],
)
def test_audio_size_mime_and_magic_validation_precedes_decoding(
    client: TestClient,
    assistant_headers: dict[str, str],
    providers: SimpleNamespace,
    db_session: Session,
    content: bytes,
    mime: str,
    expected: int,
) -> None:
    response = client.post(
        f"{ROOT}/transcriptions",
        headers=assistant_headers,
        data={"request_id": str(uuid4())},
        files={"audio": ("../../malicious.webm", content, mime)},
    )
    assert response.status_code == expected, response.text
    providers.decoder.assert_not_awaited()
    providers.post.assert_not_awaited()
    providers.voice_reserve.assert_not_called()
    assert db_session.scalar(select(IngestionJob)) is None


def test_audio_invalid_request_uuid_is_rejected_before_decoding(
    client: TestClient, assistant_headers: dict[str, str], providers: SimpleNamespace
) -> None:
    response = client.post(
        f"{ROOT}/transcriptions",
        headers=assistant_headers,
        data={"request_id": "not-a-uuid"},
        files={"audio": ("meal.webm", WEBM, "audio/webm")},
    )
    assert response.status_code == 422
    providers.decoder.assert_not_awaited()
    providers.post.assert_not_awaited()


@pytest.mark.parametrize("returncode,pcm", [(1, b"bad"), (0, b""), (0, b"\0" * 1920001)])
def test_failed_empty_or_overlong_decoded_audio_never_reaches_openai(
    client: TestClient,
    assistant_headers: dict[str, str],
    providers: SimpleNamespace,
    db_session: Session,
    returncode: int,
    pcm: bytes,
) -> None:
    providers.process.returncode = returncode
    providers.process.communicate.return_value = (pcm, None)
    request_id = str(uuid4())
    response = client.post(
        f"{ROOT}/transcriptions",
        headers=assistant_headers,
        data={"request_id": request_id},
        files={"audio": ("meal.webm", WEBM, "audio/webm")},
    )
    assert response.status_code == 422
    providers.decoder.assert_awaited_once()
    providers.post.assert_not_awaited()
    assert voice_job(db_session, request_id).status == "failed"


def test_decoder_uses_allowlisted_protocols_and_never_uses_uploaded_filename(
    providers: SimpleNamespace,
) -> None:
    decoded = asyncio.run(meal_voice.normalized_audio(WEBM, "audio/webm;codecs=opus"))
    assert decoded.startswith(b"RIFF") and decoded[8:12] == b"WAVE"
    arguments = providers.decoder.call_args.args
    assert arguments[0] == "prlimit" and "ffmpeg" in arguments
    assert arguments[arguments.index("-protocol_whitelist") + 1] == "file,pipe"
    assert arguments[arguments.index("-f") + 1] == "matroska"
    assert "-nostdin" in arguments and "-vn" in arguments
    assert Path(arguments[arguments.index("-i") + 1]).name.startswith("meal-audio-")


def test_voice_transcript_is_ram_only_duplicate_idempotent_and_uses_shared_quota(
    client: TestClient,
    assistant_headers: dict[str, str],
    db_session: Session,
    providers: SimpleNamespace,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    reserve = Mock(wraps=auth_rate_limiter.reserve)
    monkeypatch.setattr(auth_rate_limiter, "reserve", reserve)
    request_id = str(uuid4())

    async def decode_after_reservation(*args: Any, **kwargs: Any) -> SimpleNamespace:
        job = voice_job(db_session, request_id)
        assert job.status == "running"
        providers.voice_reserve.assert_called_once()
        assert providers.voice_reserve.call_args.args[2:] == (
            request_id,
            hashlib.sha256(WEBM).hexdigest(),
            meal_assistant.VOICE_JOB_TYPE,
        )
        return cast(SimpleNamespace, providers.process)

    providers.decoder.side_effect = decode_after_reservation
    options: dict[str, Any] = {
        "headers": assistant_headers,
        "data": {"request_id": request_id},
        "files": {"audio": ("meal.webm", WEBM, "audio/webm")},
    }
    first = client.post(f"{ROOT}/transcriptions", **options)
    second = client.post(f"{ROOT}/transcriptions", **options)
    assert first.status_code == second.status_code == 200
    assert first.json() == second.json() == {"text": DESCRIPTION}
    assert first.headers["cache-control"] == "no-store"
    providers.post.assert_awaited_once()
    providers.decoder.assert_awaited_once()
    assert providers.voice_reserve.call_count == 2
    job = db_session.scalar(select(IngestionJob))
    assert job and job.status == "succeeded"
    assert job.progress == {"fingerprint": hashlib.sha256(WEBM).hexdigest()}
    assert DESCRIPTION not in json.dumps(job.progress)
    budgets = [budget for call in reserve.call_args_list for budget in call.args[0]]
    assert ("ai:dispatch:global", settings.ai_daily_dispatch_budget, 86400) in budgets
    assert (f"ai:dispatch:user:{job.user_id}", settings.ai_premium_daily_attempts, 86400) in budgets
    assert_no_saved_meal(db_session)


@pytest.mark.parametrize(
    "error", [TimeoutError("fixture timeout"), OSError("fixture decode failure")]
)
def test_audio_decoder_errors_are_validation_errors_and_reap_the_process(
    providers: SimpleNamespace, error: Exception
) -> None:
    providers.process.returncode = None
    providers.process.communicate.side_effect = error
    with pytest.raises(HTTPException) as caught:
        asyncio.run(meal_voice.normalized_audio(WEBM, "audio/webm"))
    assert caught.value.status_code == 422
    providers.process.kill.assert_called_once()
    providers.process.wait.assert_awaited_once()
    providers.post.assert_not_awaited()


@pytest.mark.parametrize("stage", ["receiving", "downstream"])
def test_voice_upload_backlog_rejects_third_request_without_reading_or_queueing(
    providers: SimpleNamespace, stage: str
) -> None:
    async def run() -> None:
        ready = asyncio.Event()
        release = asyncio.Event()
        started = 0
        calls: list[str] = []

        async def hold() -> None:
            nonlocal started
            started += 1
            if started == 2:
                ready.set()
            await release.wait()

        async def receive() -> Message:
            if stage == "receiving":
                await hold()
            return {"type": "http.request", "body": WEBM, "more_body": False}

        async def downstream(scope: Scope, read: Receive, send: Send) -> None:
            calls.append(scope["path"])
            await read()
            if scope["path"].startswith(f"{ROOT}/transcriptions") and stage == "downstream":
                await hold()
            await send({"type": "http.response.start", "status": 200, "headers": []})
            await send({"type": "http.response.body", "body": b"{}"})

        middleware = RequestBodyLimitMiddleware(downstream)
        scope: Scope = {"type": "http", "path": f"{ROOT}/transcriptions", "headers": []}
        first = asyncio.create_task(middleware(scope, receive, AsyncMock()))
        second = asyncio.create_task(middleware(scope, receive, AsyncMock()))
        try:
            await asyncio.wait_for(ready.wait(), timeout=1)
            assert middleware.voice_uploads == 2
            before = list(calls)
            blocked_read, blocked_send = AsyncMock(), AsyncMock()
            await asyncio.wait_for(
                middleware(
                    {**scope, "path": f"{ROOT}/transcriptions/"}, blocked_read, blocked_send
                ),
                timeout=1,
            )
            blocked_read.assert_not_awaited()
            assert calls == before and middleware.voice_uploads == 2
            start = blocked_send.call_args_list[0].args[0]
            assert start["status"] == 503
            assert dict(start["headers"])[b"retry-after"] == b"10"

            # Voice saturation must not block ordinary requests.
            ordinary_send = AsyncMock()
            await middleware(
                {**scope, "path": f"{ROOT}/status"},
                AsyncMock(return_value={"type": "http.request", "body": b""}),
                ordinary_send,
            )
            assert ordinary_send.call_args_list[0].args[0]["status"] == 200
            assert middleware.voice_uploads == 2
        finally:
            release.set()
            await asyncio.gather(first, second)

        assert middleware.voice_uploads == 0
        admitted = AsyncMock()
        await middleware(scope, receive, admitted)
        assert admitted.call_args_list[0].args[0]["status"] == 200
        assert middleware.voice_uploads == 0

    asyncio.run(run())
    providers.voice_reserve.assert_not_called()
    providers.decoder.assert_not_awaited()
    providers.post.assert_not_awaited()


@pytest.mark.parametrize("failure", ["disconnect", "oversized", "downstream_error"])
def test_voice_upload_slot_is_released_after_aborted_or_failed_request(failure: str) -> None:
    async def run() -> None:
        scope: Scope = {"type": "http", "path": f"{ROOT}/transcriptions", "headers": []}
        receive = AsyncMock(return_value={"type": "http.request", "body": WEBM})
        downstream = AsyncMock()
        send = AsyncMock()
        if failure == "disconnect":
            receive.return_value = {"type": "http.disconnect"}
        elif failure == "oversized":
            scope["headers"] = [(b"content-length", b"999999999")]
        else:
            downstream.side_effect = RuntimeError("fixture handler error")
        middleware = RequestBodyLimitMiddleware(downstream)
        if failure == "downstream_error":
            with pytest.raises(RuntimeError, match="fixture handler error"):
                await middleware(scope, receive, send)
        else:
            await middleware(scope, receive, send)
            downstream.assert_not_awaited()
        assert middleware.voice_uploads == 0

    asyncio.run(run())


def test_normalized_audio_rejects_locked_decoder_without_waiting_or_creating_a_file(
    providers: SimpleNamespace, monkeypatch: pytest.MonkeyPatch
) -> None:
    slots = asyncio.Semaphore(0)
    acquire = AsyncMock(wraps=slots.acquire)
    create_file = Mock(side_effect=AssertionError("Busy audio must not create a temporary file"))
    monkeypatch.setattr(slots, "acquire", acquire)
    monkeypatch.setattr(meal_voice, "_decode_slots", slots)
    monkeypatch.setattr(meal_voice, "tempfile", SimpleNamespace(NamedTemporaryFile=create_file))

    async def run() -> None:
        with pytest.raises(HTTPException) as caught:
            await asyncio.wait_for(meal_voice.normalized_audio(WEBM, "audio/webm"), timeout=1)
        assert caught.value.status_code == 503

    asyncio.run(run())
    acquire.assert_not_awaited()
    create_file.assert_not_called()
    providers.decoder.assert_not_awaited()
    providers.post.assert_not_awaited()


def test_busy_decoder_fails_reserved_audio_job_and_duplicate_does_not_retry(
    client: TestClient,
    assistant_headers: dict[str, str],
    db_session: Session,
    providers: SimpleNamespace,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(meal_voice, "_decode_slots", asyncio.Semaphore(0))
    check = Mock(wraps=auth_rate_limiter.check)
    monkeypatch.setattr(auth_rate_limiter, "check", check)
    request_id = str(uuid4())
    assert audio_request(client, assistant_headers, request_id).status_code == 503
    assert voice_job(db_session, request_id).status == "failed"
    assert audio_request(client, assistant_headers, request_id).status_code == 410
    decode_checks = [call for call in check.call_args_list if call.args[0] == DECODE_BUDGET_KEY]
    assert len(decode_checks) == 1
    assert db_session.scalar(select(func.count()).select_from(IngestionJob)) == 1
    providers.decoder.assert_not_awaited()
    providers.post.assert_not_awaited()
    assert meal_voice._transcripts == {}


@pytest.mark.parametrize("budget", [500, 17])
def test_decode_global_daily_quota_precedes_decoder_and_provider_quota_precedes_http(
    client: TestClient,
    assistant_headers: dict[str, str],
    db_session: Session,
    providers: SimpleNamespace,
    monkeypatch: pytest.MonkeyPatch,
    budget: int,
) -> None:
    assert Settings.model_fields["ai_daily_dispatch_budget"].default == 500
    monkeypatch.setattr(settings, "ai_daily_dispatch_budget", budget)
    request_id = str(uuid4())
    order: list[str] = []
    original_check, original_reserve = auth_rate_limiter.check, auth_rate_limiter.reserve

    def check(key: str, limit: int, window: int) -> None:
        if key == DECODE_BUDGET_KEY:
            assert (limit, window) == (budget, 86400)
            assert voice_job(db_session, request_id).status == "running"
            providers.voice_reserve.assert_called_once()
            order.append("decode_quota")
        original_check(key, limit, window)

    def reserve(limits: list[tuple[str, int, int]]) -> None:
        if any(key.startswith("ai:dispatch:") for key, _, _ in limits):
            assert order == ["decode_quota", "decoder"]
            job = voice_job(db_session, request_id)
            assert ("ai:dispatch:global", budget, 86400) in limits
            assert (
                f"ai:dispatch:user:{job.user_id}",
                settings.ai_premium_daily_attempts,
                86400,
            ) in limits
            order.append("provider_quota")
        original_reserve(limits)

    async def decode(*args: Any, **kwargs: Any) -> SimpleNamespace:
        assert order == ["decode_quota"]
        order.append("decoder")
        return cast(SimpleNamespace, providers.process)

    response = providers.post.return_value

    async def post(*args: Any, **kwargs: Any) -> httpx.Response:
        assert order == ["decode_quota", "decoder", "provider_quota"]
        order.append("provider_http")
        return cast(httpx.Response, response)

    monkeypatch.setattr(auth_rate_limiter, "check", check)
    monkeypatch.setattr(auth_rate_limiter, "reserve", reserve)
    providers.decoder.side_effect = decode
    providers.post.side_effect = post
    result = audio_request(client, assistant_headers, request_id)
    assert result.status_code == 200, result.text
    assert order == ["decode_quota", "decoder", "provider_quota", "provider_http"]
    assert voice_job(db_session, request_id).status == "succeeded"


def test_exhausted_global_decode_budget_marks_job_failed_without_decoder_or_provider(
    client: TestClient,
    assistant_headers: dict[str, str],
    db_session: Session,
    providers: SimpleNamespace,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(settings, "ai_daily_dispatch_budget", 1)
    auth_rate_limiter.check(DECODE_BUDGET_KEY, 1, 86400)
    request_id = str(uuid4())
    result = audio_request(client, assistant_headers, request_id)
    assert result.status_code == 429, result.text
    assert int(result.headers["retry-after"]) > 0
    assert voice_job(db_session, request_id).status == "failed"
    assert audio_request(client, assistant_headers, request_id).status_code == 410
    assert db_session.scalar(select(func.count()).select_from(IngestionJob)) == 1
    providers.decoder.assert_not_awaited()
    providers.post.assert_not_awaited()
    assert meal_voice._transcripts == {}


@pytest.mark.parametrize("quota", ["global", "user"])
def test_exhausted_provider_quota_marks_audio_job_failed_before_openai_http(
    client: TestClient,
    assistant_headers: dict[str, str],
    db_session: Session,
    providers: SimpleNamespace,
    monkeypatch: pytest.MonkeyPatch,
    quota: str,
) -> None:
    user = db_session.scalar(select(User).where(User.email == "owner@example.com"))
    assert user
    if quota == "global":
        monkeypatch.setattr(settings, "ai_daily_dispatch_budget", 1)
        key = "ai:dispatch:global"
    else:
        monkeypatch.setattr(settings, "ai_premium_daily_attempts", 1)
        key = f"ai:dispatch:user:{user.id}"
    auth_rate_limiter.check(key, 1, 86400)
    request_id = str(uuid4())
    result = audio_request(client, assistant_headers, request_id)
    assert result.status_code == 429, result.text
    assert int(result.headers["retry-after"]) > 0
    assert voice_job(db_session, request_id).status == "failed"
    providers.decoder.assert_awaited_once()
    providers.post.assert_not_awaited()
    assert meal_voice._transcripts == {}


def test_same_audio_request_with_changed_hash_conflicts_before_second_decode(
    client: TestClient,
    assistant_headers: dict[str, str],
    db_session: Session,
    providers: SimpleNamespace,
) -> None:
    request_id = str(uuid4())
    assert audio_request(client, assistant_headers, request_id).status_code == 200
    changed = audio_request(client, assistant_headers, request_id, WEBM + b"changed")
    assert changed.status_code == 409
    assert voice_job(db_session, request_id).status == "succeeded"
    assert db_session.scalar(select(func.count()).select_from(IngestionJob)) == 1
    providers.decoder.assert_awaited_once()
    providers.post.assert_awaited_once()


def test_pending_audio_duplicate_returns_conflict_without_decoding_or_provider(
    client: TestClient,
    assistant_headers: dict[str, str],
    db_session: Session,
    providers: SimpleNamespace,
) -> None:
    user = db_session.scalar(select(User).where(User.email == "owner@example.com"))
    assert user
    request_id = str(uuid4())
    db_session.add(
        IngestionJob(
            user_id=user.id,
            job_type=meal_assistant.VOICE_JOB_TYPE,
            status="running",
            idempotency_key=request_id,
            progress={"fingerprint": hashlib.sha256(WEBM).hexdigest()},
        )
    )
    db_session.commit()
    result = audio_request(client, assistant_headers, request_id)
    assert result.status_code == 409
    assert voice_job(db_session, request_id).status == "running"
    assert db_session.scalar(select(func.count()).select_from(IngestionJob)) == 1
    providers.decoder.assert_not_awaited()
    providers.post.assert_not_awaited()
