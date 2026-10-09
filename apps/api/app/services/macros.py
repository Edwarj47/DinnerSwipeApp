from __future__ import annotations

import time
from collections.abc import Sequence
from datetime import UTC, date, datetime, timedelta
from typing import Any

from fastapi import HTTPException
from pydantic import ValidationError
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.models.entities import (
    MacroProfileTarget,
    MealMacroConfirmation,
    Recipe,
    RecipeMacroProfile,
    User,
    UserSubscription,
    WeeklyPlan,
    WeeklyPlanSlot,
)
from app.schemas.common import (
    MacroEntryUpdate,
    MacroTargetIn,
    MealMacroConfirmationIn,
    RecipeNutrition,
)
from app.services.billing import is_premium_active, require_premium, serialize_premium_status
from app.services.recipes import accessible_recipes_query

MAX_SUMMARY_DAYS = 3650


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
    db: Session,
    user: User,
    payload: MealMacroConfirmationIn,
    *,
    commit: bool = True,
    entry_id: str | None = None,
) -> MealMacroConfirmation:
    require_premium(db, user)
    recipe_id = payload.recipe_id
    if payload.weekly_plan_slot_id:
        slot = db.get(WeeklyPlanSlot, payload.weekly_plan_slot_id)
        plan = db.get(WeeklyPlan, slot.weekly_plan_id) if slot else None
        if not slot or not plan:
            raise HTTPException(status_code=404, detail="Weekly plan slot not found")
        if plan.household_id:
            from app.services.group_planning import authorize, library_query

            authorize(db, user, plan.household_id)
        elif plan.user_id != user.id:
            raise HTTPException(status_code=404, detail="Weekly plan slot not found")
        if recipe_id and recipe_id != slot.recipe_id:
            raise HTTPException(422, "Recipe does not match the planned meal")
        recipe_id = recipe_id or slot.recipe_id
    if payload.weekly_plan_slot_id and plan and plan.household_id and recipe_id:
        recipe = db.scalar(library_query(plan.household_id).where(Recipe.id == recipe_id))
    else:
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
    _validate_totals(macros)
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
    if entry_id:
        confirmation.id = entry_id
    db.add(confirmation)
    db.flush()
    if recipe:
        from app.services.calculator import copy_recipe_calculation

        copy_recipe_calculation(db, recipe, confirmation)
    db.commit() if commit else db.flush()
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
    db: Session, user: User, entry_id: str, payload: MacroEntryUpdate, *, commit: bool = True
) -> MealMacroConfirmation:
    require_premium(db, user)
    row = db.scalar(
        select(MealMacroConfirmation)
        .where(
            MealMacroConfirmation.id == entry_id,
            MealMacroConfirmation.user_id == user.id,
        )
        .with_for_update()
    )
    if not row:
        raise HTTPException(status_code=404, detail="Macro entry not found")

    updates = payload.model_dump(exclude_unset=True)
    from app.services.calculator import find_calculation, has_provider

    calculation = find_calculation(db, entry_id=row.id)
    linked = bool(calculation and has_provider(calculation))
    if linked and any(key in updates for key in RecipeNutrition.model_fields):
        raise HTTPException(422, "Edit database nutrition in the macro calculator.")
    for key in ("entry_name", "meal_label", "notes"):
        if key in updates:
            setattr(row, key, _clean_optional(updates[key]))
    if "meal_date" in updates and updates["meal_date"] is not None:
        row.meal_date = updates["meal_date"]
    if "status" in updates and updates["status"] is not None:
        row.status = updates["status"]
    previous_servings = row.servings_consumed
    if "servings_consumed" in updates and updates["servings_consumed"] is not None:
        row.servings_consumed = updates["servings_consumed"]

    macro_fields = ("calories", "protein_g", "carbs_g", "fat_g", "fiber_g")
    if row.status == "skipped":
        for field in macro_fields:
            setattr(row, field, 0)
        row.macro_source = "skipped"
    elif linked:
        for field in macro_fields:
            setattr(row, field, None)
        row.macro_source = "calculator_reference"
    else:
        if row.servings_consumed != previous_servings:
            # Scale the logged snapshot; later recipe edits must not rewrite food history.
            if previous_servings <= 0 and any(field not in updates for field in macro_fields):
                raise HTTPException(422, "Enter nutrition totals when changing a zero portion")
            for field in macro_fields:
                if field not in updates:
                    setattr(
                        row,
                        field,
                        _scaled(getattr(row, field), row.servings_consumed / previous_servings),
                    )
        changed_macro = False
        for field in macro_fields:
            if field in updates:
                setattr(row, field, updates[field])
                changed_macro = True
        if changed_macro:
            row.macro_source = "manual"
    _validate_totals({field: getattr(row, field) for field in macro_fields})
    db.commit() if commit else db.flush()
    db.refresh(row)
    row._calculator_checked = False
    return row


def delete_macro_entry(db: Session, user: User, entry_id: str, *, commit: bool = True) -> None:
    require_premium(db, user)
    row = db.scalar(
        select(MealMacroConfirmation)
        .where(
            MealMacroConfirmation.id == entry_id,
            MealMacroConfirmation.user_id == user.id,
        )
        .with_for_update()
    )
    if not row:
        raise HTTPException(status_code=404, detail="Macro entry not found")
    from app.services.calculator import find_calculation

    calculation = find_calculation(db, entry_id=row.id)
    if calculation:
        db.delete(calculation)
    db.delete(row)
    db.commit() if commit else db.flush()


def macro_summary(
    db: Session, user: User, days: int, end_date: date | None = None
) -> dict[str, Any]:
    active = is_premium_active(
        db.scalar(select(UserSubscription).where(UserSubscription.user_id == user.id))
    )
    end_date = end_date or date.today()
    bounded_days = max(1, min(days, MAX_SUMMARY_DAYS))
    try:
        start_date = end_date - timedelta(days=bounded_days - 1)
    except OverflowError as error:
        raise HTTPException(422, "Choose a later end date") from error
    target = db.scalar(select(MacroProfileTarget).where(MacroProfileTarget.user_id == user.id))
    rows = _rows_for_window(db, user, start_date, end_date) if active else []
    totals = {
        "calories": _sum_macro(rows, "calories"),
        "protein_g": _sum_macro(rows, "protein_g"),
        "carbs_g": _sum_macro(rows, "carbs_g"),
        "fat_g": _sum_macro(rows, "fat_g"),
        "fiber_g": _sum_macro(rows, "fiber_g"),
    }
    return {
        "days": bounded_days,
        "start_date": start_date,
        "end_date": end_date,
        "active": active,
        "targets": serialize_targets(target),
        "totals": totals,
        "temporary_nutrition": any(getattr(row, "_temporary_nutrition", False) for row in rows),
        "nutrition_unavailable_count": sum(
            bool(getattr(row, "_nutrition_unavailable", False)) for row in rows
        ),
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
    all_time: bool = False,
    *,
    hydrate: bool = True,
) -> dict[str, Any]:
    require_premium(db, user)
    if all_time:
        if start_date is not None or end_date is not None:
            raise HTTPException(status_code=422, detail="Choose all time or a date range, not both")
        first, last = db.execute(
            select(
                func.min(MealMacroConfirmation.meal_date), func.max(MealMacroConfirmation.meal_date)
            ).where(MealMacroConfirmation.user_id == user.id)
        ).one()
        window_start = first or date.today()
        window_end = max(last or date.today(), date.today())
        bounded_days = (window_end - window_start).days + 1
    else:
        window_start, window_end, bounded_days = _date_window(days, start_date, end_date)
    target = db.scalar(select(MacroProfileTarget).where(MacroProfileTarget.user_id == user.id))
    rows = _rows_for_window(db, user, window_start, window_end, hydrate=hydrate)
    totals = _macro_totals(rows)
    daily_totals = _daily_totals(rows, window_start, window_end, include_empty=not all_time)
    days_logged = sum(1 for item in daily_totals if item["entry_count"] > 0)
    divisor = max(1, days_logged)
    averages = {key: round(value / divisor, 2) for key, value in totals.items()}
    return {
        "days": bounded_days,
        "start_date": window_start,
        "end_date": window_end,
        "totals": totals,
        "temporary_nutrition": any(getattr(row, "_temporary_nutrition", False) for row in rows),
        "nutrition_unavailable_count": sum(
            bool(getattr(row, "_nutrition_unavailable", False)) for row in rows
        ),
        "averages": averages,
        "targets": serialize_targets(target),
        "days_logged": days_logged,
        "eaten_meals": sum(1 for row in rows if row.status == "ate"),
        "skipped_meals": sum(1 for row in rows if row.status == "skipped"),
        "unmatched_meals": sum(1 for row in rows if row.macro_source == "unmatched_recipe"),
        "daily_totals": daily_totals,
        "includes_empty_days": not all_time,
    }


def macro_export(
    db: Session,
    user: User,
    days: int = 30,
    start_date: date | None = None,
    end_date: date | None = None,
    all_time: bool = False,
) -> dict[str, Any]:
    analytics = macro_analytics(db, user, days, start_date, end_date, all_time, hydrate=False)
    rows = _rows_for_window(db, user, analytics["start_date"], analytics["end_date"], hydrate=False)
    return {
        "exported_at": datetime.now(UTC),
        "export_format_version": "2026-09-07",
        "days": analytics["days"],
        "analytics": analytics,
        "entries": [serialize_confirmation(db, row, hydrate=False) for row in rows],
        "nutrition_references": [
            {
                "entry_id": row.id,
                "servings_consumed": row.servings_consumed,
                "items": calculation.items,
                "servings": calculation.servings,
            }
            for row in rows
            if (calculation := _entry_calculation(db, row)) is not None
        ],
    }


def serialize_confirmation(
    db: Session, row: MealMacroConfirmation, *, hydrate: bool = True
) -> dict[str, Any]:
    if hydrate and not getattr(row, "_calculator_checked", False):
        _hydrate_entry(db, row)
    recipe = db.get(Recipe, row.recipe_id) if row.recipe_id else None
    return {
        "id": row.id,
        "revision": row.updated_at.isoformat(),
        "recipe_id": row.recipe_id,
        "recipe_name": recipe.name if recipe else None,
        "weekly_plan_slot_id": row.weekly_plan_slot_id,
        "entry_name": row.entry_name or (recipe.name if recipe else None),
        "meal_label": row.meal_label,
        "meal_date": row.meal_date,
        "status": row.status,
        "servings_consumed": row.servings_consumed,
        **{
            field: _macro_value(row, field) if hydrate else getattr(row, field)
            for field in RecipeNutrition.model_fields
        },
        "calculator_id": getattr(row, "_calculator_id", None)
        if hydrate
        else (calculation.id if (calculation := _entry_calculation(db, row)) else None),
        "temporary_nutrition": getattr(row, "_temporary_nutrition", False) if hydrate else False,
        "nutrition_unavailable": getattr(row, "_nutrition_unavailable", False),
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
    if not recipe:
        return manual, "manual" if any(
            v is not None for v in manual.values()
        ) else "unmatched_recipe"
    from app.services.calculator import find_calculation, has_provider

    calculation = find_calculation(db, recipe_id=recipe.id)
    if calculation and has_provider(calculation):
        if any(value is not None for value in manual.values()):
            raise HTTPException(422, "Database recipes use refreshed nutrition, not copied totals.")
        return dict.fromkeys(manual), "calculator_reference"
    profile = db.scalar(select(RecipeMacroProfile).where(RecipeMacroProfile.recipe_id == recipe.id))
    if not profile or all(getattr(profile, f"{field}_per_serving") is None for field in manual):
        return manual, "manual" if any(
            v is not None for v in manual.values()
        ) else "unmatched_recipe"
    scale = payload.servings_consumed
    calculated = {
        "calories": _scaled(profile.calories_per_serving, scale),
        "protein_g": _scaled(profile.protein_g_per_serving, scale),
        "carbs_g": _scaled(profile.carbs_g_per_serving, scale),
        "fat_g": _scaled(profile.fat_g_per_serving, scale),
        "fiber_g": _scaled(profile.fiber_g_per_serving, scale),
    }
    supplied = payload.model_fields_set.intersection(manual)
    return calculated | {
        key: manual[key] for key in supplied
    }, "manual" if supplied else profile.source


def _accessible_recipe(db: Session, user: User, recipe_id: str | None) -> Recipe | None:
    if not recipe_id:
        return None
    return db.scalar(accessible_recipes_query(user).where(Recipe.id == recipe_id))


def _validate_totals(macros: dict[str, float | None]) -> None:
    try:
        RecipeNutrition.model_validate(macros)
    except ValidationError as exc:
        raise HTTPException(
            422, "Nutrition totals are too large. Check the servings and amounts."
        ) from exc


def _scaled(value: float | None, scale: float) -> float | None:
    return round(value * scale, 2) if value is not None else None


def _sum_macro(rows: Sequence[MealMacroConfirmation], attr: str) -> float:
    return round(sum(float(_macro_value(row, attr) or 0) for row in rows), 2)


def _macro_value(row: MealMacroConfirmation, attr: str) -> float | None:
    values = row._calculator_values
    return (
        values[attr]
        if values is not None
        else float(value)
        if (value := getattr(row, attr)) is not None
        else None
    )


def _entry_calculation(db: Session, row: MealMacroConfirmation) -> Any:
    from app.services.calculator import find_calculation

    return find_calculation(db, entry_id=row.id)


def _hydrate_entry(db: Session, row: MealMacroConfirmation, deadline: float | None = None) -> None:
    from app.services.calculator import has_provider, resolve

    row._calculator_checked = True
    calculation = _entry_calculation(db, row)
    row._calculator_id = calculation.id if calculation else None
    row._temporary_nutrition = bool(calculation and has_provider(calculation))
    row._nutrition_unavailable = False
    row._calculator_values = None
    if calculation and has_provider(calculation) and row.status == "ate":
        # These attributes are deliberately unmapped: autoflush must never persist API values.
        values, unavailable = resolve(
            calculation, scale=row.servings_consumed / calculation.servings, deadline=deadline
        )
        row._calculator_values = values
        row._nutrition_unavailable = unavailable


def _macro_totals(rows: Sequence[MealMacroConfirmation]) -> dict[str, float]:
    return {
        "calories": _sum_macro(rows, "calories"),
        "protein_g": _sum_macro(rows, "protein_g"),
        "carbs_g": _sum_macro(rows, "carbs_g"),
        "fat_g": _sum_macro(rows, "fat_g"),
        "fiber_g": _sum_macro(rows, "fiber_g"),
    }


def _rows_for_window(
    db: Session, user: User, start_date: date, end_date: date, *, hydrate: bool = True
) -> list[MealMacroConfirmation]:
    rows = list(
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
    if hydrate:
        deadline = time.monotonic() + 8
        for row in rows:
            _hydrate_entry(db, row, deadline)
    else:
        for row in rows:
            row._calculator_values = None
            row._temporary_nutrition = False
    return rows


def _date_window(
    days: int = 30,
    start_date: date | None = None,
    end_date: date | None = None,
) -> tuple[date, date, int]:
    bounded_days = max(1, min(days, 366))
    window_end = end_date or date.today()
    try:
        window_start = start_date or (window_end - timedelta(days=bounded_days - 1))
    except OverflowError as exc:
        raise HTTPException(
            status_code=422, detail="Date range is outside supported dates"
        ) from exc
    if window_start > window_end:
        raise HTTPException(status_code=422, detail="Start date must be before end date")
    actual_days = (window_end - window_start).days + 1
    if actual_days > 366:
        raise HTTPException(status_code=422, detail="Choose up to 366 days, or use all time")
    return window_start, window_end, actual_days


def _daily_totals(
    rows: Sequence[MealMacroConfirmation],
    start_date: date,
    end_date: date,
    include_empty: bool = True,
) -> list[dict[str, Any]]:
    by_date: dict[date, list[MealMacroConfirmation]] = {}
    for row in rows:
        by_date.setdefault(row.meal_date, []).append(row)
    day_count = (end_date - start_date).days + 1
    totals: list[dict[str, Any]] = []
    # All-time histories are sparse: do not allocate years of empty calendar rows.
    dates = (
        [start_date + timedelta(days=offset) for offset in range(day_count)]
        if include_empty
        else sorted(by_date)
    )
    for current in dates:
        day_rows = by_date.get(current, [])
        day_totals = _macro_totals(day_rows)
        totals.append(
            {
                "meal_date": current,
                **day_totals,
                "eaten_meals": sum(1 for row in day_rows if row.status == "ate"),
                "skipped_meals": sum(1 for row in day_rows if row.status == "skipped"),
                "entry_count": len(day_rows),
                "nutrition_unavailable_count": sum(
                    bool(getattr(row, "_nutrition_unavailable", False)) for row in day_rows
                ),
            }
        )
    return totals


def _clean_optional(value: object) -> str | None:
    if value is None:
        return None
    cleaned = str(value).strip()
    return cleaned or None
