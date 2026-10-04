from __future__ import annotations

import hashlib
import json
from typing import Any

from sqlalchemy import select
from sqlalchemy.orm import Session, selectinload

from app.models.entities import GroceryListItem, PantryItem, Recipe, WeeklyPlan, WeeklyPlanSlot


def unit_key(value: str | None) -> str:
    unit = (value or "").strip().lower()
    aliases = {
        "": "each",
        "each": "each",
        "count": "each",
        "piece": "each",
        "pieces": "each",
        "cup": "cup",
        "cups": "cup",
        "tsp": "tsp",
        "teaspoon": "tsp",
        "teaspoons": "tsp",
        "tbsp": "tbsp",
        "tablespoon": "tbsp",
        "tablespoons": "tbsp",
        "g": "g",
        "gram": "g",
        "grams": "g",
        "kg": "kg",
        "kilogram": "kg",
        "kilograms": "kg",
        "ml": "ml",
        "milliliter": "ml",
        "milliliters": "ml",
        "l": "l",
        "liter": "l",
        "liters": "l",
        "oz": "oz",
        "ounce": "oz",
        "ounces": "oz",
        "lb": "lb",
        "pound": "lb",
        "pounds": "lb",
    }
    return aliases.get(unit, unit)


def grocery_requirements(
    db: Session, plan: WeeklyPlan
) -> dict[tuple[str, str | None], dict[str, Any]]:
    slots = db.scalars(
        select(WeeklyPlanSlot).where(
            WeeklyPlanSlot.weekly_plan_id == plan.id, WeeklyPlanSlot.slot_type == "meal"
        )
    ).all()
    recipes = {
        recipe.id: recipe
        for recipe in db.scalars(
            select(Recipe)
            .where(Recipe.id.in_([slot.recipe_id for slot in slots]), Recipe.archived_at.is_(None))
            .options(selectinload(Recipe.ingredients))
        ).all()
    }
    aggregate: dict[tuple[str, str | None], dict[str, Any]] = {}
    for slot in slots:
        recipe = recipes.get(slot.recipe_id or "")
        if not recipe:
            continue
        scale = slot.servings / recipe.servings if recipe.servings else 1
        for ingredient in recipe.ingredients:
            key = (ingredient.normalized_name, ingredient.unit)
            bucket = aggregate.setdefault(
                key,
                {
                    "display_name": ingredient.normalized_name.title(),
                    "quantity": 0.0,
                    "unit": ingredient.unit,
                    "notes": None,
                    "sources": [],
                },
            )
            if ingredient.quantity is None:
                bucket["quantity"] = None
                bucket["notes"] = "Quantity requires review"
            elif bucket["quantity"] is not None:
                bucket["quantity"] += ingredient.quantity * scale
            bucket["sources"].append(
                [
                    recipe.id,
                    slot.servings,
                    recipe.servings,
                    ingredient.original_text,
                    ingredient.quantity,
                ]
            )
    return aggregate


def requirement_fingerprint(
    requirements: dict[tuple[str, str | None], dict[str, Any]], name: str
) -> str:
    sources = [
        [unit, sorted(bucket["sources"], key=lambda row: json.dumps(row))]
        for (ingredient, unit), bucket in requirements.items()
        if ingredient == name
    ]
    return hashlib.sha256(
        json.dumps(sorted(sources, key=lambda row: json.dumps(row))).encode()
    ).hexdigest()


def pantry_adjusted_requirements(
    db: Session,
    user_id: str,
    plan: WeeklyPlan,
    requirements: dict[tuple[str, str | None], dict[str, Any]],
) -> dict[tuple[str, str | None], dict[str, Any]]:
    pantry = {
        item.normalized_name: item
        for item in db.scalars(select(PantryItem).where(PantryItem.user_id == user_id)).all()
    }
    remaining = {name: item.quantity or 0 for name, item in pantry.items()}
    result = {}
    for (name, unit), original in sorted(
        requirements.items(), key=lambda row: (row[0][0], row[0][1] or "")
    ):
        bucket = dict(original) | {"required_quantity": original["quantity"]}
        item = pantry.get(name)
        if item:
            if item.coverage_mode == "legacy":
                continue
            if item.coverage_mode == "enough":
                if (
                    item.week_start == plan.week_start
                    and item.requirements_fingerprint == requirement_fingerprint(requirements, name)
                ):
                    continue
                bucket["notes"] = "Confirm pantry coverage for this week's meals"
            elif item.coverage_mode == "quantity":
                if unit_key(item.unit) == unit_key(unit) and bucket["quantity"] is not None:
                    used = min(remaining[name], bucket["quantity"])
                    remaining[name] -= used
                    bucket["quantity"] = max(0, bucket["quantity"] - used)
                    if bucket["quantity"] == 0:
                        continue
                elif unit_key(item.unit) != unit_key(unit):
                    bucket["notes"] = "Pantry units differ; check the amount needed"
        result[(name, unit)] = bucket
    return result


def update_manual_pantry(
    db: Session,
    user_id: str,
    plan: WeeklyPlan,
    grocery_id: str,
    requirements: dict[tuple[str, str | None], dict[str, Any]],
    only_name: str | None = None,
) -> None:
    pantry = {
        item.normalized_name: item
        for item in db.scalars(select(PantryItem).where(PantryItem.user_id == user_id)).all()
    }
    available = {
        name: max(
            0,
            (item.quantity or 0)
            - sum(
                bucket["quantity"] or 0
                for (ingredient, unit), bucket in requirements.items()
                if ingredient == name and unit_key(unit) == unit_key(item.unit)
            ),
        )
        for name, item in pantry.items()
    }
    rows = db.scalars(
        select(GroceryListItem)
        .where(
            GroceryListItem.grocery_list_id == grocery_id, GroceryListItem.match_status == "manual"
        )
        .order_by(GroceryListItem.id)
    ).all()
    for row in rows:
        if only_name is not None and row.normalized_name != only_name:
            continue
        item = pantry.get(row.normalized_name)
        if not item and only_name is None:
            continue
        if item and (
            item.coverage_mode == "legacy"
            or (
                item.coverage_mode == "enough"
                and item.week_start == plan.week_start
                and item.requirements_fingerprint
                == requirement_fingerprint(requirements, row.normalized_name)
            )
        ):
            row.quantity = 0
        elif row.required_quantity is not None:
            used = (
                min(available[row.normalized_name], row.required_quantity)
                if item
                and item.coverage_mode == "quantity"
                and unit_key(row.unit) == unit_key(item.unit)
                else 0
            )
            row.quantity = max(0, row.required_quantity - used)
            if item:
                available[row.normalized_name] -= used
        elif not item:
            row.quantity = None
