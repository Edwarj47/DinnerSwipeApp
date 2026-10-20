"""Private source leads stored separately from publishable batch candidates.

Discovery state lives in the existing batch report: no migration or changes to
recipes, workouts, logs or the immutable candidate approval snapshots are needed.
"""

from __future__ import annotations

from datetime import datetime, timedelta
from typing import Any
from uuid import uuid4
from zoneinfo import ZoneInfo

from fastapi import HTTPException
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models.content_automation import ContentCandidate, ContentDailyBatch
from app.models.entities import User
from app.schemas.content_automation import DiscoveredSource
from app.services import content_automation as service
from app.services.content_discovery_sources import allowed_source, source_id

KEY = "source_discovery"
LEASE = timedelta(minutes=3)


def _locked_batch(db: Session, batch_id: str) -> ContentDailyBatch:
    return db.scalars(
        select(ContentDailyBatch)
        .where(ContentDailyBatch.id == batch_id)
        .with_for_update()
        .execution_options(populate_existing=True)
    ).one()


def begin(db: Session, campaign_id: str, now: datetime) -> tuple[str, str, int, set[str]] | None:
    now = service._now(now)
    user, campaign = service._lock_campaign(db, campaign_id)
    local = now.astimezone(ZoneInfo(campaign.time_zone))
    day = local.date()
    if (
        not user.email_verified
        or campaign.status == "paused"
        or local.hour < 6
        or not campaign.start_date <= day <= campaign.end_date
    ):
        return None
    batch_id = db.scalar(
        select(ContentDailyBatch.id).where(
            ContentDailyBatch.campaign_id == campaign.id,
            ContentDailyBatch.scheduled_date == day,
        )
    )
    if not batch_id:
        return None
    batch = _locked_batch(db, batch_id)
    state = dict(batch.report.get(KEY, {}))
    if state.get("status") in {"complete", "partial"}:
        return None
    expiry = state.get("lease_expires_at")
    if expiry and datetime.fromisoformat(expiry) > now:
        return None
    if state.get("attempts", 0) >= 2:
        batch.report = {
            **batch.report,
            KEY: {
                "status": "partial",
                "sources": [],
                "attempts": state["attempts"],
                "reasons": [
                    "Source discovery stopped after interrupted attempts. No content published."
                ],
            },
        }
        db.flush()
        return None
    token = str(uuid4())
    batch.report = {
        **batch.report,
        KEY: {
            "status": "running",
            "attempts": state.get("attempts", 0) + 1,
            "lease_token": token,
            "lease_expires_at": (now + LEASE).isoformat(),
            "sources": [],
            "reasons": [],
        },
    }
    seen = {
        item["id"]
        for report in db.scalars(
            select(ContentDailyBatch.report).where(
                ContentDailyBatch.user_id == user.id,
            )
        )
        for item in report.get(KEY, {}).get("sources", [])
    }
    # Already compiled publisher links do not need another source review.
    for candidate in db.scalars(
        select(ContentCandidate).where(ContentCandidate.user_id == user.id)
    ):
        seen.add(source_id(candidate.kind, candidate.source_url))
        for guidance in candidate.provenance.get("guidance", []):
            if isinstance(guidance, dict) and isinstance(guidance.get("url"), str):
                seen.add(source_id(candidate.kind, guidance["url"]))
    db.flush()
    return batch.id, token, (day - campaign.start_date).days, seen


def finish(
    db: Session,
    batch_id: str,
    token: str,
    sources: list[dict[str, str]],
    reasons: list[str],
    now: datetime,
) -> None:
    campaign_id = db.scalar(
        select(ContentDailyBatch.campaign_id).where(ContentDailyBatch.id == batch_id)
    )
    if not campaign_id:
        raise HTTPException(404, "Batch not found")
    user, _ = service._lock_campaign(db, campaign_id)
    if not user.email_verified:
        raise HTTPException(403, "Verify the account before source collection.")
    batch = _locked_batch(db, batch_id)
    state = dict(batch.report.get(KEY, {}))
    if (
        state.get("status") != "running"
        or state.get("lease_token") != token
        or datetime.fromisoformat(state["lease_expires_at"]) <= service._now(now)
    ):
        raise HTTPException(409, "Discovery lease expired")
    parsed = [DiscoveredSource.model_validate(item) for item in sources]
    prior_ids = {
        item["id"]
        for report in db.scalars(
            select(ContentDailyBatch.report).where(
                ContentDailyBatch.user_id == user.id,
                ContentDailyBatch.id != batch.id,
            )
        )
        for item in report.get(KEY, {}).get("sources", [])
    }
    if (
        len(parsed) > 10
        or len({item.id for item in parsed}) != len(parsed)
        or any(item.id in prior_ids for item in parsed)
        or any(sum(item.kind == kind for item in parsed) > 5 for kind in ("recipe", "workout"))
        or any(
            not allowed_source(item.source_url, item.kind)
            or item.id != source_id(item.kind, item.source_url)
            or item.status != "pending"
            for item in parsed
        )
    ):
        raise HTTPException(422, "Invalid source discovery results")
    batch.report = {
        **batch.report,
        KEY: {
            "status": "complete" if not reasons and len(parsed) == 10 else "partial",
            "attempts": state["attempts"],
            "sources": [item.model_dump() for item in parsed],
            "reasons": service._reasons(reasons),
        },
    }
    db.flush()


def overview(db: Session, user: User) -> dict[str, Any]:
    runs = []
    for batch in db.scalars(
        select(ContentDailyBatch)
        .where(
            ContentDailyBatch.user_id == user.id,
        )
        .order_by(ContentDailyBatch.scheduled_date.desc())
        .limit(service.DAYS_TOTAL)
    ):
        state = batch.report.get(KEY)
        if state:
            # Explicit allowlist: lease tokens and attempt details never leave the service.
            runs.append(
                {
                    "id": batch.id,
                    "scheduled_date": batch.scheduled_date,
                    "status": state["status"],
                    "sources": state.get("sources", []),
                    "reasons": state.get("reasons", []),
                }
            )
    return {"runs": runs}


def dismiss(db: Session, user: User, batch_id: str, identifiers: list[str]) -> dict[str, Any]:
    batch = db.scalar(
        select(ContentDailyBatch).where(
            ContentDailyBatch.id == batch_id,
            ContentDailyBatch.user_id == user.id,
        )
    )
    if not batch:
        raise HTTPException(404, "Batch not found")
    service._lock_campaign(db, batch.campaign_id)
    batch = _locked_batch(db, batch_id)
    state = dict(batch.report.get(KEY, {}))
    sources = [dict(item) for item in state.get("sources", [])]
    if state.get("status") == "running":
        raise HTTPException(409, "Source collection is still running")
    if not set(identifiers) <= {item["id"] for item in sources}:
        raise HTTPException(404, "Source not found")
    for item in sources:
        if item["id"] in identifiers:
            item["status"] = "dismissed"
    batch.report = {**batch.report, KEY: {**state, "sources": sources}}
    db.flush()
    return overview(db, user)
