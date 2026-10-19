"""Transactional staging and owner review. No provider, scheduler, or network work.

Operator/worker helpers flush only. Commit a lease before external work and commit
each staged result to preserve it across crashes. Lease timestamps are naive UTC,
matching the existing database; injected ``now`` values must be timezone-aware.
"""

from __future__ import annotations

import ipaddress
import json
import re
import unicodedata
from datetime import UTC, date, datetime, timedelta
from hashlib import sha256
from typing import Any
from urllib.parse import parse_qsl, urlencode, urlsplit, urlunsplit
from uuid import uuid4
from zoneinfo import ZoneInfo

from fastapi import HTTPException
from pydantic import HttpUrl, TypeAdapter, ValidationError
from sqlalchemy import or_, select
from sqlalchemy.orm import Session, selectinload

from app.models.content_automation import ContentCampaign, ContentCandidate, ContentDailyBatch
from app.models.entities import Recipe, RecipeMacroProfile, RecipeSource, User, UserProfile
from app.models.security import MediaObject
from app.models.workouts import WorkoutTemplate
from app.schemas.content_automation import Kind, RecipeCandidateInput, WorkoutCandidateInput
from app.services import private_media, recipes, workouts
from app.services.groups import clean_preference_terms, matching_terms
from app.services.parsing import normalize_name
from app.services.photo_credit import credit_from_evidence

TIME_ZONE = "America/New_York"
DAYS_TOTAL = 35
DAILY_CAP = 5
LEASE_DURATION = timedelta(minutes=15)
TERMINAL_BATCHES = {"complete", "partial", "skipped"}
URL = TypeAdapter(HttpUrl)


def _now(now: datetime | None = None) -> datetime:
    value = now if now is not None else datetime.now(UTC)
    if value.tzinfo is None or value.utcoffset() is None:
        raise ValueError("now must be timezone-aware")
    return value.astimezone(UTC)


def _utc_naive(now: datetime) -> datetime:
    return now.astimezone(UTC).replace(tzinfo=None)


def canonical_source(value: str) -> str:
    """Canonicalize publisher identity without fetching a URL or resolving DNS."""
    try:
        value = str(URL.validate_python(value))
        parsed = urlsplit(value)
        host = (parsed.hostname or "").lower().rstrip(".")
        if parsed.username or parsed.password or not host:
            raise ValueError
        if host == "localhost" or host.endswith((".localhost", ".local", ".internal")):
            raise ValueError
        try:
            address = ipaddress.ip_address(host)
        except ValueError:
            address = None
        if address is not None and not address.is_global:
            raise ValueError
        if host.startswith("www."):
            host = host[4:]
        if ":" in host:
            host = f"[{host}]"
        port = parsed.port
        if port and port not in {80, 443}:
            host = f"{host}:{port}"
        query = sorted(
            (key, val)
            for key, val in parse_qsl(parsed.query, keep_blank_values=True)
            if not key.lower().startswith("utm_")
            and key.lower() not in {"fbclid", "gclid", "mc_cid", "mc_eid"}
        )
        return urlunsplit(("https", host, parsed.path.rstrip("/") or "/", urlencode(query), ""))
    except (ValidationError, ValueError, TypeError):
        raise HTTPException(422, "A public HTTP(S) publisher source URL is required.") from None


def _digest(value: Any) -> str:
    return sha256(json.dumps(value, sort_keys=True, allow_nan=False).encode()).hexdigest()


def source_identity(kind: str, canonical: str, provenance: dict[str, Any]) -> str:
    catalog_id = provenance.get("catalog_id") if kind == "workout" else None
    if catalog_id is not None:
        if not isinstance(catalog_id, str) or not re.fullmatch(
            r"[A-Za-z0-9][A-Za-z0-9._:-]{0,159}", catalog_id
        ):
            raise HTTPException(422, "Workout catalog_id must be a stable registry identifier.")
        return _digest([canonical, catalog_id])
    return _digest(canonical)


def _text(value: Any) -> str:
    value = unicodedata.normalize("NFKC", str(value or "")).casefold()
    return " ".join(re.findall(r"\w+", value))


def content_fingerprint(kind: str, payload: dict[str, Any]) -> str:
    if kind == "recipe":
        ingredients = sorted(
            (
                _text(item["original_text"]),
                str(float(item["quantity"])) if item.get("quantity") is not None else "",
                _text(item.get("unit")),
            )
            for item in payload["ingredients"]
        )
        body = [ingredients, [_text(step["text"]) for step in payload["instructions"]]]
    else:
        body = [
            [
                _text(item["name"]),
                item.get("sets"),
                _text(item.get("reps")),
                item.get("duration_seconds"),
            ]
            for item in payload["exercises"]
        ]
    # Names, formatting, images and provenance cannot disguise identical content.
    return _digest([kind, body])


def _lock_user(db: Session, user_id: str) -> User:
    user = db.scalar(
        select(User)
        .where(User.id == user_id)
        .with_for_update()
        .execution_options(populate_existing=True)
    )
    if not user or not user.is_active:
        raise HTTPException(404, "Account not found")
    return user


def _lock_campaign(db: Session, campaign_id: str) -> tuple[User, ContentCampaign]:
    owner_id = db.scalar(select(ContentCampaign.user_id).where(ContentCampaign.id == campaign_id))
    if not owner_id:
        raise HTTPException(404, "Campaign not found")
    user = _lock_user(db, owner_id)
    campaign = db.scalars(
        select(ContentCampaign)
        .where(ContentCampaign.id == campaign_id)
        .with_for_update()
        .execution_options(populate_existing=True)
    ).one()
    return user, campaign


def create_campaign(
    db: Session,
    user_id: str,
    start_date: date,
    time_zone: str = TIME_ZONE,
    days: int = DAYS_TOTAL,
) -> ContentCampaign:
    """Operator-only enrollment; identical provisioning retries are harmless."""
    if type(days) is not int or days != DAYS_TOTAL or time_zone != TIME_ZONE:
        raise HTTPException(422, "Campaigns require 35 dates in America/New_York.")
    if type(start_date) is not date:
        raise HTTPException(422, "An explicit campaign start date is required.")
    user = _lock_user(db, user_id)
    if not user.email_verified:
        raise HTTPException(403, "Verify the account before enrollment.")
    campaign = db.scalar(select(ContentCampaign).where(ContentCampaign.user_id == user_id))
    if campaign:
        if campaign.start_date != start_date:
            raise HTTPException(409, "This account already has a campaign.")
        return campaign
    campaign = ContentCampaign(
        user_id=user_id,
        start_date=start_date,
        end_date=start_date + timedelta(days=days - 1),
        time_zone=time_zone,
        days_total=days,
        status="active",
    )
    db.add(campaign)
    db.flush()
    return campaign


def _reasons(values: list[str] | None) -> list[str]:
    if values is None:
        return []
    if (
        not isinstance(values, list)
        or len(values) > 100
        or any(
            not isinstance(value, str) or not value.strip() or len(value) > 2000 for value in values
        )
    ):
        raise HTTPException(422, "Reasons and warnings must be nonempty strings (maximum 100).")
    return list(dict.fromkeys(value.strip() for value in values))


def _batch_candidates(db: Session, batch: ContentDailyBatch) -> list[ContentCandidate]:
    return list(
        db.scalars(
            select(ContentCandidate)
            .where(
                ContentCandidate.batch_id == batch.id,
                ContentCandidate.user_id == batch.user_id,
            )
            .order_by(ContentCandidate.kind, ContentCandidate.slot)
        )
    )


def _close_batch(
    db: Session, batch: ContentDailyBatch, reasons: list[str], now: datetime
) -> ContentDailyBatch:
    rows = _batch_candidates(db, batch)
    counts = {kind: sum(row.kind == kind for row in rows) for kind in ("recipe", "workout")}
    for kind, count in counts.items():
        if count < DAILY_CAP:
            reasons.append(f"{kind}_shortfall:{count}/{DAILY_CAP}")
    batch.status = "complete" if all(n == DAILY_CAP for n in counts.values()) else "partial"
    batch.report = {
        **batch.report,
        "reasons": list(dict.fromkeys([*batch.report.get("reasons", []), *reasons])),
    }
    batch.finished_at = _utc_naive(now)
    batch.lease_token = None
    batch.lease_expires_at = None
    campaign = db.get(ContentCampaign, batch.campaign_id)
    if campaign and batch.scheduled_date == campaign.end_date:
        campaign.status = "completed"
    db.flush()
    return batch


def begin_batch(
    db: Session, campaign_id: str, scheduled_date: date, now: datetime
) -> ContentDailyBatch | None:
    now = _now(now)
    user, campaign = _lock_campaign(db, campaign_id)
    # Preserve the caller's attempt ledger before refreshing batches under this lock.
    db.flush()
    local = now.astimezone(ZoneInfo(campaign.time_zone))
    today = local.date()
    # Previous-day work is finalized, never refilled or silently caught up.
    for old in db.scalars(
        select(ContentDailyBatch)
        .where(
            ContentDailyBatch.campaign_id == campaign.id,
            ContentDailyBatch.scheduled_date < today,
            ContentDailyBatch.status == "running",
        )
        .with_for_update()
        .execution_options(populate_existing=True)
    ):
        _close_batch(db, old, ["generation_window_expired"], now)
    if today > campaign.end_date:
        campaign.status = "completed"
        db.flush()
        return None
    if (
        not user.email_verified
        or campaign.status == "completed"
        or scheduled_date != today
        or today < campaign.start_date
        or local.hour < 6
    ):
        return None
    batch = db.scalar(
        select(ContentDailyBatch)
        .where(
            ContentDailyBatch.campaign_id == campaign.id,
            ContentDailyBatch.scheduled_date == scheduled_date,
        )
        .with_for_update()
        .execution_options(populate_existing=True)
    )
    if batch and batch.status in TERMINAL_BATCHES:
        return None
    if campaign.status == "paused":
        if not batch:
            batch = ContentDailyBatch(
                campaign_id=campaign.id,
                user_id=campaign.user_id,
                scheduled_date=scheduled_date,
                status="skipped",
                report={"reasons": ["campaign_paused"]},
                finished_at=_utc_naive(now),
            )
            db.add(batch)
        else:
            _close_batch(db, batch, ["campaign_paused"], now)
        if scheduled_date == campaign.end_date:
            campaign.status = "completed"
        db.flush()
        return None
    if batch and batch.lease_expires_at and batch.lease_expires_at > _utc_naive(now):
        return None
    if not batch:
        batch = ContentDailyBatch(
            campaign_id=campaign.id,
            user_id=campaign.user_id,
            scheduled_date=scheduled_date,
            attempts=0,
        )
        db.add(batch)
    batch.lease_token = str(uuid4())
    batch.lease_expires_at = _utc_naive(now + LEASE_DURATION)
    batch.attempts += 1
    db.flush()
    return batch


def _leased_batch(
    db: Session, batch_id: str, lease_token: str, now: datetime, *, staging: bool = True
) -> tuple[User, ContentDailyBatch]:
    campaign_id = db.scalar(
        select(ContentDailyBatch.campaign_id).where(ContentDailyBatch.id == batch_id)
    )
    if not campaign_id:
        raise HTTPException(404, "Batch not found")
    user, campaign = _lock_campaign(db, campaign_id)
    # Worker report updates may be pending in this flush-only transaction.
    db.flush()
    batch = db.scalars(
        select(ContentDailyBatch)
        .where(ContentDailyBatch.id == batch_id)
        .with_for_update()
        .execution_options(populate_existing=True)
    ).one()
    if (
        batch.status != "running"
        or not lease_token
        or batch.lease_token != lease_token
        or not batch.lease_expires_at
        or batch.lease_expires_at <= _utc_naive(now)
    ):
        raise HTTPException(409, "Batch lease expired or was replaced.")
    local = now.astimezone(ZoneInfo(campaign.time_zone))
    if staging and (
        campaign.status != "active"
        or not user.email_verified
        or local.date() != batch.scheduled_date
        or not campaign.start_date <= local.date() <= campaign.end_date
        or local.hour < 6
    ):
        raise HTTPException(409, "Batch generation is outside its active local date.")
    return user, batch


def renew_batch_lease(
    db: Session, batch_id: str, *, lease_token: str, now: datetime | None = None
) -> ContentDailyBatch:
    now = _now(now)
    _, batch = _leased_batch(db, batch_id, lease_token, now)
    batch.lease_expires_at = _utc_naive(now + LEASE_DURATION)
    db.flush()
    return batch


def _owned_photo(db: Session, user: User, source: str) -> MediaObject:
    media = private_media.local_object(db, source)
    if not media:
        raise HTTPException(422, "An owned uploaded photo is required; hotlinks are not allowed.")
    media = db.scalar(
        select(MediaObject)
        .where(MediaObject.id == media.id)
        .with_for_update()
        .execution_options(populate_existing=True)
    )
    if (
        not media
        or media.owner_user_id != user.id
        or media.deleted_at
        or not media.managed
        or media.size_bytes <= 0
        or media.content_type not in {"image/jpeg", "image/png", "image/webp"}
    ):
        raise HTTPException(422, "A real uploaded photo owned by this account is required.")
    if source.split("?", 1)[0] != private_media.object_url(media.id):
        raise HTTPException(422, "Use the canonical owned media object URL.")
    return media


def _validate_payload(
    db: Session,
    user: User,
    kind: str,
    payload: dict[str, Any],
    source_url: str,
    source_name: str,
    provenance: dict[str, Any],
) -> tuple[RecipeCandidateInput | WorkoutCandidateInput, dict[str, Any]]:
    if kind not in {"recipe", "workout"}:
        raise HTTPException(422, "Candidate kind must be recipe or workout.")
    if not isinstance(source_name, str) or not 1 <= len(source_name.strip()) <= 240:
        raise HTTPException(422, "A publisher source name is required.")
    canonical_source(source_url)
    try:
        if not isinstance(provenance, dict) or not provenance:
            raise ValueError
        if len(json.dumps([payload, provenance], allow_nan=False)) > 200_000:
            raise ValueError
        provenance = json.loads(json.dumps(provenance, allow_nan=False))
    except (ValueError, TypeError):
        raise HTTPException(422, "Bounded JSON publisher provenance is required.") from None
    try:
        if kind == "recipe":
            recipe = RecipeCandidateInput.model_validate(payload)
            if recipe.source_url and canonical_source(recipe.source_url) != canonical_source(
                source_url
            ):
                raise ValueError("Recipe source does not match publisher provenance.")
            recipe.source_url = source_url
            recipe.source_title = source_name.strip()
            recipe.source_type = "publisher"
            profile = db.scalar(
                select(UserProfile)
                .where(UserProfile.user_id == user.id)
                .with_for_update()
                .execution_options(populate_existing=True)
            )
            if profile:
                terms = clean_preference_terms(
                    [*(profile.allergens or []), *(profile.disliked_ingredients or [])]
                )
                ingredients = {
                    normalize_name(text)
                    for item in recipe.ingredients
                    for text in (item.original_text, item.normalized_name or "")
                    if text.strip()
                }
                if matching_terms(terms, ingredients):
                    raise HTTPException(422, "Recipe matches saved ingredient preferences.")
            nutrition_source = provenance.get("nutrition", {})
            if not isinstance(nutrition_source, dict) or not nutrition_source.get("source_url"):
                raise ValueError("Independently published nutrition source URL is required.")
            canonical_source(nutrition_source["source_url"])
            parsed: RecipeCandidateInput | WorkoutCandidateInput = recipe
        else:
            parsed = WorkoutCandidateInput.model_validate(payload)
    except (ValidationError, ValueError, TypeError):
        raise HTTPException(
            422, "Candidate content is incomplete or contains unsupported fields."
        ) from None
    if parsed.photo_url:
        media = _owned_photo(db, user, str(parsed.photo_url))
        image = provenance.get("image", {})
        if (
            not isinstance(image, dict)
            or image.get("permission_verified") is not True
            or any(
                not isinstance(image.get(field), str) or not image[field].strip()
                for field in ("source_url", "license", "license_url", "creator", "credit")
            )
        ):
            raise HTTPException(
                422, "Verified photo rights and full image attribution are required."
            )
        canonical_source(image["source_url"])
        canonical_source(image["license_url"])
        canonical_photo = private_media.object_url(media.id)
        if isinstance(parsed, RecipeCandidateInput):
            parsed.photo_url = canonical_photo
        else:
            parsed.photo_url = URL.validate_python(canonical_photo)
        # The pending staging row is a durable reference; existing media cleanup
        # integration must also recognize payload.photo_url while review is pending.
        media.claimed_at = datetime.utcnow()
        media.orphaned_at = None
    return parsed, provenance


def _library_duplicate(
    db: Session, user_id: str, kind: str, canonical: str, fingerprint: str
) -> bool:
    if kind == "recipe":
        rows = db.scalars(
            select(Recipe)
            .where(Recipe.owner_user_id == user_id)
            .options(selectinload(Recipe.ingredients), selectinload(Recipe.instructions))
        ).all()
        sources = list(
            db.scalars(
                select(RecipeSource.source_url)
                .join(Recipe, Recipe.id == RecipeSource.recipe_id)
                .where(Recipe.owner_user_id == user_id)
            )
        )
        sources.extend(row.source_url for row in rows)
        for source in sources:
            if source:
                try:
                    if canonical_source(source) == canonical:
                        return True
                except HTTPException:
                    pass
        for row in rows:
            if (
                row.ingredients
                and row.instructions
                and content_fingerprint(
                    kind,
                    {
                        "ingredients": [
                            {
                                "original_text": item.original_text,
                                "quantity": item.quantity,
                                "unit": item.unit,
                            }
                            for item in row.ingredients
                        ],
                        "instructions": [{"text": step.text} for step in row.instructions],
                    },
                )
                == fingerprint
            ):
                return True
        return False
    return any(
        content_fingerprint(kind, {"exercises": row.exercises}) == fingerprint
        for row in db.scalars(select(WorkoutTemplate).where(WorkoutTemplate.owner_id == user_id))
    )


def stage_candidate(
    db: Session,
    batch_id: str,
    kind: Kind,
    payload: dict[str, Any],
    source_url: str,
    source_name: str,
    provenance: dict[str, Any],
    warnings: list[str] | None = None,
    *,
    lease_token: str,
    now: datetime | None = None,
) -> ContentCandidate:
    now = _now(now)
    user, batch = _leased_batch(db, batch_id, lease_token, now)
    parsed, provenance = _validate_payload(
        db, user, kind, payload, source_url, source_name, provenance
    )
    clean = parsed.model_dump(mode="json")
    if isinstance(parsed, RecipeCandidateInput):
        ingredients, _ = recipes.recipe_children(parsed)
        clean["ingredients"] = ingredients
    canonical = canonical_source(source_url)
    source_hash = source_identity(kind, canonical, provenance)
    fingerprint = content_fingerprint(kind, clean)
    duplicate = db.scalar(
        select(ContentCandidate).where(
            ContentCandidate.user_id == user.id,
            ContentCandidate.kind == kind,
            or_(
                ContentCandidate.source_hash == source_hash,
                ContentCandidate.content_hash == fingerprint,
            ),
        )
    )
    if duplicate:
        if duplicate.batch_id == batch.id:
            return duplicate  # Never revive a dismissed or already approved result.
        raise HTTPException(409, "This source or normalized content was already staged.")
    if _library_duplicate(db, user.id, kind, canonical, fingerprint):
        raise HTTPException(409, "This source or normalized content is already in your library.")
    rows = _batch_candidates(db, batch)
    used = {row.slot for row in rows if row.kind == kind}
    if len(used) >= DAILY_CAP:
        raise HTTPException(409, f"The daily {kind} candidate limit is five.")
    candidate = ContentCandidate(
        batch_id=batch.id,
        user_id=user.id,
        kind=kind,
        slot=next(slot for slot in range(1, DAILY_CAP + 1) if slot not in used),
        status="pending",
        title=parsed.name if isinstance(parsed, RecipeCandidateInput) else parsed.title,
        payload=clean,
        source_url=source_url,
        source_name=source_name.strip(),
        canonical_source_url=canonical,
        source_hash=source_hash,
        content_hash=fingerprint,
        provenance=provenance,
        warnings=_reasons(warnings),
    )
    db.add(candidate)
    db.flush()
    return candidate


def finish_batch(
    db: Session,
    batch_id: str,
    reasons: list[str] | None = None,
    *,
    lease_token: str,
    now: datetime | None = None,
) -> ContentDailyBatch:
    now = _now(now)
    _, batch = _leased_batch(db, batch_id, lease_token, now, staging=False)
    return _close_batch(db, batch, _reasons(reasons), now)


def _owned_batch(db: Session, user_id: str, batch_id: str) -> ContentDailyBatch:
    batch = db.scalar(
        select(ContentDailyBatch).where(
            ContentDailyBatch.id == batch_id, ContentDailyBatch.user_id == user_id
        )
    )
    if not batch:
        raise HTTPException(404, "Batch not found")
    return batch


def _summary(batch: ContentDailyBatch, rows: list[ContentCandidate]) -> dict[str, Any]:
    return {
        "id": batch.id,
        "scheduled_date": batch.scheduled_date,
        "status": batch.status,
        "recipe_count": sum(row.kind == "recipe" for row in rows),
        "workout_count": sum(row.kind == "workout" for row in rows),
        "pending_count": sum(row.status == "pending" for row in rows),
        "approved_count": sum(row.status == "approved" for row in rows),
        "dismissed_count": sum(row.status == "dismissed" for row in rows),
        "report": {"reasons": batch.report.get("reasons", [])},
    }


def overview(db: Session, user: User, *, now: datetime | None = None) -> dict[str, Any]:
    campaign = db.scalar(select(ContentCampaign).where(ContentCampaign.user_id == user.id))
    if not campaign:
        return {"campaign": None, "batches": []}
    rows = db.scalars(
        select(ContentDailyBatch)
        .where(ContentDailyBatch.campaign_id == campaign.id, ContentDailyBatch.user_id == user.id)
        .order_by(ContentDailyBatch.scheduled_date.desc())
    ).all()
    summaries = [_summary(batch, _batch_candidates(db, batch)) for batch in rows]
    today = _now(now).astimezone(ZoneInfo(campaign.time_zone)).date()
    return {
        "campaign": {
            "id": campaign.id,
            "status": "completed" if today > campaign.end_date else campaign.status,
            "time_zone": campaign.time_zone,
            "start_date": campaign.start_date,
            "end_date": campaign.end_date,
            "days_total": campaign.days_total,
            "completed_days": sum(batch.status in TERMINAL_BATCHES for batch in rows),
            "pending_count": sum(batch["pending_count"] for batch in summaries),
        },
        "batches": summaries,
    }


def batch_detail(db: Session, user: User, batch_id: str) -> dict[str, Any]:
    batch = _owned_batch(db, user.id, batch_id)
    rows = _batch_candidates(db, batch)
    result = _summary(batch, rows) | {"recipes": [], "workouts": []}
    for row in rows:
        source = row.payload.get("photo_url")
        media = private_media.local_object(db, source) if source else None
        photo = (
            private_media.photo_url(
                db, user, "objects", media.id, private_media.object_url(media.id)
            )
            if media and media.owner_user_id == user.id
            else None
        )
        # Do not leak storage URLs or stale signed links through the payload.
        payload = dict(row.payload)
        if "photo_url" in payload:
            payload["photo_url"] = photo
        result["recipes" if row.kind == "recipe" else "workouts"].append(
            {
                "id": row.id,
                "kind": row.kind,
                "status": row.status,
                "title": row.title,
                "payload": payload,
                "photo_url": photo,
                "photo_credit": credit_from_evidence(row.provenance.get("image"))
                if photo
                else None,
                "source_url": row.source_url,
                "source_name": row.source_name,
                "warnings": row.warnings,
            }
        )
    return result


def _export_payload(kind: str, payload: dict[str, Any]) -> dict[str, Any]:
    def fields(value: Any, names: tuple[str, ...]) -> dict[str, Any]:
        if not isinstance(value, dict):
            return {}
        return {
            name: value[name]
            for name in names
            if name in value and (value[name] is None or isinstance(value[name], str | int | float))
        }

    children: dict[str, tuple[str, ...]]
    if kind == "workout":
        result = fields(payload, ("title", "category", "description"))
        children = {"exercises": ("name", "sets", "reps", "duration_seconds")}
    else:
        result = fields(
            payload,
            (
                "name",
                "description",
                "servings",
                "prep_minutes",
                "cook_minutes",
                "total_minutes",
                "difficulty",
                "cuisine",
                "meal_type",
            ),
        )
        tags = payload.get("tags")
        if isinstance(tags, list):
            result["tags"] = [tag for tag in tags if isinstance(tag, str)]
        result["nutrition"] = fields(
            payload.get("nutrition"), ("calories", "protein_g", "carbs_g", "fat_g", "fiber_g")
        )
        children = {
            "ingredients": (
                "original_text",
                "normalized_name",
                "quantity",
                "unit",
                "preparation_note",
                "is_optional",
                "section",
                "sort_order",
            ),
            "instructions": ("step_number", "text", "section", "timer_minutes"),
        }
    for name, names in children.items():
        items = payload.get(name)
        if isinstance(items, list):
            result[name] = [fields(item, names) for item in items if isinstance(item, dict)]
    return result


def account_export(db: Session, user: User) -> dict[str, Any]:
    """Export owned review content, never worker reports, provenance, or media URLs."""
    campaign = db.scalar(select(ContentCampaign).where(ContentCampaign.user_id == user.id))
    if not campaign:
        return {"campaign": None, "batches": [], "candidates": []}
    batches = list(
        db.scalars(
            select(ContentDailyBatch)
            .where(
                ContentDailyBatch.campaign_id == campaign.id, ContentDailyBatch.user_id == user.id
            )
            .order_by(ContentDailyBatch.scheduled_date, ContentDailyBatch.id)
        )
    )
    candidates = db.scalars(
        select(ContentCandidate)
        .where(
            ContentCandidate.user_id == user.id,
            ContentCandidate.batch_id.in_([batch.id for batch in batches]),
        )
        .order_by(ContentCandidate.batch_id, ContentCandidate.kind, ContentCandidate.slot)
    )
    return {
        "campaign": {
            "id": campaign.id,
            "status": campaign.status,
            "time_zone": campaign.time_zone,
            "start_date": campaign.start_date.isoformat(),
            "end_date": campaign.end_date.isoformat(),
            "days_total": campaign.days_total,
            "created_at": campaign.created_at.isoformat(),
            "updated_at": campaign.updated_at.isoformat(),
        },
        "batches": [
            {
                "id": batch.id,
                "campaign_id": batch.campaign_id,
                "scheduled_date": batch.scheduled_date.isoformat(),
                "status": batch.status,
                "attempts": batch.attempts,
                "finished_at": batch.finished_at.isoformat() if batch.finished_at else None,
                "created_at": batch.created_at.isoformat(),
                "updated_at": batch.updated_at.isoformat(),
            }
            for batch in batches
        ],
        "candidates": [
            {
                "id": row.id,
                "batch_id": row.batch_id,
                "kind": row.kind,
                "slot": row.slot,
                "status": row.status,
                "title": row.title,
                "source_name": row.source_name,
                "payload": _export_payload(row.kind, row.payload),
                "recipe_id": row.recipe_id,
                "workout_template_id": row.workout_template_id,
                "decided_at": row.decided_at.isoformat() if row.decided_at else None,
                "created_at": row.created_at.isoformat(),
                "updated_at": row.updated_at.isoformat(),
            }
            for row in candidates
        ],
    }


def set_paused(
    db: Session, user: User, paused: bool, *, now: datetime | None = None
) -> dict[str, Any]:
    now = _now(now)
    _lock_user(db, user.id)
    campaign = db.scalar(
        select(ContentCampaign)
        .where(ContentCampaign.user_id == user.id)
        .with_for_update()
        .execution_options(populate_existing=True)
    )
    if not campaign:
        raise HTTPException(404, "Campaign not found")
    today = now.astimezone(ZoneInfo(campaign.time_zone)).date()
    if campaign.status == "completed" or today > campaign.end_date:
        campaign.status = "completed"
    else:
        campaign.status = "paused" if paused else "active"
    db.flush()
    return overview(db, user, now=now)


def decide(
    db: Session, user: User, batch_id: str, action: str, candidate_ids: list[str]
) -> dict[str, Any]:
    """Caller commits once; a failed multi-candidate decision rolls back all writes."""
    if action not in {"approve", "dismiss"} or not 1 <= len(candidate_ids) <= 10:
        raise HTTPException(422, "Choose approve or dismiss and one to ten candidates.")
    if len(set(candidate_ids)) != len(candidate_ids):
        raise HTTPException(422, "Candidate IDs must be unique.")
    _lock_user(db, user.id)
    batch = _owned_batch(db, user.id, batch_id)
    # Account -> campaign -> batch -> candidate -> media is the shared lock order.
    _lock_campaign(db, batch.campaign_id)
    db.scalar(select(ContentDailyBatch).where(ContentDailyBatch.id == batch.id).with_for_update())
    rows = list(
        db.scalars(
            select(ContentCandidate)
            .where(
                ContentCandidate.batch_id == batch.id,
                ContentCandidate.user_id == user.id,
                ContentCandidate.id.in_(candidate_ids),
            )
            .order_by(ContentCandidate.id)
            .with_for_update()
            .execution_options(populate_existing=True)
        )
    )
    if {row.id for row in rows} != set(candidate_ids):
        raise HTTPException(404, "Candidate not found")
    target = "approved" if action == "approve" else "dismissed"
    if any(row.status not in {"pending", target} for row in rows):
        raise HTTPException(409, "Reviewed candidates cannot change decisions.")
    for row in rows:
        if row.status == target:
            continue
        if action == "approve":
            parsed, provenance = _validate_payload(
                db, user, row.kind, row.payload, row.source_url, row.source_name, row.provenance
            )
            fingerprint = content_fingerprint(row.kind, row.payload)
            canonical = canonical_source(row.source_url)
            if (
                fingerprint != row.content_hash
                or canonical != row.canonical_source_url
                or source_identity(row.kind, canonical, provenance) != row.source_hash
            ):
                raise HTTPException(409, "Candidate content changed; regenerate it for review.")
            if _library_duplicate(db, user.id, row.kind, canonical, fingerprint):
                raise HTTPException(
                    409, "This source or normalized content is already in your library."
                )
            if isinstance(parsed, RecipeCandidateInput):
                recipe = recipes.create_recipe(db, parsed, user, commit=False)
                # Manual creation inherits a household; automation approval is private.
                recipe.household_id = None
                profile = db.scalars(
                    select(RecipeMacroProfile).where(RecipeMacroProfile.recipe_id == recipe.id)
                ).one()
                profile.source = "publisher"
                profile.confidence = 0.7
                profile.needs_review = True
                recipe.photo_attribution = provenance["image"]["credit"]
                recipe.photo_source_url = provenance["image"]["source_url"]
                recipe.image_status = "validated"
                recipe.validation_status = "approved"
                db.add(
                    RecipeSource(
                        recipe_id=recipe.id,
                        source_type="publisher",
                        source_url=row.source_url,
                        source_title=row.source_name,
                        provenance=provenance,
                    )
                )
                row.recipe_id = recipe.id
            else:
                template = workouts.save_template(db, user, parsed)
                row.workout_template_id = template.id
        row.status = target
        row.decided_at = datetime.utcnow()
        db.flush()
    return batch_detail(db, user, batch.id)
