from __future__ import annotations

from copy import deepcopy
from datetime import UTC, datetime
from typing import Any
from urllib.parse import parse_qs, urlsplit, urlunsplit
from uuid import UUID

from fastapi import HTTPException
from sqlalchemy import ColumnElement, or_, select
from sqlalchemy.orm import Session

from app.core.config import settings
from app.models.entities import Household, HouseholdMember, User
from app.models.security import MediaObject
from app.models.workouts import (
    WorkoutLog,
    WorkoutPlan,
    WorkoutPlanSlot,
    WorkoutProposal,
    WorkoutTemplate,
    WorkoutTemplateShare,
)


def brand_photo() -> str:
    return f"{settings.public_api_url.rstrip('/')}/api/v1/brand/logo.png"


def object_id(source: str) -> str | None:
    from app.services.private_media import object_url

    parsed = urlsplit(source)
    prefix = "/api/v1/media/objects/"
    if not parsed.path.startswith(prefix) or parsed.fragment or parsed.username or parsed.password:
        return None
    if set(parse_qs(parsed.query, keep_blank_values=True)) - {"token", "v"}:
        return None
    try:
        media_id = str(UUID(parsed.path.removeprefix(prefix)))
    except ValueError:
        return None
    base = urlunsplit(parsed._replace(query="", fragment=""))
    return media_id if base == object_url(media_id) else None


def canonical_photo(db: Session, user: User, source: str | None) -> str | None:
    if not source:
        return None
    media_id = object_id(source)
    if not media_id:
        raise HTTPException(422, "Use an uploaded workout photo.")
    media = db.scalar(
        select(MediaObject)
        .where(
            MediaObject.id == media_id,
            MediaObject.owner_user_id == user.id,
            MediaObject.deleted_at.is_(None),
        )
        .with_for_update()
        .execution_options(populate_existing=True)
    )
    if not media:
        raise HTTPException(404, "Photo not found")
    from app.services.private_media import object_url

    media.claimed_at = datetime.now(UTC).replace(tzinfo=None)
    media.orphaned_at = None
    return object_url(media.id)


def snapshot_reference(column: Any, reference: str) -> ColumnElement[bool]:
    return or_(
        column["photo_url"].as_string() == reference,
        column["photo_reference"].as_string() == reference,
    )


def allows_photo(db: Session, user: User, media: MediaObject) -> bool:
    from app.services.private_media import object_url

    reference = object_url(media.id)
    if db.scalar(
        select(WorkoutTemplate.id)
        .where(WorkoutTemplate.owner_id == user.id, WorkoutTemplate.photo_url == reference)
        .limit(1)
    ):
        return True
    # Private logs and personal plan snapshots retain media but never grant another owner's rights.
    membership = (HouseholdMember.user_id == user.id, Household.is_personal.is_(False))
    queries = (
        select(WorkoutTemplateShare.id)
        .join(HouseholdMember, HouseholdMember.household_id == WorkoutTemplateShare.household_id)
        .join(Household, Household.id == WorkoutTemplateShare.household_id)
        .where(*membership, snapshot_reference(WorkoutTemplateShare.snapshot, reference)),
        select(WorkoutPlanSlot.id)
        .join(WorkoutPlan, WorkoutPlan.id == WorkoutPlanSlot.plan_id)
        .join(HouseholdMember, HouseholdMember.household_id == WorkoutPlan.household_id)
        .join(Household, Household.id == WorkoutPlan.household_id)
        .where(*membership, snapshot_reference(WorkoutPlanSlot.snapshot, reference)),
        select(WorkoutProposal.id)
        .join(HouseholdMember, HouseholdMember.household_id == WorkoutProposal.household_id)
        .join(Household, Household.id == WorkoutProposal.household_id)
        .where(*membership, snapshot_reference(WorkoutProposal.snapshot, reference)),
    )
    return any(db.scalar(query.limit(1)) for query in queries)


def referenced(db: Session, media: MediaObject) -> bool:
    from app.services.private_media import object_url

    reference = object_url(media.id)
    if db.scalar(select(WorkoutTemplate.id).where(WorkoutTemplate.photo_url == reference).limit(1)):
        return True
    return any(
        db.scalar(select(model.id).where(snapshot_reference(model.snapshot, reference)).limit(1))
        for model in (WorkoutTemplateShare, WorkoutPlanSlot, WorkoutProposal, WorkoutLog)
    )


def render_snapshot(db: Session, user: User, snapshot: dict[str, Any]) -> dict[str, Any]:
    from app.services.private_media import object_url, photo_url, source_for

    result = deepcopy(snapshot)
    result["photo_url"] = brand_photo()
    result["photo_reference"] = None
    source = snapshot.get("photo_reference") or snapshot.get("photo_url")
    media_id = object_id(source) if isinstance(source, str) else None
    if not media_id:
        return result
    try:
        source_for(db, user, "objects", media_id)
    except HTTPException as exc:
        if exc.status_code != 404:
            raise
        return result
    reference = object_url(media_id)
    result["photo_reference"] = reference
    result["photo_url"] = photo_url(db, user, "objects", media_id, reference) or brand_photo()
    return result
