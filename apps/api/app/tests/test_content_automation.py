from __future__ import annotations

import copy
import json
import runpy
from datetime import UTC, date, datetime, timedelta
from io import BytesIO
from pathlib import Path
from typing import Any
from uuid import uuid4

import pytest
from alembic.migration import MigrationContext
from alembic.operations import Operations
from fastapi import HTTPException
from fastapi.testclient import TestClient
from PIL import Image
from sqlalchemy import create_engine, func, insert, inspect, select, text
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.core.config import settings
from app.core.rate_limit import auth_rate_limiter
from app.models.base import Base
from app.models.content_automation import ContentCampaign, ContentCandidate, ContentDailyBatch
from app.models.entities import (
    AuditEvent,
    Household,
    HouseholdMember,
    HouseholdRecipe,
    MealMacroConfirmation,
    Recipe,
    RecipeMacroProfile,
    RecipeSource,
    User,
    UserSubscription,
    WeeklyPlan,
    WeeklyPlanSlot,
)
from app.models.security import MediaObject
from app.models.workouts import (
    WorkoutLog,
    WorkoutPlan,
    WorkoutPlanSlot,
    WorkoutTemplate,
    WorkoutTemplateShare,
)
from app.schemas.common import RecipeCreate
from app.schemas.content_automation import Candidate as CandidateOut
from app.schemas.content_automation import Kind
from app.schemas.workouts import TemplateInput
from app.services import content_automation as service
from app.services import media_maintenance, private_media, recipes, workouts
from app.services.media_storage import LocalMediaStorageAdapter
from app.services.photo_credit import MODIFICATIONS, SHARE_ALIKE

ROOT = "/api/v1/content-automation"
START = date(2026, 10, 16)
NOW = datetime(2026, 10, 16, 12, tzinfo=UTC)


@pytest.fixture
def owner(auth_headers: dict[str, str], db_session: Session) -> User:
    return db_session.scalars(select(User).where(User.email == "owner@example.com")).one()


@pytest.fixture
def photo(owner: User, db_session: Session, tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> str:
    storage = LocalMediaStorageAdapter(tmp_path, settings.public_api_url)
    monkeypatch.setattr(private_media, "get_media_storage", lambda: storage)
    image = BytesIO()
    Image.new("RGB", (32, 32), "green").save(image, "JPEG")
    media = private_media.store_image(db_session, owner, image.getvalue())
    return private_media.object_url(media.id)


@pytest.fixture
def campaign(owner: User, db_session: Session) -> ContentCampaign:
    campaign = service.create_campaign(db_session, owner.id, START)
    db_session.commit()
    return campaign


@pytest.fixture
def batch(campaign: ContentCampaign, db_session: Session) -> ContentDailyBatch:
    batch = service.begin_batch(db_session, campaign.id, START, NOW)
    assert batch and batch.lease_token
    db_session.commit()
    return batch


def recipe_payload(photo: str, index: int = 0) -> dict[str, Any]:
    return {
        "name": f"Publisher rice {index}",
        "servings": 2,
        "photo_url": photo,
        "prep_minutes": 10,
        "cook_minutes": 20,
        "ingredients": [{"original_text": f"1 cup rice variety {index}"}],
        "instructions": [{"step_number": 1, "text": f"Simmer rice variety {index} until tender."}],
        "nutrition": {
            "calories": 350,
            "protein_g": 12,
            "carbs_g": 45,
            "fat_g": 8,
            "fiber_g": 5,
        },
    }


def workout_payload(photo: str, index: int = 0) -> dict[str, Any]:
    return {
        "title": f"Original routine {index}",
        "category": "full_body",
        "photo_url": photo,
        "description": (
            "Warm up for five minutes. Perform the prescribed sets with controlled motion; "
            "rest sixty seconds between sets, and stop if you experience pain."
        ),
        "exercises": [{"name": f"Chair squat variation {index}", "sets": 3, "reps": "8-12"}],
    }


def provenance() -> dict[str, Any]:
    return {
        "provider": "Test publisher",
        "nutrition": {"source_url": "https://publisher.example/nutrition"},
        "image": {
            "source_url": "https://commons.wikimedia.org/wiki/File:Example.jpg",
            "license": "CC BY 4.0",
            "license_url": "https://creativecommons.org/licenses/by/4.0/",
            "creator": "Test photographer",
            "credit": "Test photographer / CC BY 4.0",
            "permission_verified": True,
        },
    }


def stage(
    db: Session,
    batch: ContentDailyBatch,
    photo: str,
    index: int = 0,
    kind: Kind = "recipe",
    **changes: Any,
) -> ContentCandidate:
    values = {
        "payload": recipe_payload(photo, index)
        if kind == "recipe"
        else workout_payload(photo, index),
        "source_url": f"https://publisher.example/{kind}/{index}",
        "source_name": "Test publisher",
        "provenance": provenance(),
        "lease_token": batch.lease_token,
        "now": NOW,
    } | changes
    return service.stage_candidate(db, batch.id, kind, **values)


def decide(
    client: TestClient,
    headers: dict[str, str],
    batch_id: str,
    ids: list[str],
    action: str = "approve",
) -> Any:
    return client.post(
        f"{ROOT}/batches/{batch_id}/decisions",
        headers=headers,
        json={"action": action, "candidate_ids": ids},
    )


def count(db: Session, model: Any) -> int:
    return db.scalar(select(func.count()).select_from(model)) or 0


def lease_token(batch: ContentDailyBatch) -> str:
    assert batch.lease_token
    return batch.lease_token


def saved_candidate(db: Session, candidate_id: str) -> ContentCandidate:
    return db.scalars(select(ContentCandidate).where(ContentCandidate.id == candidate_id)).one()


def test_empty_contract_and_no_public_enrollment(
    client: TestClient, auth_headers: dict[str, str], db_session: Session
) -> None:
    response = client.get(ROOT, headers=auth_headers)
    assert response.status_code == 200
    assert response.json() == {"campaign": None, "batches": []}
    assert response.headers["cache-control"] == "no-store"
    for path in (ROOT, f"{ROOT}/campaign"):
        assert client.post(path, headers=auth_headers, json={}).status_code == 405
    assert (
        client.patch(f"{ROOT}/campaign", headers=auth_headers, json={"paused": True}).status_code
        == 404
    )
    assert count(db_session, ContentCampaign) == 0


def test_auth_basic_verification_and_error_cache(
    client: TestClient, auth_headers: dict[str, str], owner: User, db_session: Session
) -> None:
    response = client.get(ROOT)
    assert response.status_code == 401 and response.headers["cache-control"] == "no-store"
    owner.email_verified = False
    db_session.commit()
    response = client.get(ROOT, headers=auth_headers)
    assert response.status_code == 403 and response.headers["cache-control"] == "no-store"
    owner.email_verified = True
    subscription = db_session.scalars(select(UserSubscription)).one()
    subscription.status = "inactive"
    db_session.commit()
    response = client.get(ROOT, headers=auth_headers)
    assert response.status_code == 402 and response.headers["cache-control"] == "no-store"


def test_owner_only_404_and_unknown_candidate_is_atomic(
    client: TestClient,
    auth_headers: dict[str, str],
    owner: User,
    batch: ContentDailyBatch,
    photo: str,
    db_session: Session,
) -> None:
    candidate = stage(db_session, batch, photo)
    other = User(email="other@example.com", password_hash=str(uuid4()), email_verified=True)
    db_session.add(other)
    db_session.flush()
    other_campaign = service.create_campaign(db_session, other.id, START)
    other_batch = service.begin_batch(db_session, other_campaign.id, START, NOW)
    assert other_batch
    db_session.commit()
    response = client.get(f"{ROOT}/batches/{other_batch.id}", headers=auth_headers)
    assert response.status_code == 404 and response.headers["cache-control"] == "no-store"
    assert decide(client, auth_headers, other_batch.id, [candidate.id]).status_code == 404
    response = decide(client, auth_headers, batch.id, [candidate.id, str(uuid4())])
    assert response.status_code == 404
    assert count(db_session, Recipe) == 0
    assert saved_candidate(db_session, candidate.id).status == "pending"


def test_signed_candidate_contract_and_private_photo(
    client: TestClient,
    auth_headers: dict[str, str],
    owner: User,
    batch: ContentDailyBatch,
    photo: str,
    db_session: Session,
) -> None:
    candidate = stage(db_session, batch, photo, warnings=["Review publisher measurements"])
    db_session.commit()
    response = client.get(f"{ROOT}/batches/{batch.id}", headers=auth_headers)
    assert response.status_code == 200
    body = response.json()
    assert body["pending_count"] == 1 and body["recipe_count"] == 1
    assert body["workouts"] == [] and body["report"] == {"reasons": []}
    item = body["recipes"][0]
    assert set(item) == {
        "id",
        "kind",
        "status",
        "title",
        "payload",
        "photo_url",
        "photo_credit",
        "source_url",
        "source_name",
        "warnings",
    }
    assert item["id"] == candidate.id and item["status"] == "pending"
    image = provenance()["image"]
    assert item["photo_credit"] == {
        "text": image["credit"] + " " + MODIFICATIONS,
        "source_url": image["source_url"],
        "license_url": image["license_url"],
        "license": image["license"],
    }
    legacy_item = dict(item)
    legacy_item.pop("photo_credit")
    assert CandidateOut.model_validate(legacy_item).photo_credit is None
    assert "token=" in item["photo_url"] and item["payload"]["photo_url"] == item["photo_url"]
    assert client.get(photo).status_code == 422
    assert client.get(photo, params={"token": "invalid"}).status_code == 401
    assert client.get(item["photo_url"]).status_code == 200
    assert service.overview(db_session, owner, now=NOW)["campaign"]["pending_count"] == 1


@pytest.mark.parametrize("kind", ["recipe", "workout"])
@pytest.mark.parametrize("license", ["CC BY 4.0", "CC BY-SA 4.0"])
def test_candidate_photo_credit_is_whitelisted_and_survives_approval(
    client: TestClient,
    auth_headers: dict[str, str],
    batch: ContentDailyBatch,
    photo: str,
    db_session: Session,
    kind: Kind,
    license: str,
) -> None:
    evidence = provenance()
    image = evidence["image"]
    image.update(
        {
            "source_url": "https://commons.wikimedia.org/wiki/File:Example.jpg",
            "license": license,
            "license_url": (
                "https://creativecommons.org/licenses/by-sa/4.0/"
                if license == "CC BY-SA 4.0"
                else "https://creativecommons.org/licenses/by/4.0/"
            ),
            "credit": f"Test photographer / {license}",
            "provider_credentials": "private-credit-metadata-sentinel",
        }
    )
    candidate = stage(db_session, batch, photo, kind=kind, provenance=evidence)
    db_session.commit()
    expected = {
        "text": image["credit"]
        + " "
        + MODIFICATIONS
        + (" " + SHARE_ALIKE if license == "CC BY-SA 4.0" else ""),
        "source_url": image["source_url"],
        "license_url": image["license_url"],
        "license": license,
    }
    collection = "recipes" if kind == "recipe" else "workouts"
    response = client.get(f"{ROOT}/batches/{batch.id}", headers=auth_headers)
    assert response.status_code == 200, response.text
    assert response.json()[collection][0]["photo_credit"] == expected
    assert "private-credit-metadata-sentinel" not in response.text
    for _ in range(2):
        response = decide(client, auth_headers, batch.id, [candidate.id])
        assert response.status_code == 200, response.text
        item = response.json()[collection][0]
        assert item["photo_credit"] == expected and item["status"] == "approved"
    assert saved_candidate(db_session, candidate.id).provenance == evidence
    if kind == "recipe":
        source = db_session.scalars(select(RecipeSource)).one()
        assert source.provenance["image"] == image
    exported = service.account_export(
        db_session, db_session.scalars(select(User).where(User.email == "owner@example.com")).one()
    )
    assert "photo_credit" not in json.dumps(exported)


@pytest.mark.parametrize("kind", ["recipe", "workout"])
def test_candidate_photo_credit_is_optional_for_missing_legacy_evidence(
    client: TestClient,
    auth_headers: dict[str, str],
    batch: ContentDailyBatch,
    photo: str,
    db_session: Session,
    kind: Kind,
) -> None:
    candidate = stage(db_session, batch, photo, kind=kind)
    collection = "recipes" if kind == "recipe" else "workouts"
    legacy_evidence: list[dict[str, Any]] = [{}, {"image": None}, {"image": {}}]
    for evidence in legacy_evidence:
        candidate.provenance = evidence
        db_session.commit()
        response = client.get(f"{ROOT}/batches/{batch.id}", headers=auth_headers)
        assert response.status_code == 200, response.text
        assert response.json()[collection][0]["photo_credit"] is None


def test_campaign_exact_dates_idempotent_provisioning(
    owner: User,
    campaign: ContentCampaign,
    db_session: Session,
) -> None:
    assert campaign.end_date == date(2026, 11, 19)
    assert campaign.days_total == 35 and campaign.time_zone == "America/New_York"
    assert service.create_campaign(db_session, owner.id, START).id == campaign.id
    for kwargs in ({"days": 34}, {"days": True}, {"time_zone": "UTC"}):
        with pytest.raises(HTTPException) as error:
            service.create_campaign(db_session, owner.id, START, **kwargs)
        assert error.value.status_code == 422
    with pytest.raises(HTTPException) as error:
        service.create_campaign(db_session, owner.id, START + timedelta(days=1))
    assert error.value.status_code == 409


@pytest.mark.parametrize(
    ("start", "before", "at"),
    [
        (date(2026, 10, 16), "2026-10-16T09:59:59+00:00", "2026-10-16T10:00:00+00:00"),
        (date(2026, 11, 1), "2026-11-01T10:59:59+00:00", "2026-11-01T11:00:00+00:00"),
        (date(2026, 3, 8), "2026-03-08T09:59:59+00:00", "2026-03-08T10:00:00+00:00"),
    ],
)
def test_local_six_am_gate_including_both_dst_transitions(
    owner: User,
    db_session: Session,
    start: date,
    before: str,
    at: str,
) -> None:
    campaign = service.create_campaign(db_session, owner.id, start)
    assert (
        service.begin_batch(db_session, campaign.id, start, datetime.fromisoformat(before)) is None
    )
    batch = service.begin_batch(db_session, campaign.id, start, datetime.fromisoformat(at))
    assert batch and batch.scheduled_date == start


def test_no_catchup_no_prestart_no_before_local_start(
    campaign: ContentCampaign,
    db_session: Session,
) -> None:
    for scheduled, now in (
        (START, datetime(2026, 10, 16, 0, 20, tzinfo=UTC)),
        (START - timedelta(days=1), NOW),
        (START + timedelta(days=1), NOW),
        (START, NOW + timedelta(days=1)),
    ):
        assert service.begin_batch(db_session, campaign.id, scheduled, now) is None
    assert count(db_session, ContentDailyBatch) == 0
    with pytest.raises(ValueError, match="timezone-aware"):
        service.begin_batch(db_session, campaign.id, START, NOW.replace(tzinfo=None))


def test_pause_skips_day_without_extending_or_replaying(
    owner: User,
    campaign: ContentCampaign,
    db_session: Session,
) -> None:
    service.set_paused(db_session, owner, True, now=NOW)
    assert service.begin_batch(db_session, campaign.id, START, NOW) is None
    skipped = db_session.scalars(select(ContentDailyBatch)).one()
    assert skipped.status == "skipped" and skipped.report["reasons"] == ["campaign_paused"]
    service.set_paused(db_session, owner, False, now=NOW)
    assert service.begin_batch(db_session, campaign.id, START, NOW) is None
    assert campaign.end_date == date(2026, 11, 19)
    next_day = START + timedelta(days=1)
    assert service.begin_batch(db_session, campaign.id, next_day, NOW + timedelta(days=1))


def test_lease_claim_renew_expiry_resume_and_old_token_rejection(
    batch: ContentDailyBatch,
    photo: str,
    db_session: Session,
) -> None:
    token = lease_token(batch)
    candidate = stage(db_session, batch, photo)
    batch.report = {"reasons": [], "attempted_sources": {"recipe": ["source1"], "workout": []}}
    db_session.commit()
    assert (
        service.begin_batch(db_session, batch.campaign_id, START, NOW + timedelta(minutes=1))
        is None
    )
    renewed = service.renew_batch_lease(
        db_session, batch.id, lease_token=token, now=NOW + timedelta(minutes=10)
    )
    assert renewed.lease_expires_at == (NOW + timedelta(minutes=25)).replace(tzinfo=None)
    assert (
        service.begin_batch(db_session, batch.campaign_id, START, NOW + timedelta(minutes=24))
        is None
    )
    resumed = service.begin_batch(db_session, batch.campaign_id, START, NOW + timedelta(minutes=25))
    assert (
        resumed
        and resumed.id == batch.id
        and resumed.lease_token != token
        and resumed.attempts == 2
    )
    assert resumed.report["attempted_sources"]["recipe"] == ["source1"]
    for operation in (
        lambda: service.renew_batch_lease(db_session, batch.id, lease_token=token, now=NOW),
        lambda: service.finish_batch(db_session, batch.id, lease_token=token, now=NOW),
        lambda: stage(db_session, batch, photo, index=1, lease_token=token),
    ):
        with pytest.raises(HTTPException) as error:
            operation()
        assert error.value.status_code == 409
    assert count(db_session, ContentCandidate) == 1
    assert saved_candidate(db_session, candidate.id).status == "pending"


def test_expired_lease_cannot_stage_renew_or_finish(
    batch: ContentDailyBatch,
    photo: str,
    db_session: Session,
) -> None:
    late = NOW + service.LEASE_DURATION
    for operation in (
        lambda: stage(db_session, batch, photo, now=late),
        lambda: service.renew_batch_lease(
            db_session, batch.id, lease_token=lease_token(batch), now=late
        ),
        lambda: service.finish_batch(
            db_session, batch.id, lease_token=lease_token(batch), now=late
        ),
    ):
        with pytest.raises(HTTPException) as error:
            operation()
        assert error.value.status_code == 409


def test_partial_batch_report_ledger_and_abandoned_date(
    batch: ContentDailyBatch,
    photo: str,
    db_session: Session,
) -> None:
    candidate = stage(db_session, batch, photo)
    batch.report = {"reasons": [], "attempted_sources": {"recipe": ["a"], "workout": ["b"]}}
    closed = service.finish_batch(
        db_session, batch.id, ["provider_unavailable"], lease_token=lease_token(batch), now=NOW
    )
    assert closed.status == "partial" and closed.lease_token is None
    assert closed.report["attempted_sources"] == {"recipe": ["a"], "workout": ["b"]}
    assert closed.report["reasons"] == [
        "provider_unavailable",
        "recipe_shortfall:1/5",
        "workout_shortfall:0/5",
    ]
    assert candidate.status == "pending"
    assert service.begin_batch(db_session, batch.campaign_id, START, NOW) is None
    second = service.begin_batch(
        db_session, batch.campaign_id, START + timedelta(days=1), NOW + timedelta(days=1)
    )
    assert second
    service.begin_batch(
        db_session, batch.campaign_id, START + timedelta(days=2), NOW + timedelta(days=2)
    )
    assert second.status == "partial" and "generation_window_expired" in second.report["reasons"]


def test_daily_caps_full_batch_and_no_library_writes_before_review(
    owner: User,
    batch: ContentDailyBatch,
    photo: str,
    db_session: Session,
) -> None:
    kinds: tuple[Kind, ...] = ("recipe", "workout")
    for kind in kinds:
        for index in range(5):
            assert stage(db_session, batch, photo, index, kind).status == "pending"
        with pytest.raises(HTTPException) as error:
            stage(db_session, batch, photo, 5, kind)
        assert error.value.status_code == 409
    finished = service.finish_batch(db_session, batch.id, lease_token=lease_token(batch), now=NOW)
    assert finished.status == "complete" and finished.report["reasons"] == []
    assert count(db_session, ContentCandidate) == 10
    for model in (
        Recipe,
        RecipeMacroProfile,
        RecipeSource,
        WorkoutTemplate,
        WorkoutPlan,
        WorkoutLog,
    ):
        assert count(db_session, model) == 0
    overview = service.overview(db_session, owner, now=NOW)
    assert overview["campaign"]["completed_days"] == 1
    assert overview["campaign"]["pending_count"] == 10


@pytest.mark.parametrize("field", ["calories", "protein_g", "carbs_g", "fat_g", "fiber_g"])
def test_all_five_published_nutrients_required(
    batch: ContentDailyBatch,
    photo: str,
    db_session: Session,
    field: str,
) -> None:
    payload = recipe_payload(photo)
    payload["nutrition"].pop(field)
    with pytest.raises(HTTPException) as error:
        stage(db_session, batch, photo, payload=payload)
    assert error.value.status_code == 422 and count(db_session, ContentCandidate) == 0


@pytest.mark.parametrize(
    "change",
    [
        {"servings": None},
        {"servings": True},
        {"servings": "2"},
        {"ingredients": []},
        {"instructions": []},
        {"invented_field": "unsupported"},
        {"calculator_source_id": str(uuid4())},
        {"accept_placeholder_photo": True},
        {"ingredients": [{"original_text": "rice", "secret": "unsupported"}]},
        {"instructions": [{"step_number": 2, "text": "Simmer"}]},
    ],
)
def test_incomplete_or_unsupported_recipe_fields_rejected(
    batch: ContentDailyBatch,
    photo: str,
    db_session: Session,
    change: dict[str, Any],
) -> None:
    with pytest.raises(HTTPException) as error:
        stage(db_session, batch, photo, payload=recipe_payload(photo) | change)
    assert error.value.status_code == 422 and count(db_session, ContentCandidate) == 0


@pytest.mark.parametrize("field", ["prep_minutes", "cook_minutes"])
def test_recipe_requires_prep_and_cook_durations(
    batch: ContentDailyBatch, photo: str, db_session: Session, field: str
) -> None:
    payload = recipe_payload(photo)
    payload.pop(field)
    with pytest.raises(HTTPException) as error:
        stage(db_session, batch, photo, payload=payload)
    assert error.value.status_code == 422
    assert count(db_session, ContentCandidate) == 0


@pytest.mark.parametrize("field", ["prep_minutes", "cook_minutes", "total_minutes"])
def test_recipe_durations_require_bounded_nonnegative_strict_integers(
    batch: ContentDailyBatch, photo: str, db_session: Session, field: str
) -> None:
    for invalid in (None, True, False, "10", 10.0, -1, 1441):
        with pytest.raises(HTTPException) as error:
            stage(db_session, batch, photo, payload=recipe_payload(photo) | {field: invalid})
        assert error.value.status_code == 422, (field, invalid)
    assert count(db_session, ContentCandidate) == 0


@pytest.mark.parametrize(
    ("prep", "cook", "supplied_total"),
    [(10, 20, None), (0, 0, None), (0, 20, 0), (10, 0, 100), (1440, 0, None)],
)
def test_recipe_total_is_always_the_validated_duration_sum(
    batch: ContentDailyBatch,
    photo: str,
    db_session: Session,
    prep: int,
    cook: int,
    supplied_total: int | None,
) -> None:
    payload = recipe_payload(photo) | {"prep_minutes": prep, "cook_minutes": cook}
    if supplied_total is not None:
        payload["total_minutes"] = supplied_total
    candidate = stage(db_session, batch, photo, payload=payload)
    assert candidate.payload["prep_minutes"] == prep
    assert candidate.payload["cook_minutes"] == cook
    assert candidate.payload["total_minutes"] == prep + cook
    assert type(candidate.payload["total_minutes"]) is int


def test_recipe_duration_sum_cannot_exceed_one_day(
    batch: ContentDailyBatch, photo: str, db_session: Session
) -> None:
    payload = recipe_payload(photo) | {"prep_minutes": 1440, "cook_minutes": 1}
    with pytest.raises(HTTPException) as error:
        stage(db_session, batch, photo, payload=payload)
    assert error.value.status_code == 422
    assert count(db_session, ContentCandidate) == 0


def test_unknown_servings_and_missing_published_source_rejected(
    batch: ContentDailyBatch,
    photo: str,
    db_session: Session,
) -> None:
    payload = recipe_payload(photo)
    payload.pop("servings")
    changes_list: list[dict[str, Any]] = [
        {"payload": payload},
        {"provenance": {"image": provenance()["image"]}},
    ]
    for changes in changes_list:
        with pytest.raises(HTTPException) as error:
            stage(db_session, batch, photo, **changes)
        assert error.value.status_code == 422


@pytest.mark.parametrize(
    "bad_photo",
    [None, "", "  ", "https://publisher.example/hotlink.jpg", "https://publisher.example/logo.png"],
)
@pytest.mark.parametrize("kind", ["recipe", "workout"])
def test_external_and_missing_photos_rejected(
    batch: ContentDailyBatch,
    photo: str,
    db_session: Session,
    bad_photo: str | None,
    kind: Kind,
) -> None:
    payload = recipe_payload(photo) if kind == "recipe" else workout_payload(photo)
    with pytest.raises(HTTPException) as error:
        stage(db_session, batch, photo, kind=kind, payload=payload | {"photo_url": bad_photo})
    assert error.value.status_code == 422
    assert count(db_session, ContentCandidate) == 0


@pytest.mark.parametrize("kind", ["recipe", "workout"])
def test_candidate_photo_is_required_even_when_the_field_is_omitted(
    batch: ContentDailyBatch, photo: str, db_session: Session, kind: Kind
) -> None:
    payload = recipe_payload(photo) if kind == "recipe" else workout_payload(photo)
    payload.pop("photo_url")
    with pytest.raises(HTTPException) as error:
        stage(db_session, batch, photo, kind=kind, payload=payload)
    assert error.value.status_code == 422
    assert count(db_session, ContentCandidate) == 0


@pytest.mark.parametrize("kind", ["recipe", "workout"])
def test_foreign_deleted_legacy_and_unlicensed_photos_rejected(
    owner: User,
    batch: ContentDailyBatch,
    photo: str,
    db_session: Session,
    kind: Kind,
) -> None:
    media = private_media.local_object(db_session, photo)
    assert media
    for field, value in (
        ("owner_user_id", str(uuid4())),
        ("deleted_at", datetime.utcnow()),
        ("managed", False),
    ):
        old = getattr(media, field)
        setattr(media, field, value)
        db_session.flush()
        with pytest.raises(HTTPException) as error:
            stage(db_session, batch, photo, kind=kind)
        assert error.value.status_code == 422
        setattr(media, field, old)
        db_session.flush()
    for field in (
        "permission_verified",
        "license",
        "source_url",
        "creator",
        "credit",
        "license_url",
    ):
        evidence = provenance()
        evidence["image"].pop(field)
        with pytest.raises(HTTPException) as error:
            stage(db_session, batch, photo, kind=kind, provenance=evidence)
        assert error.value.status_code == 422
    assert count(db_session, ContentCandidate) == 0


@pytest.mark.parametrize("kind", ["recipe", "workout"])
def test_photo_must_reference_the_canonical_owned_media_object(
    batch: ContentDailyBatch, photo: str, db_session: Session, kind: Kind
) -> None:
    media = private_media.local_object(db_session, photo)
    assert media
    legacy_url = f"{settings.public_api_url.rstrip('/')}/media/{media.storage_key}"
    payload = recipe_payload(photo) if kind == "recipe" else workout_payload(photo)
    with pytest.raises(HTTPException) as error:
        stage(db_session, batch, photo, kind=kind, payload=payload | {"photo_url": legacy_url})
    assert error.value.status_code == 422
    assert count(db_session, ContentCandidate) == 0


@pytest.mark.parametrize("field", ["prep_minutes", "cook_minutes", "photo_url"])
def test_approval_rechecks_required_duration_and_workout_photo_fields(
    client: TestClient,
    auth_headers: dict[str, str],
    batch: ContentDailyBatch,
    photo: str,
    db_session: Session,
    field: str,
) -> None:
    kind: Kind = "workout" if field == "photo_url" else "recipe"
    candidate = stage(db_session, batch, photo, kind=kind)
    payload = dict(candidate.payload)
    payload.pop(field)
    candidate.payload = payload
    db_session.commit()
    response = decide(client, auth_headers, batch.id, [candidate.id])
    assert response.status_code == 422
    assert saved_candidate(db_session, candidate.id).status == "pending"
    assert count(db_session, Recipe) == count(db_session, WorkoutTemplate) == 0


def test_public_creation_schemas_still_allow_incomplete_manual_content() -> None:
    recipe = RecipeCreate.model_validate({"name": "Manual draft"})
    assert recipe.prep_minutes is None and recipe.cook_minutes is None
    assert recipe.total_minutes is None
    assert TemplateInput.model_validate({"title": "Manual draft"}).photo_url is None


@pytest.mark.parametrize(
    "change",
    [
        {"description": "Incomplete"},
        {"exercises": []},
        {"exercises": [{"name": "Squat"}]},
        {"exercises": [{"name": "Squat", "sets": 3, "reps": "10", "instructions": "extra"}]},
        {"safety_claim": "unsupported"},
    ],
)
def test_workouts_require_complete_existing_field_shape(
    batch: ContentDailyBatch,
    photo: str,
    db_session: Session,
    change: dict[str, Any],
) -> None:
    with pytest.raises(HTTPException) as error:
        stage(db_session, batch, photo, kind="workout", payload=workout_payload(photo) | change)
    assert error.value.status_code == 422


def test_canonical_sources_content_and_workout_catalog_identity(
    batch: ContentDailyBatch,
    photo: str,
    db_session: Session,
) -> None:
    original = stage(
        db_session,
        batch,
        photo,
        source_url="https://www.publisher.example/rice/?utm_source=x#recipe",
    )
    same_source = stage(db_session, batch, photo, 1, source_url="http://publisher.example/rice")
    assert original.id == same_source.id
    renamed = recipe_payload(photo) | {"name": "A different title"}
    assert stage(db_session, batch, photo, 2, payload=renamed).id == original.id
    one = stage(
        db_session,
        batch,
        photo,
        kind="workout",
        source_url="https://guidance.example/activity#strength",
        provenance=provenance() | {"catalog_id": "original-routine-1"},
    )
    two = stage(
        db_session,
        batch,
        photo,
        1,
        "workout",
        source_url="https://guidance.example/activity#strength",
        provenance=provenance() | {"catalog_id": "original-routine-2"},
    )
    assert one.id != two.id and one.source_hash != two.source_hash
    assert (
        one.canonical_source_url == two.canonical_source_url == "https://guidance.example/activity"
    )
    assert (
        stage(
            db_session,
            batch,
            photo,
            kind="workout",
            source_url="https://guidance.example/activity",
            provenance=provenance() | {"catalog_id": "original-routine-3"},
        ).id
        == one.id
    )


def test_preferences_checked_at_stage_and_again_at_approval(
    client: TestClient,
    auth_headers: dict[str, str],
    owner: User,
    batch: ContentDailyBatch,
    photo: str,
    db_session: Session,
) -> None:
    owner.profile.allergens = ["Rice"]
    db_session.commit()
    with pytest.raises(HTTPException) as error:
        stage(db_session, batch, photo)
    assert error.value.status_code == 422
    owner.profile.allergens = []
    db_session.commit()
    candidate = stage(db_session, batch, photo)
    owner.profile.disliked_ingredients = ["RICE"]
    db_session.commit()
    response = decide(client, auth_headers, batch.id, [candidate.id])
    assert response.status_code == 422
    assert count(db_session, Recipe) == 0 and count(db_session, RecipeSource) == 0
    assert saved_candidate(db_session, candidate.id).status == "pending"


def test_approval_new_only_provenance_macro_profile_and_repeat_idempotency(
    client: TestClient,
    auth_headers: dict[str, str],
    owner: User,
    batch: ContentDailyBatch,
    photo: str,
    db_session: Session,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    recipe_candidate = stage(db_session, batch, photo)
    workout_candidate = stage(db_session, batch, photo, kind="workout")
    db_session.commit()
    calls: list[bool] = []
    original = recipes.create_recipe

    def checked_create(*args: Any, **kwargs: Any) -> Recipe:
        calls.append(kwargs["commit"])
        return original(*args, **kwargs)

    monkeypatch.setattr(recipes, "create_recipe", checked_create)
    ids = [recipe_candidate.id, workout_candidate.id]
    for _ in range(2):
        response = decide(client, auth_headers, batch.id, ids)
        assert response.status_code == 200, response.text
        assert response.json()["approved_count"] == 2 and response.json()["pending_count"] == 0
    assert calls == [False]
    assert count(db_session, Recipe) == count(db_session, WorkoutTemplate) == 1
    macro = db_session.scalars(select(RecipeMacroProfile)).one()
    assert macro.source == "publisher" and macro.confidence == 0.7 and macro.needs_review
    assert macro.calories_per_serving == 350 and macro.fiber_g_per_serving == 5
    source = db_session.scalars(select(RecipeSource)).one()
    assert source.provenance == provenance() and source.source_type == "publisher"
    assert source.source_url == recipe_candidate.source_url
    recipe = db_session.scalars(select(Recipe)).one()
    assert (
        recipe.owner_user_id == owner.id
        and recipe.photo_attribution == provenance()["image"]["credit"]
    )
    for model in (
        WeeklyPlan,
        WorkoutPlan,
        WorkoutLog,
        WorkoutTemplateShare,
        HouseholdRecipe,
        MealMacroConfirmation,
    ):
        assert count(db_session, model) == 0


def test_dismiss_repeat_does_not_revive_or_create(
    client: TestClient,
    auth_headers: dict[str, str],
    batch: ContentDailyBatch,
    photo: str,
    db_session: Session,
) -> None:
    candidate = stage(db_session, batch, photo)
    db_session.commit()
    for _ in range(2):
        assert decide(client, auth_headers, batch.id, [candidate.id], "dismiss").status_code == 200
    assert decide(client, auth_headers, batch.id, [candidate.id]).status_code == 409
    assert stage(db_session, batch, photo).status == "dismissed"
    assert count(db_session, Recipe) == 0 and count(db_session, ContentCandidate) == 1


@pytest.mark.parametrize("duplicate_kind", ["recipe_source", "recipe_content", "workout_content"])
def test_library_duplicate_introduced_after_staging_blocks_approval(
    client: TestClient,
    auth_headers: dict[str, str],
    owner: User,
    batch: ContentDailyBatch,
    photo: str,
    db_session: Session,
    duplicate_kind: str,
) -> None:
    kind: Kind = "workout" if duplicate_kind == "workout_content" else "recipe"
    candidate = stage(db_session, batch, photo, kind=kind)
    existing: Recipe | WorkoutTemplate
    if kind == "recipe":
        payload = recipe_payload(photo, 1 if duplicate_kind == "recipe_source" else 0)
        payload["source_url"] = (
            candidate.source_url + "?utm_medium=test#nutrition"
            if duplicate_kind == "recipe_source"
            else "https://different.example/recipe"
        )
        existing = recipes.create_recipe(
            db_session, RecipeCreate.model_validate(payload), owner, commit=False
        )
        existing.archived_at = datetime.utcnow()  # Archived records also remain duplicates.
    else:
        existing = workouts.save_template(
            db_session,
            owner,
            TemplateInput.model_validate(workout_payload(photo) | {"title": "Renamed routine"}),
        )
    db_session.commit()
    old_id = existing.id
    response = decide(client, auth_headers, batch.id, [candidate.id])
    assert response.status_code == 409, response.text
    assert count(db_session, Recipe if kind == "recipe" else WorkoutTemplate) == 1
    assert existing.id == old_id and saved_candidate(db_session, candidate.id).status == "pending"


def test_multi_item_approval_rolls_back_created_rows_on_late_failure(
    client: TestClient,
    auth_headers: dict[str, str],
    batch: ContentDailyBatch,
    photo: str,
    db_session: Session,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    first = stage(db_session, batch, photo)
    second = stage(db_session, batch, photo, 1)
    first.id, second.id = (
        "10000000-0000-4000-8000-000000000000",
        "20000000-0000-4000-8000-000000000000",
    )
    db_session.commit()
    original = recipes.create_recipe
    calls = 0

    def fail_second(*args: Any, **kwargs: Any) -> Recipe:
        nonlocal calls
        calls += 1
        if calls == 2:
            raise HTTPException(422, "Second item changed during review")
        return original(*args, **kwargs)

    monkeypatch.setattr(recipes, "create_recipe", fail_second)
    response = decide(client, auth_headers, batch.id, [first.id, second.id])
    assert response.status_code == 422 and calls == 2
    for model in (Recipe, RecipeMacroProfile, RecipeSource):
        assert count(db_session, model) == 0
    assert all(
        row.status == "pending" and row.recipe_id is None
        for row in db_session.scalars(select(ContentCandidate))
    )


def test_last_partial_finishes_campaign_without_tick_36_and_stays_reviewable(
    client: TestClient,
    auth_headers: dict[str, str],
    owner: User,
    campaign: ContentCampaign,
    photo: str,
    db_session: Session,
) -> None:
    last_now = datetime(2026, 11, 19, 12, tzinfo=UTC)
    batch = service.begin_batch(db_session, campaign.id, campaign.end_date, last_now)
    assert batch
    candidate = stage(db_session, batch, photo, now=last_now)
    service.finish_batch(db_session, batch.id, lease_token=lease_token(batch), now=last_now)
    db_session.commit()
    assert campaign.status == "completed"
    assert service.overview(db_session, owner, now=last_now)["campaign"]["status"] == "completed"
    assert service.begin_batch(db_session, campaign.id, campaign.end_date, last_now) is None
    assert decide(client, auth_headers, batch.id, [candidate.id]).status_code == 200
    for paused in (False, True):
        service.set_paused(db_session, owner, paused, now=last_now)
        assert campaign.status == "completed"
    service.set_paused(db_session, owner, False, now=last_now + timedelta(days=1))
    assert campaign.status == "completed"


def test_patch_rate_limit_validation_and_no_store(
    client: TestClient,
    auth_headers: dict[str, str],
    campaign: ContentCampaign,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    response = client.patch(f"{ROOT}/campaign", headers=auth_headers, json={"paused": True})
    assert response.status_code == 200 and response.json()["campaign"]["status"] == "paused"
    for value in ("true", 1, None):
        response = client.patch(f"{ROOT}/campaign", headers=auth_headers, json={"paused": value})
        assert response.status_code == 422 and response.headers["cache-control"] == "no-store"
    response = client.get(f"{ROOT}/batches/not-a-uuid", headers=auth_headers)
    assert response.status_code == 422 and response.headers["cache-control"] == "no-store"

    def limited(*args: Any, **kwargs: Any) -> None:
        raise HTTPException(429, "Rate limit", headers={"Retry-After": "60"})

    monkeypatch.setattr(auth_rate_limiter, "check", limited)
    response = client.get(ROOT, headers=auth_headers)
    assert response.status_code == 429
    assert (
        response.headers["cache-control"] == "no-store" and response.headers["retry-after"] == "60"
    )


@pytest.mark.parametrize(
    "corruption",
    ["slot", "kind", "status", "duplicate_slot", "duplicate_source", "duplicate_content"],
)
def test_database_enforces_caps_and_uniqueness(
    batch: ContentDailyBatch,
    photo: str,
    db_session: Session,
    corruption: str,
) -> None:
    candidate = stage(db_session, batch, photo)
    db_session.commit()
    values = {
        column.name: copy.deepcopy(getattr(candidate, column.name))
        for column in ContentCandidate.__table__.columns
    }
    values.update(id=str(uuid4()), slot=2, source_hash="b" * 64, content_hash="c" * 64)
    if corruption == "slot":
        values["slot"] = 6
    elif corruption == "kind":
        values["kind"] = "unknown"
    elif corruption == "status":
        values["status"] = "approved"  # Must also reference a newly created record.
    elif corruption == "duplicate_slot":
        values["slot"] = candidate.slot
    elif corruption == "duplicate_source":
        values["source_hash"] = candidate.source_hash
    else:
        values["content_hash"] = candidate.content_hash
    with pytest.raises(IntegrityError):
        db_session.execute(insert(ContentCandidate).values(**values))
    db_session.rollback()
    assert count(db_session, ContentCandidate) == 1


def test_approval_keeps_new_items_private_and_existing_user_data_unchanged(
    client: TestClient,
    auth_headers: dict[str, str],
    owner: User,
    batch: ContentDailyBatch,
    photo: str,
    db_session: Session,
) -> None:
    group = Household(name="Existing household")
    other = User(email="member@example.com", password_hash=str(uuid4()), email_verified=True)
    db_session.add_all([group, other])
    db_session.flush()
    owner.profile.household_id = group.id
    db_session.add_all(
        [
            HouseholdMember(household_id=group.id, user_id=owner.id, role="owner"),
            HouseholdMember(household_id=group.id, user_id=other.id, role="member"),
        ]
    )
    old_recipe = recipes.create_recipe(
        db_session, RecipeCreate.model_validate(recipe_payload(photo, 99)), owner, commit=False
    )
    old_template = workouts.save_template(
        db_session, owner, TemplateInput.model_validate(workout_payload(photo, 99))
    )
    meal_plan = WeeklyPlan(user_id=owner.id, week_start=START, meal_target=3)
    workout_plan = WorkoutPlan(user_id=owner.id, week_start=START)
    db_session.add_all([meal_plan, workout_plan])
    db_session.flush()
    db_session.add_all(
        [
            WeeklyPlanSlot(
                weekly_plan_id=meal_plan.id, recipe_id=old_recipe.id, is_locked=True, servings=3
            ),
            WorkoutPlanSlot(
                plan_id=workout_plan.id,
                template_id=old_template.id,
                sort_order=0,
                snapshot={"title": "Frozen historical routine"},
            ),
            WorkoutLog(
                user_id=owner.id,
                request_uuid=str(uuid4()),
                template_id=old_template.id,
                performed_on=START,
                sets=[{"reps": 9}],
                snapshot={"title": "Existing workout log"},
            ),
            WorkoutTemplateShare(
                household_id=group.id,
                template_id=old_template.id,
                snapshot={"title": "Existing shared routine"},
            ),
            HouseholdRecipe(household_id=group.id, recipe_id=old_recipe.id),
            MealMacroConfirmation(
                user_id=owner.id, meal_date=START, entry_name="Existing meal", calories=123
            ),
        ]
    )
    recipe_candidate = stage(db_session, batch, photo)
    workout_candidate = stage(db_session, batch, photo, kind="workout")
    db_session.commit()
    # Compare every preexisting domain row, including child rows and timestamps.
    tables = [
        table
        for table in Base.metadata.sorted_tables
        if not table.name.startswith("content_automation_")
        and table.name not in {MediaObject.__tablename__, "security_rate_counters"}
    ]
    before = {
        table.name: [
            copy.deepcopy(dict(row)) for row in db_session.execute(select(table)).mappings()
        ]
        for table in tables
    }
    response = decide(client, auth_headers, batch.id, [recipe_candidate.id, workout_candidate.id])
    assert response.status_code == 200, response.text
    for table in tables:
        after = {row["id"]: dict(row) for row in db_session.execute(select(table)).mappings()}
        for row in before[table.name]:
            assert after[row["id"]] == row, table.name
    recipe = db_session.get(Recipe, recipe_candidate.recipe_id)
    template = db_session.get(WorkoutTemplate, workout_candidate.workout_template_id)
    assert recipe and recipe.owner_user_id == owner.id and recipe.household_id is None
    assert template and template.owner_id == owner.id
    assert recipe.id != old_recipe.id and template.id != old_template.id
    assert private_media.allowed_recipe(db_session, other, recipe.id) is None
    assert private_media.allowed_recipe(db_session, other, old_recipe.id)
    assert count(db_session, HouseholdRecipe) == count(db_session, WorkoutTemplateShare) == 1


@pytest.mark.parametrize("first_kind", ["recipe", "workout"])
def test_mixed_approval_rolls_back_new_rows_on_later_duplicate(
    client: TestClient,
    auth_headers: dict[str, str],
    owner: User,
    batch: ContentDailyBatch,
    photo: str,
    db_session: Session,
    first_kind: Kind,
) -> None:
    second_kind: Kind = "workout" if first_kind == "recipe" else "recipe"
    first = stage(db_session, batch, photo, kind=first_kind)
    second = stage(db_session, batch, photo, kind=second_kind)
    first.id = "10000000-0000-4000-8000-000000000000"
    second.id = "20000000-0000-4000-8000-000000000000"
    if second_kind == "recipe":
        recipes.create_recipe(
            db_session, RecipeCreate.model_validate(recipe_payload(photo)), owner, commit=False
        )
    else:
        workouts.save_template(
            db_session, owner, TemplateInput.model_validate(workout_payload(photo))
        )
    db_session.commit()
    response = decide(client, auth_headers, batch.id, [first.id, second.id])
    assert response.status_code == 409, response.text
    assert count(db_session, Recipe) == int(second_kind == "recipe")
    assert count(db_session, WorkoutTemplate) == int(second_kind == "workout")
    assert count(db_session, RecipeSource) == 0
    assert all(
        row.status == "pending" and row.recipe_id is None and row.workout_template_id is None
        for row in db_session.scalars(select(ContentCandidate))
    )


@pytest.mark.parametrize("kind", ["recipe", "workout"])
@pytest.mark.parametrize("field", ["id", "owner_user_id", "owner_id", "household_id"])
def test_candidate_cannot_target_existing_records_or_change_owner(
    batch: ContentDailyBatch, photo: str, db_session: Session, kind: Kind, field: str
) -> None:
    payload = recipe_payload(photo) if kind == "recipe" else workout_payload(photo)
    with pytest.raises(HTTPException) as error:
        stage(db_session, batch, photo, kind=kind, payload=payload | {field: str(uuid4())})
    assert error.value.status_code == 422
    assert count(db_session, ContentCandidate) == 0


@pytest.mark.parametrize("kind", ["recipe", "workout"])
def test_pending_media_is_canonical_private_and_retained_until_decision(
    client: TestClient,
    auth_headers: dict[str, str],
    owner: User,
    batch: ContentDailyBatch,
    photo: str,
    db_session: Session,
    kind: Kind,
) -> None:
    media = db_session.scalars(select(MediaObject)).one()
    signed = private_media.photo_url(db_session, owner, "objects", media.id, photo)
    assert signed
    payload = recipe_payload(photo) if kind == "recipe" else workout_payload(photo)
    candidate = stage(db_session, batch, photo, kind=kind, payload=payload | {"photo_url": signed})
    db_session.commit()
    assert candidate.payload["photo_url"] == photo
    assert media.claimed_at and media.orphaned_at is None
    assert media_maintenance.referenced(db_session, media)
    assert decide(client, auth_headers, batch.id, [candidate.id], "dismiss").status_code == 200
    assert not media_maintenance.referenced(db_session, media)


@pytest.mark.parametrize("kind", ["recipe", "workout"])
def test_approved_private_media_remains_referenced(
    client: TestClient,
    auth_headers: dict[str, str],
    batch: ContentDailyBatch,
    photo: str,
    db_session: Session,
    kind: Kind,
) -> None:
    payload = recipe_payload(photo) if kind == "recipe" else workout_payload(photo)
    candidate = stage(db_session, batch, photo, kind=kind, payload=payload | {"photo_url": photo})
    db_session.commit()
    assert decide(client, auth_headers, batch.id, [candidate.id]).status_code == 200
    media = db_session.scalars(select(MediaObject)).one()
    assert media_maintenance.referenced(db_session, media)


@pytest.mark.parametrize("paused", [False, True])
def test_last_date_closes_campaign_immediately_for_full_or_skipped_batch(
    owner: User,
    campaign: ContentCampaign,
    photo: str,
    db_session: Session,
    paused: bool,
) -> None:
    last_now = datetime(2026, 11, 19, 12, tzinfo=UTC)
    final: ContentDailyBatch | None
    if paused:
        service.set_paused(db_session, owner, True, now=last_now)
        assert service.begin_batch(db_session, campaign.id, campaign.end_date, last_now) is None
        final = db_session.scalars(select(ContentDailyBatch)).one()
        assert final.status == "skipped"
    else:
        final = service.begin_batch(db_session, campaign.id, campaign.end_date, last_now)
        assert final
        kinds: tuple[Kind, ...] = ("recipe", "workout")
        for kind in kinds:
            for index in range(5):
                stage(db_session, final, photo, index, kind, now=last_now)
        final.report = {"reasons": [], "attempted_sources": {"recipe": ["a"], "workout": ["b"]}}
        service.finish_batch(db_session, final.id, lease_token=lease_token(final), now=last_now)
        assert final.status == "complete"
        assert final.report["attempted_sources"] == {"recipe": ["a"], "workout": ["b"]}
    assert campaign.status == "completed"
    for value in (False, True):
        service.set_paused(db_session, owner, value, now=last_now)
        assert campaign.status == "completed"
    assert service.overview(db_session, owner, now=last_now)["campaign"]["status"] == "completed"


def test_campaign_never_generates_a_36th_date(
    owner: User, campaign: ContentCampaign, db_session: Session
) -> None:
    for index in range(35):
        scheduled = START + timedelta(days=index)
        now = NOW + timedelta(days=index)
        batch = service.begin_batch(db_session, campaign.id, scheduled, now)
        assert batch
        service.finish_batch(db_session, batch.id, lease_token=lease_token(batch), now=now)
    assert campaign.status == "completed"
    assert count(db_session, ContentDailyBatch) == 35
    assert service.overview(db_session, owner, now=now)["campaign"]["completed_days"] == 35
    assert (
        service.begin_batch(
            db_session, campaign.id, START + timedelta(days=35), NOW + timedelta(days=35)
        )
        is None
    )
    assert count(db_session, ContentDailyBatch) == 35


def test_active_lease_cannot_stage_or_renew_on_another_local_date(
    campaign: ContentCampaign, photo: str, db_session: Session
) -> None:
    before_midnight = datetime(2026, 10, 17, 3, 59, tzinfo=UTC)
    after_midnight = before_midnight + timedelta(minutes=2)
    batch = service.begin_batch(db_session, campaign.id, START, before_midnight)
    assert batch
    token = lease_token(batch)
    db_session.commit()
    for operation in (
        lambda: stage(db_session, batch, photo, now=after_midnight),
        lambda: service.renew_batch_lease(
            db_session, batch.id, lease_token=token, now=after_midnight
        ),
    ):
        with pytest.raises(HTTPException) as error:
            operation()
        assert error.value.status_code == 409
    assert count(db_session, ContentCandidate) == 0
    service.begin_batch(db_session, campaign.id, START + timedelta(days=1), after_midnight)
    assert batch.status == "partial" and "generation_window_expired" in batch.report["reasons"]


@pytest.mark.parametrize("operation", ["begin", "renew", "stage", "finish"])
def test_lease_helpers_preserve_unflushed_attempt_ledger(
    batch: ContentDailyBatch, photo: str, db_session: Session, operation: str
) -> None:
    attempts = {"recipe": ["recipe-attempt"], "workout": ["workout-attempt"]}
    batch.report = {"reasons": ["earlier_attempt_failed"], "attempted_sources": attempts}
    token = lease_token(batch)
    if operation == "begin":
        assert service.begin_batch(db_session, batch.campaign_id, START, NOW) is None
    elif operation == "renew":
        service.renew_batch_lease(db_session, batch.id, lease_token=token, now=NOW)
    elif operation == "stage":
        stage(db_session, batch, photo)
    else:
        service.finish_batch(db_session, batch.id, lease_token=token, now=NOW)
    db_session.expire(batch)
    assert batch.report["attempted_sources"] == attempts
    assert "earlier_attempt_failed" in batch.report["reasons"]


def test_account_export_empty_automation_remains_available_without_basic_access(
    client: TestClient,
    auth_headers: dict[str, str],
    owner: User,
    db_session: Session,
) -> None:
    owner.email_verified = False
    db_session.scalars(select(UserSubscription)).one().status = "inactive"
    db_session.commit()
    empty: dict[str, Any] = {"campaign": None, "batches": [], "candidates": []}
    assert service.account_export(db_session, owner) == empty
    response = client.get("/api/v1/auth/account/export", headers=auth_headers)
    assert response.status_code == 200
    assert response.headers["cache-control"] == "no-store"
    assert response.json()["content_automation"] == empty
    assert client.get("/api/v1/auth/account/export").status_code == 401


def test_account_export_contains_only_owned_campaign_batches_and_all_review_states(
    client: TestClient,
    auth_headers: dict[str, str],
    owner: User,
    batch: ContentDailyBatch,
    photo: str,
    db_session: Session,
) -> None:
    approved = stage(db_session, batch, photo)
    dismissed = stage(db_session, batch, photo, 1)
    pending = stage(db_session, batch, photo, kind="workout")
    service.decide(db_session, owner, batch.id, "approve", [approved.id])
    service.decide(db_session, owner, batch.id, "dismiss", [dismissed.id])
    other = User(email="export-other@example.com", password_hash=str(uuid4()), email_verified=True)
    db_session.add(other)
    db_session.flush()
    other_campaign = service.create_campaign(db_session, other.id, START)
    other_batch = service.begin_batch(db_session, other_campaign.id, START, NOW)
    assert other_batch
    other_candidate = ContentCandidate(
        batch_id=other_batch.id,
        user_id=other.id,
        kind="workout",
        slot=1,
        title="Other account private routine",
        payload=workout_payload(photo),
        source_url="https://publisher.example/other",
        source_name="Other account publisher",
        canonical_source_url="https://publisher.example/other",
        source_hash="a" * 64,
        content_hash="b" * 64,
        provenance={"private": "other-account-data"},
    )
    db_session.add(other_candidate)
    db_session.commit()
    exported = service.account_export(db_session, owner)
    assert exported["campaign"]["id"] == batch.campaign_id
    assert exported["campaign"]["days_total"] == 35
    assert [row["id"] for row in exported["batches"]] == [batch.id]
    assert {row["id"]: row["status"] for row in exported["candidates"]} == {
        approved.id: "approved",
        dismissed.id: "dismissed",
        pending.id: "pending",
    }
    other_export = service.account_export(db_session, other)
    assert other_export["campaign"]["id"] == other_campaign.id
    assert [row["id"] for row in other_export["batches"]] == [other_batch.id]
    assert [row["id"] for row in other_export["candidates"]] == [other_candidate.id]
    response = client.get("/api/v1/auth/account/export", headers=auth_headers)
    assert response.status_code == 200
    assert response.json()["content_automation"] == exported
    assert other.id not in json.dumps(exported)
    assert other_candidate.title not in response.text
    recipe = next(row for row in exported["candidates"] if row["id"] == approved.id)
    assert recipe["recipe_id"] == approved.recipe_id
    assert recipe["payload"]["nutrition"]["calories"] == 350
    recipe["payload"]["nutrition"]["calories"] = 999
    db_session.expire(approved)
    assert approved.payload["nutrition"]["calories"] == 350
    assert not db_session.dirty


@pytest.mark.parametrize("kind", ["recipe", "workout"])
def test_account_export_whitelists_nested_payload_and_excludes_operational_secrets(
    client: TestClient,
    auth_headers: dict[str, str],
    owner: User,
    batch: ContentDailyBatch,
    photo: str,
    db_session: Session,
    monkeypatch: pytest.MonkeyPatch,
    kind: Kind,
) -> None:
    candidate = stage(db_session, batch, photo, kind=kind)
    media = db_session.scalars(select(MediaObject)).one()
    secret = "private-provider-credential-sentinel"
    signed = f"{photo}?token=private-signed-token-sentinel"
    unsafe = {"photo_url": signed, "storage_key": media.storage_key, "provider_credentials": secret}
    payload = copy.deepcopy(candidate.payload) | unsafe | {"source_url": signed}
    for child in ("ingredients", "instructions", "exercises"):
        for item in payload.get(child, []):
            item.update(unsafe)
    if "nutrition" in payload:
        payload["nutrition"].update(unsafe)
    candidate.payload = payload
    candidate.source_url = signed
    candidate.provenance = unsafe
    candidate.warnings = [secret, signed]
    batch.report = {"reasons": [secret], "attempted_sources": {"recipe": [signed]}}
    db_session.commit()
    token = lease_token(batch)
    before = copy.deepcopy(candidate.payload)

    def no_photo_links(*args: Any, **kwargs: Any) -> None:
        raise AssertionError("Account export must not mint media links")

    monkeypatch.setattr(private_media, "photo_url", no_photo_links)
    response = client.get("/api/v1/auth/account/export", headers=auth_headers)
    assert response.status_code == 200, response.text
    exported = response.json()["content_automation"]
    serialized = json.dumps(exported)
    for forbidden in (
        "photo_url",
        "photo_credit",
        "storage_key",
        "provider_credentials",
        "source_url",
        "provenance",
        "warnings",
        "report",
        "lease_token",
        "lease_expires_at",
        "source_hash",
        "content_hash",
        secret,
        signed,
        photo,
        media.storage_key,
        token,
        candidate.source_hash,
        candidate.content_hash,
    ):
        assert forbidden not in serialized, forbidden
    result = exported["candidates"][0]
    assert result["title"] == candidate.title and result["kind"] == kind
    if kind == "recipe":
        assert result["payload"]["nutrition"]["fiber_g"] == 5
        assert result["payload"]["ingredients"][0]["original_text"]
        assert result["payload"]["instructions"][0]["text"]
    else:
        assert result["payload"]["exercises"][0]["sets"] == 3
    assert candidate.payload == before
    assert batch.report["attempted_sources"]["recipe"] == [signed]


def test_account_deletion_request_keeps_automation_data_for_manual_review(
    client: TestClient,
    auth_headers: dict[str, str],
    owner: User,
    batch: ContentDailyBatch,
    photo: str,
    db_session: Session,
) -> None:
    candidate = stage(db_session, batch, photo)
    db_session.commit()
    db_session.execute(text("PRAGMA foreign_keys = ON"))
    assert db_session.scalar(text("PRAGMA foreign_keys")) == 1
    before = service.account_export(db_session, owner)
    response = client.post(
        "/api/v1/auth/account/delete-request",
        headers=auth_headers,
        json={"current_password": "change-me-123", "confirmation": "DELETE"},
    )
    assert response.status_code == 200
    assert response.json() == {"status": "deletion_requested"}
    assert service.account_export(db_session, owner) == before
    assert db_session.get(User, owner.id) is owner and owner.is_active
    assert saved_candidate(db_session, candidate.id).status == "pending"
    event = db_session.scalars(
        select(AuditEvent).where(AuditEvent.event_type == "account_deletion_requested")
    ).one()
    assert event.payload["status"] == "pending_manual_review"


def test_additive_migration_upgrade_downgrade_matches_metadata() -> None:
    migration = runpy.run_path("alembic/versions/d9b46e13a702_content_automation.py")
    engine = create_engine("sqlite:///:memory:")
    names = {
        ContentCampaign.__tablename__,
        ContentDailyBatch.__tablename__,
        ContentCandidate.__tablename__,
    }
    with engine.begin() as connection:
        Base.metadata.create_all(
            connection,
            tables=[table for table in Base.metadata.sorted_tables if table.name not in names],
        )
        before = set(inspect(connection).get_table_names())
        with Operations.context(MigrationContext.configure(connection)):
            migration["upgrade"]()
        reflected = inspect(connection)
        assert set(reflected.get_table_names()) == before | names
        for name in names:
            assert {column["name"] for column in reflected.get_columns(name)} == set(
                Base.metadata.tables[name].columns.keys()
            )
            assert {item["name"] for item in reflected.get_unique_constraints(name)} == {
                constraint.name
                for constraint in Base.metadata.tables[name].constraints
                if constraint.__class__.__name__ == "UniqueConstraint"
            }
        connection.execute(text("PRAGMA foreign_keys = ON"))
        with Operations.context(MigrationContext.configure(connection)):
            migration["downgrade"]()
        assert set(inspect(connection).get_table_names()) == before
    engine.dispose()
