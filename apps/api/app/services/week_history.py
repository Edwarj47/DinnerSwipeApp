from __future__ import annotations

from datetime import date, timedelta
from typing import Any
from zoneinfo import ZoneInfo

from fastapi import HTTPException
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models.entities import Household, Recipe, User, WeeklyPlan, WeeklyPlanSlot
from app.services import planning


def snapshot(recipe: Recipe) -> dict[str, Any]:
    from app.services.recipes import recipe_total_minutes

    return {
        "recipe_id": recipe.id,
        "recipe_name": recipe.name,
        "recipe_total_minutes": recipe_total_minutes(recipe),
        "recipe_difficulty": recipe.difficulty,
        "meal_type": recipe.meal_type,
    }


def current_week(db: Session, plan: WeeklyPlan) -> date:
    if plan.user_id:
        owner = db.get(User, plan.user_id)
        return planning.week_start_for(owner) if owner else date.min
    group = db.get(Household, plan.household_id)
    zone = (group.planning_settings or {}).get("time_zone", "UTC") if group else "UTC"
    today = planning.now_utc().astimezone(ZoneInfo(str(zone))).date()
    return today - timedelta(days=today.weekday())


def capture_slots(db: Session) -> None:
    for slot in [row for row in db.new | db.dirty if isinstance(row, WeeklyPlanSlot)]:
        plan = db.get(WeeklyPlan, slot.weekly_plan_id)
        if plan and slot not in db.new and plan.week_start < current_week(db, plan):
            continue
        recipe = db.get(Recipe, slot.recipe_id) if slot.recipe_id else None
        slot.history_snapshot = snapshot(recipe) if recipe else None


def history(db: Session, user: User, week: date, household_id: str | None = None) -> dict[str, Any]:
    from app.services.group_planning import authorize, settings
    from app.services.recipes import serialize_plan

    if household_id:
        group = authorize(db, user, household_id)
        today = planning.now_utc().astimezone(ZoneInfo(settings(group)["time_zone"])).date()
        current = today - timedelta(days=today.weekday())
        scope = WeeklyPlan.household_id == household_id
    else:
        current = planning.week_start_for(user)
        scope = WeeklyPlan.user_id == user.id
    if week.weekday() != 0 or week >= current:
        raise HTTPException(422, "Choose a past week starting on Monday.")
    plan = db.scalar(select(WeeklyPlan).where(scope, WeeklyPlan.week_start == week))
    if not plan:
        return {
            "id": None,
            "household_id": household_id,
            "week_start": week,
            "meal_target": 0,
            "read_only": True,
            "slots": [],
        }
    result = serialize_plan(db, plan)
    slots = {
        slot.id: slot
        for slot in db.scalars(
            select(WeeklyPlanSlot).where(WeeklyPlanSlot.weekly_plan_id == plan.id)
        )
    }
    for row in result["slots"]:
        stored = slots[row["id"]].history_snapshot
        if stored:
            row.update(
                {
                    key: stored[key]
                    for key in (
                        "recipe_id",
                        "recipe_name",
                        "recipe_total_minutes",
                        "recipe_difficulty",
                    )
                    if key in stored
                }
            )
    result["read_only"] = True
    return result
