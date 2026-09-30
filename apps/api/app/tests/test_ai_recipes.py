from __future__ import annotations

from datetime import timedelta
from typing import cast
from uuid import uuid4

import httpx
import pytest
from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from app.core.config import settings
from app.models.entities import IngestionJob, Recipe, User, UserSubscription
from app.services import ai_recipes as service

DRAFT = service.RecipeDraft(
    name="Roasted carrots",
    description="Simple roasted carrots",
    servings=2,
    prep_minutes=5,
    cook_minutes=20,
    total_minutes=25,
    difficulty="easy",
    meal_type="dinner",
    ingredients=["2 carrots", "1 tablespoon olive oil"],
    instructions=["Slice carrots.", "Toss with oil and roast at 400 F for 20 minutes."],
    review_notes=["Check the timing for your oven."],
)


@pytest.fixture(autouse=True)
def fake_ai(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(settings, "ai_recipe_enabled", True)
    monkeypatch.setattr(settings, "openai_api_key", "test-key-not-real")

    async def generate(*args: object) -> service.RecipeDraft:
        return DRAFT

    monkeypatch.setattr(service, "generate", generate)


def submit(
    client: TestClient, headers: dict[str, str], request_id: str | None = None
) -> httpx.Response:
    return cast(
        httpx.Response,
        client.post(
            "/api/v1/ai-recipes",
            headers=headers,
            data={"request_id": request_id or str(uuid4()), "description": "Roast carrots"},
        ),
    )


def test_basic_three_drafts_even_after_discard_and_duplicate_retry(
    client: TestClient,
    auth_headers: dict[str, str],
    db_session: Session,
) -> None:
    request_id = str(uuid4())
    first = submit(client, auth_headers, request_id)
    assert first.status_code == 200, first.text
    assert first.json()["draft"]["ingredients"] == DRAFT.ingredients
    assert submit(client, auth_headers, request_id).json()["id"] == first.json()["id"]
    assert db_session.query(Recipe).count() == 0
    discarded = client.post(
        f"/api/v1/ai-recipes/{first.json()['id']}/discard", headers=auth_headers
    )
    assert discarded.status_code == 200
    assert submit(client, auth_headers).status_code == 200
    assert submit(client, auth_headers).status_code == 200
    assert submit(client, auth_headers).status_code == 429
    assert client.get("/api/v1/ai-recipes/usage", headers=auth_headers).json()["remaining"] == 0
    assert len(client.get("/api/v1/ai-recipes", headers=auth_headers).json()) == 2
    activity = client.get("/api/v1/auth/account/export", headers=auth_headers).json()[
        "ai_recipe_activity"
    ]
    assert len(activity) == 3
    assert activity[0]["draft"] is None


def test_premium_unlimited_monthly_and_new_month_resets_basic(
    client: TestClient,
    auth_headers: dict[str, str],
    db_session: Session,
) -> None:
    user = db_session.query(User).one()
    sub = db_session.query(UserSubscription).one()
    sub.plan_key = "macro_tracker_monthly"
    db_session.commit()
    for _ in range(4):
        assert submit(client, auth_headers).status_code == 200
    assert client.get("/api/v1/ai-recipes/usage", headers=auth_headers).json()["limit"] is None
    for job in db_session.query(IngestionJob).all():
        job.created_at = service.month_bounds()[0] - timedelta(seconds=1)
    sub.plan_key = "basic_monthly"
    db_session.commit()
    assert service.usage(db_session, user)["remaining"] == 3


def test_failed_provider_no_charge_and_invalid_images_not_sent(
    client: TestClient,
    auth_headers: dict[str, str],
    db_session: Session,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    async def fail(*args: object) -> service.RecipeDraft:
        raise ValueError("private provider details must never be exposed")

    monkeypatch.setattr(service, "generate", fail)
    result = submit(client, auth_headers)
    assert result.status_code == 502
    assert "private provider" not in result.text
    assert client.get("/api/v1/ai-recipes/usage", headers=auth_headers).json()["used"] == 0
    result = client.post(
        "/api/v1/ai-recipes",
        headers=auth_headers,
        data={"request_id": str(uuid4())},
        files={"image": ("x.png", b"not-image", "image/png")},
    )
    assert result.status_code == 400
    assert db_session.query(IngestionJob).count() == 1


def test_approve_once_and_no_restore_after_discard(
    client: TestClient,
    auth_headers: dict[str, str],
    db_session: Session,
) -> None:
    job_id = submit(client, auth_headers).json()["id"]
    payload = {
        "name": "Edited carrots",
        "servings": 2,
        "total_minutes": 25,
        "ingredients": [{"original_text": "2 carrots"}],
        "instructions": [{"step_number": 1, "text": "Roast carrots."}],
        "accept_placeholder_photo": True,
    }
    for _ in range(2):
        approved = client.post(
            f"/api/v1/ai-recipes/{job_id}/approve", json=payload, headers=auth_headers
        )
        assert approved.status_code == 200, approved.text
    assert db_session.query(Recipe).count() == 1
    assert db_session.query(Recipe).one().source_type == "ai_assisted"
    job_id = submit(client, auth_headers).json()["id"]
    client.post(f"/api/v1/ai-recipes/{job_id}/discard", headers=auth_headers)
    assert (
        client.post(
            f"/api/v1/ai-recipes/{job_id}/approve", json=payload, headers=auth_headers
        ).status_code
        == 409
    )


def test_auth_ownership_and_inflight_reservation(
    client: TestClient,
    auth_headers: dict[str, str],
    db_session: Session,
) -> None:
    assert client.get("/api/v1/ai-recipes/usage").status_code == 401
    user = db_session.query(User).one()
    job, _ = service.reserve(db_session, user, str(uuid4()))
    assert submit(client, auth_headers).status_code == 409
    job.created_at = service.now() - timedelta(minutes=4)
    db_session.commit()
    assert submit(client, auth_headers).status_code == 200
    stale = db_session.get(IngestionJob, job.id)
    assert stale is not None and stale.status == "failed"
    other = User(email="other@example.com", password_hash=user.password_hash)
    db_session.add(other)
    db_session.flush()
    private_job = IngestionJob(
        user_id=other.id, job_type="ai_recipe", status="succeeded", progress={}
    )
    db_session.add(private_job)
    db_session.commit()
    assert (
        client.post(
            f"/api/v1/ai-recipes/{private_job.id}/discard", headers=auth_headers
        ).status_code
        == 404
    )
    sub = db_session.query(UserSubscription).one()
    sub.status = "canceled"
    db_session.commit()
    assert client.get("/api/v1/ai-recipes/usage", headers=auth_headers).status_code == 402
