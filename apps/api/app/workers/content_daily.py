"""Finite, account-private recipe/workout batches. Never publishes library records."""

from __future__ import annotations

import argparse
import asyncio
import hashlib
import json
import logging
import time
from dataclasses import asdict, is_dataclass
from datetime import UTC, date, datetime, timedelta
from typing import Any
from zoneinfo import ZoneInfo

from fastapi import HTTPException
from sqlalchemy import select

from app.database.session import SessionLocal
from app.models.content_automation import ContentCampaign, ContentCandidate
from app.models.entities import User
from app.schemas.content_automation import RecipeCandidateInput, WorkoutCandidateInput
from app.services import content_automation as service
from app.services.content_media import ResolvedPhoto, commons_photo, photo_bytes
from app.services.private_media import local_object, object_url, store_image

logger = logging.getLogger(__name__)
DAILY_ATTEMPTS = 20
WORK_SECONDS = 15 * 60


def utcnow() -> datetime:
    return datetime.now(UTC)


def record(value: Any) -> dict[str, Any]:
    if is_dataclass(value) and not isinstance(value, type):
        return asdict(value)
    if not isinstance(value, dict):
        raise ValueError("Unsupported source candidate")
    return dict(value)


def source_keys(kind: str) -> list[str]:
    if kind == "recipe":
        from app.services.content_sources import recipe_sources

        return list(recipe_sources())
    from app.services.content_workout_sources import workout_candidates

    return [str(item["provenance"]["catalog_id"]) for item in workout_candidates()]


async def source_record(kind: str, key: str) -> dict[str, Any]:
    if kind == "recipe":
        from app.services.content_sources import load_recipe

        return record(await load_recipe(key))
    from app.services.content_workout_sources import workout_candidates

    return next(item for item in workout_candidates() if item["provenance"]["catalog_id"] == key)


def attempted_key(key: str) -> str:
    return hashlib.sha256(key.encode()).hexdigest()


def reserve_attempt(batch_id: str, token: str, kind: str, key: str) -> bool:
    with SessionLocal() as db:
        batch = service.renew_batch_lease(db, batch_id, lease_token=token, now=utcnow())
        report = dict(batch.report or {})
        attempts = dict(report.get("attempted_sources", {}))
        tried = list(attempts.get(kind, []))
        digest = attempted_key(key)
        if digest in tried or len(tried) >= DAILY_ATTEMPTS:
            db.rollback()
            return False
        attempts[kind] = [*tried, digest]
        batch.report = {**report, "attempted_sources": attempts}
        db.commit()
        return True


def staged_count(batch_id: str, kind: str) -> int:
    with SessionLocal() as db:
        return len(
            list(
                db.scalars(
                    select(ContentCandidate.id).where(
                        ContentCandidate.batch_id == batch_id, ContentCandidate.kind == kind
                    )
                )
            )
        )


def previous_sources(user_id: str, kind: str) -> set[str]:
    with SessionLocal() as db:
        rows = db.scalars(
            select(ContentCandidate).where(
                ContentCandidate.user_id == user_id, ContentCandidate.kind == kind
            )
        )
        return {
            str(row.provenance.get("catalog_id")) if kind == "workout" else row.source_url
            for row in rows
        }


async def resolve_photo(
    item: dict[str, Any], cache: dict[str, tuple[ResolvedPhoto, bytes]]
) -> tuple[ResolvedPhoto, bytes]:
    provenance = item.get("provenance") or {}
    evidence = provenance.get("image") or {}
    page = item.get("photo_page_url")
    key = str(page or item.get("photo_url") or "")
    if not key:
        raise ValueError("A real photograph is required")
    if key not in cache:
        if page:
            photo = await commons_photo(str(page))
        else:
            photo = ResolvedPhoto(url=str(item["photo_url"]), evidence=dict(evidence))
        cache[key] = photo, await photo_bytes(photo)
    return cache[key]


def clean_payload(item: dict[str, Any], photo_reference: str) -> dict[str, Any]:
    payload = dict(item["payload"])
    payload["photo_url"] = photo_reference
    if item["kind"] == "recipe":
        # These values are source-published estimates, never provider snapshots or AI guesses.
        note = "Nutrition is the publisher's estimate per stated serving; brands and portions vary."
        description = str(payload.get("description") or "").strip()
        payload["description"] = description + ("\n\n" if description else "") + note
        payload["accept_placeholder_photo"] = False
    parsed = (
        RecipeCandidateInput.model_validate(payload)
        if item["kind"] == "recipe"
        else WorkoutCandidateInput.model_validate(payload)
    )
    return parsed.model_dump(mode="json")


def own_photo(user_id: str, item: dict[str, Any], photo: ResolvedPhoto, data: bytes) -> str:
    # Reuse the same owned photo across suitable routines; never grant another account access.
    source = photo.evidence["source_url"]
    with SessionLocal() as db:
        prior = db.scalars(
            select(ContentCandidate).where(
                ContentCandidate.user_id == user_id,
                ContentCandidate.provenance["image"]["source_url"].as_string() == source,
            )
        )
        for candidate in prior:
            value = str(candidate.payload.get("photo_url") or "")
            media = local_object(db, value)
            if media and media.owner_user_id == user_id and not media.deleted_at:
                return object_url(media.id)
        user = db.get(User, user_id)
        if not user or not user.is_active:
            raise ValueError("Account is unavailable")
        return object_url(store_image(db, user, data).id)


async def prepare_campaign(campaign_id: str) -> dict[str, Any]:
    with SessionLocal() as db:
        campaign = db.get(ContentCampaign, campaign_id)
        if not campaign:
            return {"status": "not_found"}
        today = utcnow().astimezone(ZoneInfo(campaign.time_zone)).date()
        batch = service.begin_batch(db, campaign_id, today, utcnow())
        db.commit()
        if not batch:
            return {"status": "not_due", "campaign_id": campaign_id}
        batch_id, token, user_id = batch.id, str(batch.lease_token), batch.user_id
    deadline = time.monotonic() + WORK_SECONDS
    cache: dict[str, tuple[ResolvedPhoto, bytes]] = {}
    reasons: list[str] = []
    failures = {"recipe": 0, "workout": 0}
    for kind in ("recipe", "workout"):
        try:
            keys = source_keys(kind)
        except (ValueError, OSError, ImportError):
            reasons.append(f"The {kind} source registry is unavailable. No incomplete items added.")
            continue
        used = previous_sources(user_id, kind)
        for key in keys:
            if staged_count(batch_id, kind) >= service.DAILY_CAP or time.monotonic() >= deadline:
                break
            if key in used or not reserve_attempt(batch_id, token, kind, key):
                continue
            try:
                item = await source_record(kind, key)
                item["kind"] = kind
                photo, data = await resolve_photo(item, cache)
                # Reject malformed source content before creating any media object.
                clean_payload(item, "https://dinner.dcss.dev/api/v1/media/objects/preflight")
                reference = own_photo(user_id, item, photo, data)
                payload = clean_payload(item, reference)
                provenance = {**item.get("provenance", {}), "image": photo.evidence}
                provenance["image"] = {
                    **photo.evidence,
                    "sha256": hashlib.sha256(data).hexdigest(),
                }
                with SessionLocal() as db:
                    service.stage_candidate(
                        db,
                        batch_id,
                        kind,
                        payload,
                        item["source_url"],
                        item["source_name"],
                        provenance,
                        item.get("warnings", []),
                        lease_token=token,
                        now=utcnow(),
                    )
                    db.commit()
            except Exception as exc:
                # Provider response bodies, tokens and private payloads never enter logs.
                failures[kind] += 1
                logger.warning(
                    "Content candidate skipped: kind=%s outcome=%s", kind, type(exc).__name__
                )
            await asyncio.sleep(1)
        if staged_count(batch_id, kind) < service.DAILY_CAP:
            reasons.append(
                f"Only {staged_count(batch_id, kind)} complete {kind} entries were available; "
                "photo rights, source information or duplicate checks prevented more."
            )
        if failures[kind]:
            reasons.append(f"Skipped {failures[kind]} {kind} candidates that did not pass checks.")
    if time.monotonic() >= deadline:
        reasons.append("Daily preparation time limit reached. No catch-up additions scheduled.")
    with SessionLocal() as db:
        service.finish_batch(db, batch_id, reasons, lease_token=token, now=utcnow())
        db.commit()
    return {
        "status": "prepared",
        "batch_id": batch_id,
        "recipes": staged_count(batch_id, "recipe"),
        "workouts": staged_count(batch_id, "workout"),
    }


async def preflight() -> dict[str, Any]:
    """Validate a sample without enrollment, library writes, media uploads, or paid API calls."""
    result: dict[str, Any] = {"recipes": [], "workouts": [], "skipped": []}
    cache: dict[str, tuple[ResolvedPhoto, bytes]] = {}
    deadline = time.monotonic() + WORK_SECONDS
    for kind, field in (("recipe", "recipes"), ("workout", "workouts")):
        for key in source_keys(kind)[:DAILY_ATTEMPTS]:
            if len(result[field]) >= 5 or time.monotonic() >= deadline:
                break
            try:
                item = await source_record(kind, key)
                item["kind"] = kind
                await resolve_photo(item, cache)
                payload = clean_payload(
                    item, "https://dinner.dcss.dev/api/v1/media/objects/preflight"
                )
                result[field].append(
                    {
                        "title": payload.get("name", payload.get("title")),
                        "source_url": item["source_url"],
                    }
                )
            except Exception as exc:
                result["skipped"].append({"kind": kind, "outcome": type(exc).__name__})
            await asyncio.sleep(1)
    result["ready"] = len(result["recipes"]) == len(result["workouts"]) == 5
    return result


async def discover_campaign(campaign_id: str) -> dict[str, Any]:
    from app.services import content_discovery
    from app.services.content_discovery_sources import discover

    with SessionLocal() as db:
        reservation = content_discovery.begin(db, campaign_id, utcnow())
        db.commit()
    if not reservation:
        return {"discovery": "not_due"}
    batch_id, token, day_index, seen = reservation
    sources: list[dict[str, str]] = []
    try:
        _, reasons = await asyncio.wait_for(
            discover(day_index, seen, collected=sources), timeout=60
        )
    except Exception:
        reasons = ["Source discovery could not finish. Earlier checked source links were kept."]
    with SessionLocal() as db:
        content_discovery.finish(db, batch_id, token, sources, reasons, utcnow())
        db.commit()
    return {
        "discovery": "checked",
        "batch_id": batch_id,
        "recipe_sources": sum(item["kind"] == "recipe" for item in sources),
        "workout_sources": sum(item["kind"] == "workout" for item in sources),
    }


def timer_text(campaign: ContentCampaign) -> str:
    lines = [
        "[Unit]",
        "Description=Dinner Swipe daily additions: finite 35-date campaign",
        "",
        "[Timer]",
        "Unit=dinner-swipe-content-daily.service",
        "Persistent=true",
        "AccuracySec=30s",
    ]
    for offset in range(campaign.days_total):
        day = campaign.start_date + timedelta(days=offset)
        lines.append(f"OnCalendar={day.isoformat()} 06:00:00 {campaign.time_zone}")
    return "\n".join([*lines, "", "[Install]", "WantedBy=timers.target", ""])


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--preflight", action="store_true")
    parser.add_argument("--enroll", metavar="ACCOUNT_EMAIL")
    parser.add_argument("--start-date", type=date.fromisoformat)
    parser.add_argument("--status", action="store_true")
    parser.add_argument(
        "--discover-sources",
        action="store_true",
        help="Check new source links for today's existing batch without staging entries",
    )
    parser.add_argument("--timer", metavar="ACCOUNT_EMAIL")
    args = parser.parse_args()
    logging.basicConfig(level=logging.INFO)
    if args.preflight:
        result = asyncio.run(preflight())
        print(json.dumps(result))
        if not result["ready"]:
            raise SystemExit(1)
        return
    if args.enroll or args.timer:
        with SessionLocal() as db:
            user = db.scalar(select(User).where(User.email == (args.enroll or args.timer)))
            if not user:
                raise SystemExit("Account not found")
            if args.enroll:
                start = args.start_date or utcnow().astimezone(
                    ZoneInfo(service.TIME_ZONE)
                ).date() + timedelta(days=1)
                campaign = service.create_campaign(db, user.id, start)
                db.commit()
                print(
                    json.dumps(
                        {
                            "campaign_id": campaign.id,
                            "start_date": str(campaign.start_date),
                            "end_date": str(campaign.end_date),
                            "time_zone": campaign.time_zone,
                        }
                    )
                )
            else:
                configured = db.scalar(
                    select(ContentCampaign).where(ContentCampaign.user_id == user.id)
                )
                if not configured:
                    raise SystemExit("No campaign configured")
                print(timer_text(configured), end="")
        return
    with SessionLocal() as db:
        campaigns = list(db.scalars(select(ContentCampaign)))
        ids = [
            campaign.id
            for campaign in campaigns
            if campaign.status != "completed"
            or args.discover_sources
            or campaign.end_date == utcnow().astimezone(ZoneInfo(campaign.time_zone)).date()
        ]
        if args.status:
            print(
                json.dumps(
                    [
                        {
                            "id": c.id,
                            "status": c.status,
                            "start_date": str(c.start_date),
                            "end_date": str(c.end_date),
                            "time_zone": c.time_zone,
                        }
                        for c in campaigns
                    ]
                )
            )
            return
    for campaign_id in ids:
        try:
            if not args.discover_sources:
                print(json.dumps(asyncio.run(prepare_campaign(campaign_id))))
            print(json.dumps(asyncio.run(discover_campaign(campaign_id))))
        except HTTPException as exc:
            logger.error("Content batch rejected: HTTP %s", exc.status_code)
            raise SystemExit(75) from None


if __name__ == "__main__":
    main()
