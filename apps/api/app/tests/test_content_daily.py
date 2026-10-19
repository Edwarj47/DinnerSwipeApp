from __future__ import annotations

import asyncio
from datetime import UTC, date, datetime, timedelta
from typing import Any
from unittest.mock import Mock
from uuid import uuid4
from zoneinfo import ZoneInfo

import pytest
from sqlalchemy import select
from sqlalchemy.orm import Session, sessionmaker

from app.models.content_automation import ContentCampaign, ContentCandidate, ContentDailyBatch
from app.models.entities import Recipe, User
from app.models.security import MediaObject
from app.models.workouts import WorkoutTemplate
from app.services import content_automation as service
from app.services.content_media import ResolvedPhoto
from app.services.private_media import local_object, object_url
from app.workers import content_daily as worker

NOW = datetime(2026, 10, 16, 10, 0, tzinfo=UTC)
PHOTO = {
    "source_url": "https://commons.wikimedia.org/wiki/File:Training.jpg",
    "license": "Public domain",
    "license_url": "https://creativecommons.org/publicdomain/mark/1.0/",
    "creator": "Test photographer",
    "credit": "Test photographer, public domain",
    "permission_verified": True,
}


def source(kind: str, key: str) -> dict[str, Any]:
    index = int(key.rsplit("-", 1)[1]) + 1
    if kind == "recipe":
        payload: dict[str, Any] = {
            "name": f"Bean meal {index}",
            "servings": 4,
            "prep_minutes": 10,
            "cook_minutes": 20,
            "total_minutes": 30,
            "meal_type": "dinner",
            "ingredients": [
                {
                    "original_text": f"{index} cups beans",
                    "normalized_name": "beans",
                    "quantity": float(index),
                    "unit": "cup",
                }
            ],
            "instructions": [{"step_number": 1, "text": f"Cook and divide into {index} bowls."}],
            "nutrition": {
                "calories": 250,
                "protein_g": 12,
                "carbs_g": 30,
                "fat_g": 7,
                "fiber_g": 8,
            },
        }
    else:
        payload = {
            "title": f"Routine {index}",
            "category": "full_body",
            "description": "Equipment: mat. Difficulty: beginner. Warm-up: march. "
            "Work slowly with controlled technique. Rest: 60 seconds. "
            "Cooldown: easy walking. Duration: about 20 minutes.",
            "exercises": [{"name": f"Movement {index}", "sets": 2, "reps": "8-12"}],
        }
    url = "https://publisher.example/" + key
    return {
        "kind": kind,
        "payload": payload,
        "photo_url": "https://upload.wikimedia.org/a.jpg",
        "source_url": url,
        "source_name": "Source",
        "warnings": [],
        "provenance": {
            "catalog_id": key,
            "image": PHOTO,
            "nutrition": {"source_url": url, "basis": "serving"},
        },
    }


@pytest.fixture()
def campaign(
    db_session: Session,
    auth_headers: dict[str, str],
    monkeypatch: pytest.MonkeyPatch,
) -> ContentCampaign:
    del auth_headers
    user = db_session.scalar(select(User).where(User.email == "owner@example.com"))
    assert user
    campaign = service.create_campaign(db_session, user.id, date(2026, 10, 16))
    db_session.commit()
    sessions = sessionmaker(bind=db_session.get_bind(), expire_on_commit=False)
    monkeypatch.setattr(worker, "SessionLocal", sessions)
    monkeypatch.setattr(worker, "utcnow", lambda: NOW)
    monkeypatch.setattr(worker, "source_keys", lambda kind: [f"{kind}-{n}" for n in range(30)])

    async def load(kind: str, key: str) -> dict[str, Any]:
        return source(kind, key)

    async def photo(item: dict[str, Any], cache: object) -> tuple[ResolvedPhoto, bytes]:
        return ResolvedPhoto(item["photo_url"], PHOTO), b"photo validated separately"

    async def sleep(_: float) -> None:
        pass

    def own(user_id: str, item: object, resolved: object, data: bytes) -> str:
        with sessions() as db:
            media = MediaObject(
                owner_user_id=user_id,
                storage_key=f"uploads/{user_id}/{uuid4()}.jpg",
                backend="local",
                content_type="image/jpeg",
                size_bytes=len(data),
            )
            db.add(media)
            db.commit()
            return object_url(media.id)

    monkeypatch.setattr(worker, "source_record", load)
    monkeypatch.setattr(worker, "resolve_photo", photo)
    monkeypatch.setattr(worker, "own_photo", own)
    monkeypatch.setattr(asyncio, "sleep", sleep)
    return campaign


def test_worker_stages_five_each_but_never_publishes(
    db_session: Session,
    campaign: ContentCampaign,
) -> None:
    result = asyncio.run(worker.prepare_campaign(campaign.id))
    assert result["recipes"] == result["workouts"] == 5
    assert not db_session.scalars(select(Recipe)).all()
    assert not db_session.scalars(select(WorkoutTemplate)).all()
    db_session.expire_all()
    rows = db_session.scalars(select(ContentCandidate)).all()
    assert len(rows) == 10 and all(row.status == "pending" for row in rows)
    batch = db_session.scalar(select(ContentDailyBatch))
    assert batch and batch.status == "complete"
    assert all(len(batch.report["attempted_sources"][kind]) == 5 for kind in ("recipe", "workout"))
    assert asyncio.run(worker.prepare_campaign(campaign.id))["status"] == "not_due"


def test_outbound_attempts_bounded_and_failures_do_not_publish(
    db_session: Session,
    campaign: ContentCampaign,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    calls = Mock()

    async def fail(kind: str, key: str) -> dict[str, Any]:
        calls(kind, key)
        raise ValueError("Source incomplete")

    monkeypatch.setattr(worker, "source_record", fail)
    result = asyncio.run(worker.prepare_campaign(campaign.id))
    assert result["recipes"] == result["workouts"] == 0
    assert calls.call_count == 40
    db_session.expire_all()
    batch = db_session.scalar(select(ContentDailyBatch))
    assert batch and batch.status == "partial"
    assert all(len(batch.report["attempted_sources"][kind]) == 20 for kind in ("recipe", "workout"))
    assert len(batch.report["reasons"]) >= 2
    assert not db_session.scalars(select(Recipe)).all()


def test_source_reservation_survives_restart(
    db_session: Session,
    campaign: ContentCampaign,
) -> None:
    batch = service.begin_batch(db_session, campaign.id, NOW.date(), NOW)
    assert batch and batch.lease_token
    db_session.commit()
    assert worker.reserve_attempt(batch.id, batch.lease_token, "recipe", "recipe-0")
    db_session.expire_all()
    batch = db_session.get(ContentDailyBatch, batch.id)
    assert batch
    batch.lease_expires_at = NOW.replace(tzinfo=None) - timedelta(seconds=1)
    db_session.commit()
    result = asyncio.run(worker.prepare_campaign(campaign.id))
    assert result["recipes"] == result["workouts"] == 5
    db_session.expire_all()
    batch = db_session.get(ContentDailyBatch, batch.id)
    assert batch and len(batch.report["attempted_sources"]["recipe"]) == 6


def test_finite_timer_has_35_local_dates_across_dst() -> None:
    campaign = ContentCampaign(
        start_date=date(2026, 10, 16),
        end_date=date(2026, 11, 19),
        days_total=35,
        time_zone="America/New_York",
    )
    lines = [
        line for line in worker.timer_text(campaign).splitlines() if line.startswith("OnCalendar=")
    ]
    assert len(lines) == 35
    assert lines[0] == "OnCalendar=2026-10-16 06:00:00 America/New_York"
    assert lines[-1] == "OnCalendar=2026-11-19 06:00:00 America/New_York"
    zone = ZoneInfo(campaign.time_zone)
    before = datetime(2026, 10, 31, 6, tzinfo=zone).astimezone(UTC)
    after = datetime(2026, 11, 1, 6, tzinfo=zone).astimezone(UTC)
    assert after - before == timedelta(hours=25)


def test_pending_photo_survives_cleanup(db_session: Session, campaign: ContentCampaign) -> None:
    from app.services.media_maintenance import referenced

    asyncio.run(worker.prepare_campaign(campaign.id))
    db_session.expire_all()
    candidate = db_session.scalar(select(ContentCandidate))
    assert candidate
    media = local_object(db_session, candidate.payload["photo_url"])
    assert media and referenced(db_session, media)
