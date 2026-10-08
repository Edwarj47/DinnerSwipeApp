from __future__ import annotations

import re
import uuid
from datetime import timedelta
from typing import Any
from zoneinfo import ZoneInfo

from sqlalchemy import func, or_, select
from sqlalchemy.orm import Session

from app.core.config import settings
from app.database.session import SessionLocal
from app.models.nutrition import (
    NutritionFood,
    NutritionProviderState,
    NutritionRefreshRun,
    NutritionServing,
    NutritionUsage,
)
from app.services.fatsecret import FatSecretClient
from app.services.nutrition_budget import NutritionBudget, NutritionError, utcnow

nutrition_budget = NutritionBudget(SessionLocal, settings)
nutrition_client = FatSecretClient(settings, nutrition_budget)


def objects(value: Any) -> list[dict[str, Any]]:
    if isinstance(value, dict):
        return [value]
    if isinstance(value, list):
        return [item for item in value if isinstance(item, dict)]
    return []


def identifier(value: Any) -> str | None:
    candidate = str(value)
    return candidate if re.fullmatch(r"[0-9]{1,20}", candidate) else None


def index_food(db: Session, value: dict[str, Any], *, detailed: bool = False) -> None:
    food_id = identifier(value.get("food_id"))
    if not food_id:
        raise NutritionError("invalid_response")
    food = db.get(NutritionFood, food_id)
    now = utcnow()
    if not food:
        food = NutritionFood(food_id=food_id, first_seen_at=now, last_seen_at=now)
        db.add(food)
        db.flush()
    food.last_seen_at = now
    if detailed:
        food.last_refreshed_at = now
    servings = value.get("servings", {})
    for serving in objects(servings.get("serving") if isinstance(servings, dict) else None):
        serving_id = identifier(serving.get("serving_id"))
        if serving_id and not db.get(NutritionServing, (food_id, serving_id)):
            db.add(NutritionServing(food_id=food_id, serving_id=serving_id))
            db.flush()


def store_identifiers(db: Session, payload: dict[str, Any], *, detailed: bool) -> None:
    # Serialize index updates as well as new usage writes; never retain response attributes.
    state = db.scalar(
        select(NutritionProviderState)
        .where(NutritionProviderState.provider == "fatsecret")
        .with_for_update()
    )
    if not state:
        raise NutritionError("schema_not_ready")
    if detailed:
        food = payload.get("food")
        if not isinstance(food, dict):
            raise NutritionError("invalid_response")
        index_food(db, food, detailed=True)
    else:
        foods = payload.get("foods", {})
        if not isinstance(foods, dict):
            raise NutritionError("invalid_response")
        for food in objects(foods.get("food")):
            index_food(db, food)
    db.commit()


def refresh_used_foods(client: FatSecretClient = nutrition_client) -> dict[str, object]:
    client.cache.purge()
    if not settings.fatsecret_refresh_enabled or not settings.fatsecret_configured:
        return {"status": "disabled", "refreshed": 0}
    now = utcnow()
    run_date = now.replace(tzinfo=ZoneInfo("UTC")).astimezone(ZoneInfo("America/New_York")).date()
    lease_token = str(uuid.uuid4())
    with SessionLocal() as db:
        db.scalar(
            select(NutritionProviderState)
            .where(NutritionProviderState.provider == "fatsecret")
            .with_for_update()
        )
        run = db.get(NutritionRefreshRun, run_date)
        if run and (run.finished_at or run.lease_until > now):
            return {"status": "already_claimed", "refreshed": run.refreshed}
        if not run:
            run = NutritionRefreshRun(run_date=run_date, started_at=now, refreshed=0)
            db.add(run)
        run.lease_token = lease_token
        run.lease_until = now + timedelta(minutes=15)
        run.status = "running"
        db.commit()
        food_ids = list(
            db.scalars(
                select(NutritionFood.food_id)
                .join(NutritionUsage, NutritionUsage.food_id == NutritionFood.food_id)
                .where(
                    NutritionUsage.used_at >= now - timedelta(days=30),
                    or_(
                        NutritionFood.last_refreshed_at.is_(None),
                        NutritionFood.last_refreshed_at <= now - timedelta(hours=23),
                    ),
                )
                .group_by(NutritionFood.food_id)
                .order_by(func.max(NutritionUsage.used_at).desc())
                .limit(min(settings.fatsecret_background_budget, 100))
            )
        )
    refreshed = 0
    error_code = None
    for food_id in food_ids:
        if utcnow() >= now + timedelta(minutes=10):
            error_code = "job_time_limit"
            break
        try:
            payload = client.request(
                "food.get.v5", {"food_id": food_id}, background=True, refresh=True
            )
            with SessionLocal() as db:
                store_identifiers(db, payload, detailed=True)
            refreshed += 1
        except NutritionError as error:
            error_code = error.code
            break
    with SessionLocal() as db:
        run = db.get(NutritionRefreshRun, run_date)
        if run and run.lease_token == lease_token:
            run.status = "stopped" if error_code else "complete"
            run.refreshed += refreshed
            run.error_code = error_code
            run.finished_at = utcnow()
            db.commit()
    return {
        "status": "stopped" if error_code else "complete",
        "refreshed": refreshed,
        "error_code": error_code,
        "discovery_enabled": False,
    }
