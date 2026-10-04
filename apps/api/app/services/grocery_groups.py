from __future__ import annotations

from typing import Any

from sqlalchemy import select
from sqlalchemy.orm import Session, selectinload

from app.models.entities import Recipe, WeeklyPlan, WeeklyPlanSlot


def recipe_grocery_groups(
    db: Session, plan: WeeklyPlan, items: list[dict[str, Any]]
) -> list[dict[str, Any]]:
    slots = db.scalars(
        select(WeeklyPlanSlot)
        .where(WeeklyPlanSlot.weekly_plan_id == plan.id, WeeklyPlanSlot.slot_type == "meal")
        .order_by(WeeklyPlanSlot.sort_order, WeeklyPlanSlot.id)
    ).all()
    recipes = {
        recipe.id: recipe
        for recipe in db.scalars(
            select(Recipe)
            .where(Recipe.id.in_([slot.recipe_id for slot in slots]), Recipe.archived_at.is_(None))
            .options(selectinload(Recipe.ingredients))
        ).all()
    }
    shopping = {
        (item["normalized_name"], item["unit"]): item
        for item in items
        if item["match_status"] != "manual"
    }
    servings: dict[str, int] = {}
    for slot in slots:
        if slot.recipe_id in recipes:
            servings[slot.recipe_id] = servings.get(slot.recipe_id, 0) + slot.servings
    groups: list[dict[str, Any]] = []
    uses: dict[str, int] = {}
    for recipe_id, portions in servings.items():
        recipe = recipes[recipe_id]
        scale = portions / recipe.servings if recipe.servings else 1
        quantities: dict[tuple[str, str | None], float | None] = {}
        for ingredient in recipe.ingredients:
            key = (ingredient.normalized_name, ingredient.unit)
            amount = ingredient.quantity * scale if ingredient.quantity is not None else None
            if key not in quantities:
                quantities[key] = amount
            else:
                previous = quantities[key]
                quantities[key] = (
                    previous + amount if previous is not None and amount is not None else None
                )
        rows = []
        for key, amount in quantities.items():
            if key not in shopping:
                continue
            item = shopping[key]
            uses[item["id"]] = uses.get(item["id"], 0) + 1
            rows.append(
                item | {"recipe_quantity": round(amount, 2) if amount is not None else None}
            )
        if rows:
            groups.append(
                {
                    "recipe_id": recipe_id,
                    "recipe_name": recipe.name,
                    "servings": portions,
                    "items": rows,
                }
            )
    for group in groups:
        for row in group["items"]:
            row["recipe_count"] = uses[row["id"]]
    extra = [item for item in items if item["id"] not in uses]
    if extra:
        groups.append(
            {"recipe_id": None, "recipe_name": "Additional items", "servings": None, "items": extra}
        )
    return groups
