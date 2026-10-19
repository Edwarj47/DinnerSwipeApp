from __future__ import annotations

import time
from concurrent.futures import ThreadPoolExecutor
from datetime import timedelta
from unittest.mock import Mock
from urllib.parse import parse_qs
from uuid import uuid4

import httpx
import pytest
from fastapi.testclient import TestClient
from sqlalchemy import func, select
from sqlalchemy.orm import Session, sessionmaker

from app.api.routes import nutrition as routes
from app.core.actor import RequestActor, acting_as
from app.core.config import Settings
from app.models.entities import User, UserSubscription
from app.models.nutrition import (
    NutritionCall,
    NutritionFood,
    NutritionProviderState,
    NutritionServing,
    NutritionUsage,
)
from app.services import nutrition as service
from app.services.billing import PREMIUM_PLAN_KEY
from app.services.fatsecret import API_URL, TOKEN_URL, FatSecretClient
from app.services.nutrition_budget import NutritionBudget, NutritionError, utcnow
from app.services.nutrition_cache import TemporaryNutritionCache
from app.services.nutrition_consent import FATSECRET_TERMS_VERSION, accept_nutrition_terms

FOOD = {
    "food": {
        "food_id": "42",
        "food_name": "Test food",
        "servings": {
            "serving": {
                "serving_id": "7",
                "calories": "100",
                "protein": "8",
                "serving_description": "1 cup",
            }
        },
    }
}


@pytest.fixture()
def provider(db_session: Session, monkeypatch: pytest.MonkeyPatch) -> FatSecretClient:
    db_session.add(NutritionProviderState(provider="fatsecret"))
    db_session.commit()
    config = Settings(
        fatsecret_enabled=True,
        fatsecret_client_id="test-client",
        fatsecret_client_secret=str(uuid4()),
        fatsecret_daily_budget=20,
        fatsecret_background_budget=5,
    )
    config.fatsecret_min_interval_seconds = 0  # Disable pacing only inside this fixture.
    sessions = sessionmaker(bind=db_session.get_bind(), autoflush=False)
    client = FatSecretClient(config, NutritionBudget(sessions, config))

    def response(request: httpx.Request) -> httpx.Response:
        assert request.method == "POST"
        if str(request.url) == TOKEN_URL:
            assert parse_qs(request.content.decode())["scope"] == ["basic"]
            return httpx.Response(200, json={"access_token": "fixture-token", "expires_in": 3600})
        assert (
            str(request.url) == API_URL
            and request.headers["Authorization"] == "Bearer fixture-token"
        )
        method = parse_qs(request.content.decode())["method"][0]
        return httpx.Response(
            200,
            json=FOOD
            if method == "food.get.v5"
            else {"foods": {"food": {"food_id": "42", "food_name": "Test food"}}},
        )

    client.http = httpx.Client(transport=httpx.MockTransport(response))
    monkeypatch.setattr(routes, "nutrition_client", client)
    monkeypatch.setattr(routes, "nutrition_budget", client.budget)
    return client


@pytest.fixture()
def authorized_nutrition(auth_headers: dict[str, str], db_session: Session) -> dict[str, str]:
    user = db_session.query(User).filter_by(email="owner@example.com").one()
    subscription = db_session.query(UserSubscription).filter_by(user_id=user.id).one()
    subscription.plan_key = PREMIUM_PLAN_KEY
    accept_nutrition_terms(user, FATSECRET_TERMS_VERSION)
    db_session.commit()
    return auth_headers


def test_lookup_cache_identifier_only_and_usage_idempotency(
    client: TestClient,
    db_session: Session,
    authorized_nutrition: dict[str, str],
    provider: FatSecretClient,
) -> None:
    auth_headers = authorized_nutrition
    result = client.get("/api/v1/nutrition/foods/42", headers=auth_headers)
    assert result.status_code == 200 and result.headers["cache-control"] == "no-store"
    assert result.json()["data"]["food"]["servings"]["serving"]["calories"] == "100"
    assert result.json()["attribution"]["name"] == "Powered by fatsecret"
    assert client.get("/api/v1/nutrition/foods/42", headers=auth_headers).status_code == 200
    assert db_session.scalar(select(func.count()).select_from(NutritionCall)) == 2
    assert set(NutritionFood.__table__.columns.keys()) == {
        "food_id",
        "first_seen_at",
        "last_seen_at",
        "last_refreshed_at",
    }
    assert set(NutritionServing.__table__.columns.keys()) == {"food_id", "serving_id"}
    payload = {"food_id": "42", "serving_id": "7", "portions": 0.5, "request_id": str(uuid4())}
    first = client.post("/api/v1/nutrition/usage", headers=auth_headers, json=payload)
    second = client.post("/api/v1/nutrition/usage", headers=auth_headers, json=payload)
    assert first.status_code == 200 and first.json() == second.json()
    assert db_session.scalar(select(func.count()).select_from(NutritionUsage)) == 1
    payload["portions"] = 2
    assert (
        client.post("/api/v1/nutrition/usage", headers=auth_headers, json=payload).status_code
        == 409
    )


def test_search_validation_auth_and_singleton_results(
    client: TestClient,
    db_session: Session,
    authorized_nutrition: dict[str, str],
    provider: FatSecretClient,
) -> None:
    auth_headers = authorized_nutrition
    assert client.get("/api/v1/nutrition/foods/search?query=rice").status_code == 401
    result = client.get("/api/v1/nutrition/foods/search?query=rice", headers=auth_headers)
    assert result.status_code == 200 and db_session.get(NutritionFood, "42")
    for query in ("", "x", "  "):
        assert (
            client.get(
                "/api/v1/nutrition/foods/search", headers=auth_headers, params={"query": query}
            ).status_code
            == 422
        )
    assert client.get("/api/v1/nutrition/foods/invalid", headers=auth_headers).status_code == 422
    assert (
        client.post(
            "/api/v1/nutrition/usage",
            headers=auth_headers,
            json={"food_id": "42", "serving_id": "999", "request_id": str(uuid4())},
        ).status_code
        == 422
    )


def test_search_and_details_keep_shared_twenty_request_limit(
    client: TestClient,
    db_session: Session,
    authorized_nutrition: dict[str, str],
    provider: FatSecretClient,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(time, "time", lambda: 120.1)
    for _ in range(19):
        assert (
            client.get("/api/v1/nutrition/foods/42", headers=authorized_nutrition).status_code
            == 200
        )
    assert (
        client.get(
            "/api/v1/nutrition/foods/search?query=rice", headers=authorized_nutrition
        ).status_code
        == 200
    )
    calls = db_session.scalar(select(func.count()).select_from(NutritionCall))
    assert calls == 3  # OAuth, one detail, one search; repeats use RAM cache.
    response = client.get("/api/v1/nutrition/foods/42", headers=authorized_nutrition)
    assert response.status_code == 429
    assert response.json()["detail"]["code"] == "rate_limit"
    assert "database lookup" in response.json()["detail"]["message"]
    assert response.json()["detail"]["retry_after_seconds"] == 60
    assert response.headers["retry-after"] == "60"
    assert response.headers["cache-control"] == "no-store"
    assert db_session.scalar(select(func.count()).select_from(NutritionCall)) == calls


def test_search_details_and_oauth_reserve_for_authenticated_route_user(
    client: TestClient,
    db_session: Session,
    authorized_nutrition: dict[str, str],
    provider: FatSecretClient,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    user = db_session.scalar(select(User))
    assert user
    reserve = Mock(wraps=provider.budget.reserve)
    monkeypatch.setattr(provider.budget, "reserve", reserve)
    for url in (
        "/api/v1/nutrition/foods/search?query=rice",
        "/api/v1/nutrition/foods/42",
        "/api/v1/nutrition/foods/42",
    ):
        response = client.get(url, headers=authorized_nutrition)
        assert response.status_code == 200, response.text
    assert [call.args[0] for call in reserve.call_args_list] == [
        "oauth", "foods.search", "food.get.v5",
    ]
    assert all(call.kwargs["user_id"] == user.id for call in reserve.call_args_list)
    calls = db_session.scalars(select(NutritionCall)).all()
    assert len(calls) == 3 and all(call.user_id == user.id for call in calls)


@pytest.mark.parametrize(
    ("cached_url", "uncached_url"),
    [
        ("/api/v1/nutrition/foods/42", "/api/v1/nutrition/foods/search?query=rice"),
        ("/api/v1/nutrition/foods/search?query=rice", "/api/v1/nutrition/foods/42"),
    ],
)
def test_route_user_daily_budget_stops_call_101_but_keeps_cache_hits_free(
    client: TestClient,
    db_session: Session,
    authorized_nutrition: dict[str, str],
    provider: FatSecretClient,
    cached_url: str,
    uncached_url: str,
) -> None:
    user = db_session.scalar(select(User))
    assert user
    provider.config.fatsecret_daily_budget = 1000
    assert provider.config.fatsecret_user_daily_budget == 100
    provider.token = "fixture-token"
    provider.token_until = float("inf")
    db_session.add_all(
        NutritionCall(
            user_id=user.id,
            reserved_at=utcnow() - timedelta(minutes=1),
            background=0,
            kind="food.get.v5",
            outcome="success",
        )
        for _ in range(99)
    )
    db_session.commit()
    assert client.get(cached_url, headers=authorized_nutrition).status_code == 200
    rejected = client.get(uncached_url, headers=authorized_nutrition)
    assert rejected.status_code == 429, rejected.text
    assert rejected.json()["detail"]["code"] == "account_budget_exhausted"
    assert rejected.headers["retry-after"] == "3600"
    assert client.get(cached_url, headers=authorized_nutrition).status_code == 200
    calls = db_session.scalars(select(NutritionCall)).all()
    assert len(calls) == 100 and all(call.user_id == user.id for call in calls)
    assert provider.config.fatsecret_daily_budget == 1000
    assert provider.budget.status()["remaining"] == 900


@pytest.mark.parametrize(
    ("code", "status", "retry", "message"),
    [
        ("account_budget_exhausted", 429, 3600, "Your daily nutrition"),
        ("daily_budget_exhausted", 429, 3600, "The daily nutrition"),
        ("rate_limited", 503, 172800, "provider has paused"),
        ("provider_paused", 503, 86399, "after the cooldown"),
    ],
)
def test_lookup_errors_distinguish_local_limits_from_provider_budgets_and_backoff(
    client: TestClient,
    authorized_nutrition: dict[str, str],
    provider: FatSecretClient,
    monkeypatch: pytest.MonkeyPatch,
    code: str,
    status: int,
    retry: int,
    message: str,
) -> None:
    def fail(method: str, parameters: dict[str, str]) -> dict[str, object]:
        raise NutritionError(code, retry)

    monkeypatch.setattr(provider, "request", fail)
    response = client.get("/api/v1/nutrition/foods/42", headers=authorized_nutrition)
    assert response.status_code == status
    assert response.json()["detail"]["code"] == code
    assert message in response.json()["detail"]["message"]
    assert response.json()["detail"]["retry_after_seconds"] == retry
    assert response.headers["retry-after"] == str(retry)
    assert response.headers["cache-control"] == "no-store"


def test_quota_counts_authentication_and_never_refunds_failures(provider: FatSecretClient) -> None:
    provider.config.fatsecret_daily_budget = 1
    with pytest.raises(NutritionError, match="daily_budget_exhausted"):
        provider.request("food.get.v5", {"food_id": "42"})
    assert provider.budget.status()["rolling_24h_calls"] == 1
    provider.config.fatsecret_daily_budget = 2
    provider.http = httpx.Client(transport=httpx.MockTransport(lambda request: httpx.Response(500)))
    with pytest.raises(NutritionError, match="provider_unavailable"):
        provider.request("food.get.v5", {"food_id": "42"})
    assert provider.budget.status()["remaining"] == 0


def test_concurrent_duplicate_lookups_share_one_reserved_provider_request(
    provider: FatSecretClient, db_session: Session
) -> None:
    def request(_: int) -> dict[str, object]:
        with acting_as(RequestActor("test-provider-account", True, True)):
            return provider.request("food.get.v5", {"food_id": "42"})

    with ThreadPoolExecutor(max_workers=6) as pool:
        results = list(pool.map(request, range(12)))
    assert results == [FOOD] * 12
    assert db_session.scalar(select(func.count()).select_from(NutritionCall)) == 2


def test_background_quota_preserves_foreground_allowance(provider: FatSecretClient) -> None:
    provider.config.fatsecret_background_budget = 1
    provider.budget.reserve("oauth", background=True)
    with pytest.raises(NutritionError, match="background_budget_exhausted"):
        provider.budget.reserve("food.get.v5", background=True)
    assert provider.budget.reserve("foods.search")


def test_disabled_provider_makes_no_authentication_call(provider: FatSecretClient) -> None:
    provider.config.fatsecret_enabled = False
    with pytest.raises(NutritionError, match="not_configured"):
        provider._authenticate(background=True)
    assert provider.budget.status()["rolling_24h_calls"] == 0


def test_retry_after_longer_than_one_day_is_respected(provider: FatSecretClient) -> None:
    provider.token = "fixture-token"
    provider.token_until = float("inf")
    provider.http = httpx.Client(
        transport=httpx.MockTransport(
            lambda request: httpx.Response(429, headers={"Retry-After": "172800"})
        )
    )
    with pytest.raises(NutritionError) as error:
        provider.request("food.get.v5", {"food_id": "42"})
    assert error.value.retry_seconds == 172800


def test_rolling_day_does_not_reset_at_midnight(
    provider: FatSecretClient, db_session: Session
) -> None:
    provider.config.fatsecret_daily_budget = 1
    db_session.add(
        NutritionCall(
            reserved_at=utcnow() - timedelta(hours=1),
            background=0,
            kind="foods.search",
            outcome="success",
        )
    )
    db_session.commit()
    with pytest.raises(NutritionError, match="daily_budget_exhausted"):
        provider.budget.reserve("food.get.v5")


@pytest.mark.parametrize(
    "status,payload,code",
    [
        (429, {}, "rate_limited"),
        (403, {}, "credentials_or_scope"),
        (
            200,
            {"error": {"code": 14, "message": "Sensitive provider text"}},
            "missing_scope",
        ),
        (200, {"error": {"code": 21, "message": "Sensitive provider text"}}, "ip_not_authorized"),
        (200, {"error": {"code": 11, "message": "Sensitive provider text"}}, "rate_limited"),
        (200, {"error": {"code": 12, "message": "Sensitive provider text"}}, "rate_limited"),
        (
            200,
            {"error": {"code": 20, "message": "Sensitive provider text"}},
            "provider_unavailable",
        ),
    ],
)
def test_provider_errors_pause_without_content_leak(
    provider: FatSecretClient, status: int, payload: dict[str, object], code: str
) -> None:
    provider.token = "fixture-token"
    provider.token_until = float("inf")
    provider.http = httpx.Client(
        transport=httpx.MockTransport(lambda request: httpx.Response(status, json=payload))
    )
    with pytest.raises(NutritionError, match=code) as error:
        provider.request("food.get.v5", {"food_id": "42"})
    assert "Sensitive" not in str(error.value)
    with pytest.raises(NutritionError, match="provider_paused"):
        provider.budget.reserve("foods.search")
    assert provider.budget.status()["rolling_24h_calls"] == 1
    assert provider.budget.status()["block_reason"] == code
    if code == "rate_limited":
        assert error.value.retry_seconds >= 86400


def test_cache_expiry_never_serves_stale_and_is_bounded() -> None:
    cache = TemporaryNutritionCache(max_bytes=100, max_entries=1)
    cache.put("first", FOOD, lifetime=60)
    assert not cache.entries  # Oversized response is not retained.
    cache.put("first", {"food_name": "Test"}, lifetime=60)
    cache.put("second", {"food_name": "Other"}, lifetime=60)
    assert cache.get("first") is None and cache.get("second")
    with cache.lock:
        _, wall, payload = cache.entries["second"]
        cache.entries["second"] = (0, wall, payload)
    assert cache.get("second") is None and not cache.entries
    cache.put("wall-clock", {"food_name": "Other"}, lifetime=60)
    with cache.lock:
        monotonic, _, payload = cache.entries["wall-clock"]
        cache.entries["wall-clock"] = (monotonic, 0, payload)
    assert cache.get("wall-clock") is None


def test_refresh_only_used_identifiers_once_per_day(
    provider: FatSecretClient,
    db_session: Session,
    authorized_nutrition: dict[str, str],
    client: TestClient,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    auth_headers = authorized_nutrition
    client.get("/api/v1/nutrition/foods/42", headers=auth_headers)
    client.post(
        "/api/v1/nutrition/usage",
        headers=auth_headers,
        json={"food_id": "42", "serving_id": "7", "request_id": str(uuid4())},
    )
    food = db_session.get(NutritionFood, "42")
    assert food
    food.last_refreshed_at = utcnow() - timedelta(days=2)
    db_session.add(NutritionFood(food_id="999", first_seen_at=utcnow(), last_seen_at=utcnow()))
    db_session.commit()
    monkeypatch.setattr(service, "settings", provider.config)
    monkeypatch.setattr(service, "SessionLocal", sessionmaker(bind=db_session.get_bind()))
    provider.config.fatsecret_refresh_enabled = True
    result = service.refresh_used_foods(provider)
    assert result["status"] == "complete" and result["refreshed"] == 1
    assert service.refresh_used_foods(provider)["status"] == "already_claimed"
    assert db_session.get(NutritionFood, "999").last_refreshed_at is None  # type: ignore[union-attr]


def test_cache_and_budget_settings_cannot_exceed_safety_ceiling() -> None:
    for value in ({"fatsecret_cache_seconds": 86401}, {"fatsecret_daily_budget": 5000}):
        with pytest.raises(ValueError):
            Settings.model_validate(value)
