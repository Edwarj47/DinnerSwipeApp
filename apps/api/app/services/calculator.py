from __future__ import annotations

import math
import time
from hashlib import sha256
from typing import Any, cast
from uuid import UUID, uuid4, uuid5

from fastapi import HTTPException
from pydantic import ValidationError
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.models.entities import MealMacroConfirmation, Recipe, User
from app.models.nutrition import NutritionCalculation, NutritionServing, NutritionUsage
from app.schemas.calculator import CalculatorItem, CalculatorSave
from app.schemas.common import IngredientIn, MealMacroConfirmationIn, RecipeCreate, RecipeNutrition
from app.services.billing import require_premium
from app.services.nutrition import nutrition_client, objects
from app.services.nutrition_budget import NutritionError, utcnow

FIELDS = tuple(RecipeNutrition.model_fields)
PROVIDER_FIELDS = {
    "calories": "calories",
    "protein_g": "protein",
    "carbs_g": "carbohydrate",
    "fat_g": "fat",
    "fiber_g": "fiber",
}


def has_provider(calculation: NutritionCalculation) -> bool:
    return any(item["source"] == "fatsecret" for item in calculation.items)


def find_calculation(
    db: Session, *, recipe_id: str | None = None, entry_id: str | None = None
) -> NutritionCalculation | None:
    if not recipe_id and not entry_id:
        return None
    field = NutritionCalculation.recipe_id if recipe_id else NutritionCalculation.entry_id
    return db.scalar(select(NutritionCalculation).where(field == (recipe_id or entry_id)))


def resolve(
    calculation: NutritionCalculation, *, scale: float = 1, deadline: float | None = None
) -> tuple[dict[str, float | None], bool]:
    deadline = deadline or time.monotonic() + 8
    values, unavailable, _ = resolve_items(calculation, deadline=deadline)
    totals: dict[str, float | None] = {
        field: round(
            sum(
                float(value[field] or 0) * float(cast(float, item["portions"])) * scale
                for value, item in zip(values, calculation.items, strict=True)
            ),
            2,
        )
        if all(value[field] is not None for value in values)
        else None
        for field in FIELDS
    }
    return totals, unavailable


def resolve_items(
    calculation: NutritionCalculation, *, deadline: float | None = None
) -> tuple[list[dict[str, float | None]], bool, list[str | None]]:
    deadline = deadline or time.monotonic() + 8
    values: list[dict[str, float | None]] = []
    unavailable = False
    labels: list[str | None] = []
    for raw in calculation.items:
        item = CalculatorItem.model_validate(raw)
        label = None
        if item.source == "manual":
            nutrition = (item.nutrition or RecipeNutrition()).model_dump()
        else:
            try:
                if time.monotonic() > deadline:
                    raise NutritionError("lookup_time_limit")
                payload = nutrition_client.request("food.get.v5", {"food_id": item.food_id or ""})
                servings = objects(payload.get("food", {}).get("servings", {}).get("serving"))
                serving = next(
                    (
                        value
                        for value in servings
                        if str(value.get("serving_id")) == item.serving_id
                    ),
                    None,
                )
                if not serving:
                    raise NutritionError("serving_unavailable")
                label = (
                    str(serving["serving_description"])
                    if serving.get("serving_description")
                    else None
                )
                nutrition = {}
                for field, provider_field in PROVIDER_FIELDS.items():
                    try:
                        value = float(serving[provider_field])
                        nutrition[field] = value if math.isfinite(value) and value >= 0 else None
                    except (KeyError, TypeError, ValueError):
                        nutrition[field] = None
            except NutritionError:
                unavailable = True
                nutrition = dict.fromkeys(FIELDS)
        values.append(nutrition)
        labels.append(label)
    return values, unavailable, labels


def save_calculation(db: Session, user: User, payload: CalculatorSave) -> NutritionCalculation:
    require_premium(db, user)
    fingerprint = sha256(payload.model_dump_json().encode()).hexdigest()
    existing = db.scalar(
        select(NutritionCalculation).where(
            NutritionCalculation.request_id == str(payload.request_id)
        )
    )
    if existing:
        if existing.user_id != user.id or existing.request_hash != fingerprint:
            raise HTTPException(409, "Calculation request already used.")
        return existing
    for item in payload.items:
        if item.source == "fatsecret" and not db.get(
            NutritionServing, (item.food_id, item.serving_id)
        ):
            raise HTTPException(422, "Select a valid database serving first.")
    calculation = NutritionCalculation(
        user_id=user.id,
        servings=payload.servings,
        items=[item.model_dump(exclude_none=True) for item in payload.items],
        request_id=str(payload.request_id),
        request_hash=fingerprint,
    )
    manual_values = None
    if not has_provider(calculation):
        manual_values, _ = resolve(calculation)
        validate_manual_total(manual_values)
    if payload.destination == "recipe":
        from app.services.recipes import create_recipe

        recipe = create_recipe(
            db,
            RecipeCreate(
                name=payload.name,
                servings=payload.servings,
                meal_type=payload.meal_label,
                source_type="manual",
                accept_placeholder_photo=True,
                ingredients=[
                    IngredientIn(
                        original_text=f"{item.portions:g} servings {item.name}",
                        normalized_name=item.name,
                        quantity=item.portions,
                        unit="servings",
                    )
                    for item in payload.items
                ],
                nutrition=RecipeNutrition.model_validate(
                    {
                        field: value / payload.servings if value is not None else None
                        for field, value in (manual_values or dict.fromkeys(FIELDS)).items()
                    }
                )
                if manual_values is not None
                else None,
            ),
            user,
            commit=False,
        )
        calculation.recipe_id = recipe.id
    else:
        from app.services.macros import create_confirmation

        entry = create_confirmation(
            db,
            user,
            MealMacroConfirmationIn.model_validate(
                {
                    "entry_name": payload.name,
                    "meal_label": payload.meal_label,
                    "meal_date": payload.meal_date,
                    **(manual_values or {}),
                }
            ),
            commit=False,
        )
        entry.macro_source = "calculator_reference" if has_provider(calculation) else "manual"
        calculation.entry_id = entry.id
        calculation.servings = 1
    db.add(calculation)
    record_items_used(db, calculation)
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        existing = db.scalar(
            select(NutritionCalculation).where(
                NutritionCalculation.request_id == str(payload.request_id)
            )
        )
        if existing and existing.user_id == user.id and existing.request_hash == fingerprint:
            return existing
        raise HTTPException(409, "Calculation changed. Try again.") from None
    return calculation


def validate_manual_total(values: dict[str, float | None]) -> None:
    try:
        RecipeNutrition.model_validate(values)
    except ValidationError:
        raise HTTPException(422, "Nutrition totals are too large. Check the amounts.") from None


def record_items_used(db: Session, calculation: NutritionCalculation, *, scale: float = 1) -> None:
    for index, item in enumerate(calculation.items):
        if item["source"] == "fatsecret":
            request_id = str(uuid5(UUID(calculation.request_id), str(index)))
            if not db.scalar(
                select(NutritionUsage.id).where(NutritionUsage.request_id == request_id)
            ):
                db.add(
                    NutritionUsage(
                        user_id=calculation.user_id,
                        food_id=item["food_id"],
                        serving_id=item["serving_id"],
                        portions=float(cast(float, item["portions"])) * scale,
                        request_id=request_id,
                        used_at=utcnow(),
                    )
                )


def update_calculation(
    db: Session, user: User, calculation: NutritionCalculation, payload: CalculatorSave
) -> NutritionCalculation:
    require_premium(db, user)
    if calculation.request_id == str(payload.request_id):
        if calculation.request_hash != sha256(payload.model_dump_json().encode()).hexdigest():
            raise HTTPException(409, "Calculation request already used.")
        return calculation
    if payload.destination != ("recipe" if calculation.recipe_id else "entry"):
        raise HTTPException(422, "Save a new calculation to change its destination.")
    for item in payload.items:
        if item.source == "fatsecret" and not db.get(
            NutritionServing, (item.food_id, item.serving_id)
        ):
            raise HTTPException(422, "Select a valid database serving first.")
    calculation.items = [item.model_dump(exclude_none=True) for item in payload.items]
    calculation.servings = payload.servings if calculation.recipe_id else 1
    manual, _ = resolve(calculation) if not has_provider(calculation) else (None, False)
    if manual is not None:
        validate_manual_total(manual)
    if calculation.recipe_id:
        from app.services.recipes import serialize_recipe, update_recipe

        recipe = db.get(Recipe, calculation.recipe_id)
        if not recipe or recipe.owner_user_id != user.id:
            raise HTTPException(404, "Recipe not found.")
        data = serialize_recipe(recipe, user.id, db)
        data.update(
            name=payload.name,
            meal_type=payload.meal_label,
            servings=payload.servings,
            accept_placeholder_photo=True,
            ingredients=[
                {
                    "original_text": f"{item.portions:g} servings {item.name}",
                    "normalized_name": item.name,
                    "quantity": item.portions,
                    "unit": "servings",
                }
                for item in payload.items
            ],
        )
        data.pop("nutrition", None)
        if manual is not None:
            data["nutrition"] = {
                field: value / payload.servings if value is not None else None
                for field, value in manual.items()
            }
        update_recipe(db, recipe, RecipeCreate.model_validate(data), commit=False)
        if manual is None:
            from app.models.entities import RecipeMacroProfile

            profile = db.scalar(
                select(RecipeMacroProfile).where(RecipeMacroProfile.recipe_id == recipe.id)
            )
            if profile:
                db.delete(profile)
    else:
        entry = db.get(MealMacroConfirmation, calculation.entry_id)
        if not entry:
            raise HTTPException(404, "Entry not found.")
        entry.entry_name, entry.meal_label, entry.meal_date = (
            payload.name,
            payload.meal_label,
            payload.meal_date,
        )
        entry.servings_consumed = 1
        entry.macro_source = (
            "skipped"
            if entry.status == "skipped"
            else "calculator_reference"
            if has_provider(calculation)
            else "manual"
        )
        for field in FIELDS:
            setattr(entry, field, 0 if entry.status == "skipped" else (manual or {}).get(field))
        entry._calculator_checked = False
    calculation.request_id = str(payload.request_id)
    calculation.request_hash = sha256(payload.model_dump_json().encode()).hexdigest()
    record_items_used(db, calculation)
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        raise HTTPException(409, "Calculation changed. Try again.") from None
    return calculation


def copy_recipe_calculation(db: Session, recipe: Recipe, entry: MealMacroConfirmation) -> bool:
    calculation = find_calculation(db, recipe_id=recipe.id)
    if not calculation or not has_provider(calculation):
        return False
    logged = NutritionCalculation(
        user_id=entry.user_id,
        entry_id=entry.id,
        servings=calculation.servings,
        items=calculation.items,
        request_id=str(uuid4()),
    )
    db.add(logged)
    record_items_used(db, logged, scale=entry.servings_consumed / calculation.servings)
    return True


def calculation_response(db: Session, calculation: NutritionCalculation) -> dict[str, Any]:
    recipe = db.get(Recipe, calculation.recipe_id) if calculation.recipe_id else None
    entry = db.get(MealMacroConfirmation, calculation.entry_id) if calculation.entry_id else None
    values, unavailable, labels = resolve_items(calculation)
    scale = entry.servings_consumed / calculation.servings if entry else 1
    items = [
        dict(item, portions=float(cast(float, item["portions"])) * scale)
        for item in calculation.items
    ]
    totals = {
        field: round(
            sum(
                float(value[field] or 0) * float(cast(float, item["portions"]))
                for value, item in zip(values, items, strict=True)
            ),
            2,
        )
        if all(value[field] is not None for value in values)
        else None
        for field in FIELDS
    }
    return {
        "id": calculation.id,
        "recipe_id": calculation.recipe_id,
        "entry_id": calculation.entry_id,
        "name": recipe.name if recipe else entry.entry_name if entry else "",
        "meal_label": recipe.meal_type if recipe else entry.meal_label if entry else "dinner",
        "meal_date": entry.meal_date if entry else None,
        "servings": calculation.servings if recipe else 1,
        "items": items,
        "totals": totals,
        "resolved_items": values,
        "serving_labels": labels,
        "temporary_nutrition": has_provider(calculation),
        "nutrition_unavailable": unavailable,
    }
