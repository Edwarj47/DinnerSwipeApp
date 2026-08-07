from __future__ import annotations

from collections.abc import Sequence
from datetime import date, timedelta
from typing import Any

from fastapi import HTTPException
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models.entities import (
    MacroProfileTarget,
    MealMacroConfirmation,
    Recipe,
    RecipeMacroProfile,
    User,
    UserSubscription,
    WeeklyPlanSlot,
)
from app.schemas.common import MacroTargetIn, MealMacroConfirmationIn
from app.services.billing import is_premium_active, require_premium, serialize_premium_status


def get_or_create_targets(db: Session, user: User) -> MacroProfileTarget:
    target = db.scalar(select(MacroProfileTarget).where(MacroProfileTarget.user_id == user.id))
    if target:
        return target
    target = MacroProfileTarget(user_id=user.id)
    db.add(target)
    db.commit()
    db.refresh(target)
    return target


def update_targets(db: Session, user: User, payload: MacroTargetIn) -> MacroProfileTarget:
    require_premium(db, user)
    target = get_or_create_targets(db, user)
    for key, value in payload.model_dump().items():
        setattr(target, key, value)
    db.commit()
    db.refresh(target)
    return target


def serialize_targets(target: MacroProfileTarget | None) -> dict[str, Any]:
    if not target:
        return {
            "id": None,
            "daily_calories": None,
            "daily_protein_g": None,
            "daily_carbs_g": None,
            "daily_fat_g": None,
            "goal": None,
        }
    return {
        "id": target.id,
        "daily_calories": target.daily_calories,
        "daily_protein_g": target.daily_protein_g,
        "daily_carbs_g": target.daily_carbs_g,
        "daily_fat_g": target.daily_fat_g,
        "goal": target.goal,
    }


def create_confirmation(
    db: Session, user: User, payload: MealMacroConfirmationIn
) -> MealMacroConfirmation:
    require_premium(db, user)
    recipe_id = payload.recipe_id
    if payload.weekly_plan_slot_id:
        slot = db.get(WeeklyPlanSlot, payload.weekly_plan_slot_id)
        if not slot:
            raise HTTPException(status_code=404, detail="Weekly plan slot not found")
        recipe_id = recipe_id or slot.recipe_id
    recipe = _accessible_recipe(db, user, recipe_id) if recipe_id else None
    if recipe_id and not recipe:
        raise HTTPException(status_code=404, detail="Recipe not found")
    meal_date = payload.meal_date or date.today()
    macros, macro_source = _confirmation_macros(db, recipe, payload)
    if payload.status == "skipped":
        macros = {
            "calories": 0,
            "protein_g": 0,
            "carbs_g": 0,
            "fat_g": 0,
            "fiber_g": 0,
        }
        macro_source = "skipped"
    confirmation = MealMacroConfirmation(
        user_id=user.id,
        recipe_id=recipe.id if recipe else None,
        weekly_plan_slot_id=payload.weekly_plan_slot_id,
        meal_date=meal_date,
        status=payload.status,
        servings_consumed=payload.servings_consumed,
        calories=macros["calories"],
        protein_g=macros["protein_g"],
        carbs_g=macros["carbs_g"],
        fat_g=macros["fat_g"],
        fiber_g=macros["fiber_g"],
        macro_source=macro_source,
        notes=payload.notes,
    )
    db.add(confirmation)
    db.commit()
    db.refresh(confirmation)
    return confirmation


def macro_summary(db: Session, user: User, days: int) -> dict[str, Any]:
    active = is_premium_active(
        db.scalar(select(UserSubscription).where(UserSubscription.user_id == user.id))
    )
    end_date = date.today()
    start_date = end_date - timedelta(days=max(1, min(days, 90)) - 1)
    target = db.scalar(select(MacroProfileTarget).where(MacroProfileTarget.user_id == user.id))
    rows = db.scalars(
        select(MealMacroConfirmation)
        .where(
            MealMacroConfirmation.user_id == user.id,
            MealMacroConfirmation.meal_date >= start_date,
            MealMacroConfirmation.meal_date <= end_date,
        )
        .order_by(MealMacroConfirmation.meal_date.desc(), MealMacroConfirmation.created_at.desc())
    ).all()
    totals = {
        "calories": _sum_macro(rows, "calories"),
        "protein_g": _sum_macro(rows, "protein_g"),
        "carbs_g": _sum_macro(rows, "carbs_g"),
        "fat_g": _sum_macro(rows, "fat_g"),
        "fiber_g": _sum_macro(rows, "fiber_g"),
    }
    return {
        "days": max(1, min(days, 90)),
        "start_date": start_date,
        "end_date": end_date,
        "active": active,
        "targets": serialize_targets(target),
        "totals": totals,
        "eaten_meals": sum(1 for row in rows if row.status == "ate"),
        "skipped_meals": sum(1 for row in rows if row.status == "skipped"),
        "unmatched_meals": sum(1 for row in rows if row.macro_source == "unmatched_recipe"),
        "recent_confirmations": [serialize_confirmation(db, row) for row in rows[:12]],
    }


def serialize_confirmation(db: Session, row: MealMacroConfirmation) -> dict[str, Any]:
    recipe = db.get(Recipe, row.recipe_id) if row.recipe_id else None
    return {
        "id": row.id,
        "recipe_id": row.recipe_id,
        "recipe_name": recipe.name if recipe else None,
        "weekly_plan_slot_id": row.weekly_plan_slot_id,
        "meal_date": row.meal_date,
        "status": row.status,
        "servings_consumed": row.servings_consumed,
        "calories": row.calories,
        "protein_g": row.protein_g,
        "carbs_g": row.carbs_g,
        "fat_g": row.fat_g,
        "fiber_g": row.fiber_g,
        "macro_source": row.macro_source,
        "notes": row.notes,
        "created_at": row.created_at,
    }


def premium_macro_overview(db: Session, user: User, days: int = 7) -> dict[str, Any]:
    return serialize_premium_status(db, user) | {"macro_summary": macro_summary(db, user, days)}


def _confirmation_macros(
    db: Session, recipe: Recipe | None, payload: MealMacroConfirmationIn
) -> tuple[dict[str, float | None], str]:
    manual = {
        "calories": payload.calories,
        "protein_g": payload.protein_g,
        "carbs_g": payload.carbs_g,
        "fat_g": payload.fat_g,
        "fiber_g": payload.fiber_g,
    }
    if any(value is not None for value in manual.values()):
        return manual, "manual"
    if not recipe:
        return manual, "unmatched_recipe"
    profile = db.scalar(
        select(RecipeMacroProfile).where(RecipeMacroProfile.recipe_id == recipe.id)
    )
    if not profile:
        return manual, "unmatched_recipe"
    scale = payload.servings_consumed
    return {
        "calories": _scaled(profile.calories_per_serving, scale),
        "protein_g": _scaled(profile.protein_g_per_serving, scale),
        "carbs_g": _scaled(profile.carbs_g_per_serving, scale),
        "fat_g": _scaled(profile.fat_g_per_serving, scale),
        "fiber_g": _scaled(profile.fiber_g_per_serving, scale),
    }, profile.source


def _accessible_recipe(db: Session, user: User, recipe_id: str | None) -> Recipe | None:
    if not recipe_id:
        return None
    household_id = user.profile.household_id if user.profile else None
    return db.scalar(
        select(Recipe).where(
            Recipe.id == recipe_id,
            Recipe.archived_at.is_(None),
            (
                (Recipe.owner_user_id.is_(None))
                | (Recipe.owner_user_id == user.id)
                | (Recipe.household_id == household_id)
            ),
        )
    )


def _scaled(value: float | None, scale: float) -> float | None:
    return round(value * scale, 2) if value is not None else None


def _sum_macro(rows: Sequence[MealMacroConfirmation], attr: str) -> float:
    return round(sum(float(getattr(row, attr) or 0) for row in rows), 2)
