from __future__ import annotations

from collections.abc import Sequence
from datetime import UTC, date, datetime, timedelta
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
from app.schemas.common import MacroEntryUpdate, MacroTargetIn, MealMacroConfirmationIn
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
        entry_name=_clean_optional(payload.entry_name) or (recipe.name if recipe else None),
        meal_label=_clean_optional(payload.meal_label),
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


def list_macro_entries(
    db: Session,
    user: User,
    days: int = 7,
    start_date: date | None = None,
    end_date: date | None = None,
) -> list[MealMacroConfirmation]:
    require_premium(db, user)
    window_start, window_end, _ = _date_window(days, start_date, end_date)
    return _rows_for_window(db, user, window_start, window_end)


def update_macro_entry(
    db: Session, user: User, entry_id: str, payload: MacroEntryUpdate
) -> MealMacroConfirmation:
    require_premium(db, user)
    row = db.scalar(
        select(MealMacroConfirmation).where(
            MealMacroConfirmation.id == entry_id,
            MealMacroConfirmation.user_id == user.id,
        )
    )
    if not row:
        raise HTTPException(status_code=404, detail="Macro entry not found")

    updates = payload.model_dump(exclude_unset=True)
    for key in ("entry_name", "meal_label", "notes"):
        if key in updates:
            setattr(row, key, _clean_optional(updates[key]))
    if "meal_date" in updates and updates["meal_date"] is not None:
        row.meal_date = updates["meal_date"]
    if "status" in updates and updates["status"] is not None:
        row.status = updates["status"]
    if "servings_consumed" in updates and updates["servings_consumed"] is not None:
        row.servings_consumed = updates["servings_consumed"]

    macro_fields = ("calories", "protein_g", "carbs_g", "fat_g", "fiber_g")
    if row.status == "skipped":
        for field in macro_fields:
            setattr(row, field, 0)
        row.macro_source = "skipped"
    else:
        changed_macro = False
        for field in macro_fields:
            if field in updates:
                setattr(row, field, updates[field])
                changed_macro = True
        if changed_macro:
            row.macro_source = "manual"
    db.commit()
    db.refresh(row)
    return row


def delete_macro_entry(db: Session, user: User, entry_id: str) -> None:
    require_premium(db, user)
    row = db.scalar(
        select(MealMacroConfirmation).where(
            MealMacroConfirmation.id == entry_id,
            MealMacroConfirmation.user_id == user.id,
        )
    )
    if not row:
        raise HTTPException(status_code=404, detail="Macro entry not found")
    db.delete(row)
    db.commit()


def macro_summary(db: Session, user: User, days: int) -> dict[str, Any]:
    active = is_premium_active(
        db.scalar(select(UserSubscription).where(UserSubscription.user_id == user.id))
    )
    end_date = date.today()
    start_date = end_date - timedelta(days=max(1, min(days, 90)) - 1)
    target = db.scalar(select(MacroProfileTarget).where(MacroProfileTarget.user_id == user.id))
    rows = _rows_for_window(db, user, start_date, end_date)
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


def macro_analytics(
    db: Session,
    user: User,
    days: int = 30,
    start_date: date | None = None,
    end_date: date | None = None,
) -> dict[str, Any]:
    require_premium(db, user)
    window_start, window_end, bounded_days = _date_window(days, start_date, end_date)
    target = db.scalar(select(MacroProfileTarget).where(MacroProfileTarget.user_id == user.id))
    rows = _rows_for_window(db, user, window_start, window_end)
    totals = _macro_totals(rows)
    daily_totals = _daily_totals(rows, window_start, window_end)
    days_logged = sum(1 for item in daily_totals if item["entry_count"] > 0)
    divisor = max(1, days_logged)
    averages = {key: round(value / divisor, 2) for key, value in totals.items()}
    return {
        "days": bounded_days,
        "start_date": window_start,
        "end_date": window_end,
        "totals": totals,
        "averages": averages,
        "targets": serialize_targets(target),
        "days_logged": days_logged,
        "eaten_meals": sum(1 for row in rows if row.status == "ate"),
        "skipped_meals": sum(1 for row in rows if row.status == "skipped"),
        "unmatched_meals": sum(1 for row in rows if row.macro_source == "unmatched_recipe"),
        "daily_totals": daily_totals,
    }


def macro_export(
    db: Session,
    user: User,
    days: int = 30,
    start_date: date | None = None,
    end_date: date | None = None,
) -> dict[str, Any]:
    analytics = macro_analytics(db, user, days, start_date, end_date)
    rows = list_macro_entries(
        db,
        user,
        days=days,
        start_date=analytics["start_date"],
        end_date=analytics["end_date"],
    )
    return {
        "exported_at": datetime.now(UTC),
        "export_format_version": "2026-09-07",
        "days": analytics["days"],
        "analytics": analytics,
        "entries": [serialize_confirmation(db, row) for row in rows],
    }


def serialize_confirmation(db: Session, row: MealMacroConfirmation) -> dict[str, Any]:
    recipe = db.get(Recipe, row.recipe_id) if row.recipe_id else None
    return {
        "id": row.id,
        "recipe_id": row.recipe_id,
        "recipe_name": recipe.name if recipe else None,
        "weekly_plan_slot_id": row.weekly_plan_slot_id,
        "entry_name": row.entry_name or (recipe.name if recipe else None),
        "meal_label": row.meal_label,
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


def _macro_totals(rows: Sequence[MealMacroConfirmation]) -> dict[str, float]:
    return {
        "calories": _sum_macro(rows, "calories"),
        "protein_g": _sum_macro(rows, "protein_g"),
        "carbs_g": _sum_macro(rows, "carbs_g"),
        "fat_g": _sum_macro(rows, "fat_g"),
        "fiber_g": _sum_macro(rows, "fiber_g"),
    }


def _rows_for_window(
    db: Session, user: User, start_date: date, end_date: date
) -> list[MealMacroConfirmation]:
    return list(
        db.scalars(
            select(MealMacroConfirmation)
            .where(
                MealMacroConfirmation.user_id == user.id,
                MealMacroConfirmation.meal_date >= start_date,
                MealMacroConfirmation.meal_date <= end_date,
            )
            .order_by(
                MealMacroConfirmation.meal_date.desc(),
                MealMacroConfirmation.created_at.desc(),
            )
        ).all()
    )


def _date_window(
    days: int = 30,
    start_date: date | None = None,
    end_date: date | None = None,
) -> tuple[date, date, int]:
    bounded_days = max(1, min(days, 90))
    window_end = end_date or date.today()
    window_start = start_date or (window_end - timedelta(days=bounded_days - 1))
    if window_start > window_end:
        raise HTTPException(status_code=422, detail="Start date must be before end date")
    actual_days = min(90, (window_end - window_start).days + 1)
    if actual_days > 90:
        window_start = window_end - timedelta(days=89)
        actual_days = 90
    return window_start, window_end, actual_days


def _daily_totals(
    rows: Sequence[MealMacroConfirmation], start_date: date, end_date: date
) -> list[dict[str, Any]]:
    by_date: dict[date, list[MealMacroConfirmation]] = {}
    for row in rows:
        by_date.setdefault(row.meal_date, []).append(row)
    day_count = (end_date - start_date).days + 1
    totals: list[dict[str, Any]] = []
    for offset in range(day_count):
        current = start_date + timedelta(days=offset)
        day_rows = by_date.get(current, [])
        day_totals = _macro_totals(day_rows)
        totals.append(
            {
                "meal_date": current,
                **day_totals,
                "eaten_meals": sum(1 for row in day_rows if row.status == "ate"),
                "skipped_meals": sum(1 for row in day_rows if row.status == "skipped"),
                "entry_count": len(day_rows),
            }
        )
    return totals


def _clean_optional(value: object) -> str | None:
    if value is None:
        return None
    cleaned = str(value).strip()
    return cleaned or None
