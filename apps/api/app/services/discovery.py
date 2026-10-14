from __future__ import annotations

from typing import Any

from sqlalchemy import Select, case, false, func, or_

from app.models.entities import Recipe, User

DISCOVER_KEY = "discover_filters"
CATEGORIES = ("breakfast", "lunch", "dinner", "snack", "beverage", "dessert", "sauce", "other")
ALIASES = {
    "beverages": "beverage",
    "drink": "beverage",
    "drinks": "beverage",
    "snacks": "snack",
    "desserts": "dessert",
    "sauces": "sauce",
}


def preferences(user: User) -> dict[str, list[str]]:
    stored = (
        (user.profile.notification_preferences or {}).get(DISCOVER_KEY) if user.profile else None
    )
    values = stored.get("categories") if isinstance(stored, dict) else None
    selected = (
        set(values)
        if isinstance(values, list) and all(isinstance(v, str) for v in values)
        else set(CATEGORIES)
    )
    return {"categories": [category for category in CATEGORIES if category in selected]}


def filter_query(query: Select[Any], user: User) -> Select[Any]:
    selected = preferences(user)["categories"]
    if not selected:
        return query.where(false())
    raw = func.coalesce(func.nullif(func.lower(func.trim(Recipe.meal_type)), ""), "dinner")
    category = case(ALIASES, value=raw, else_=raw)
    terms = [category.in_([value for value in selected if value != "other"])]
    if "other" in selected:
        terms.append(category.not_in(CATEGORIES[:-1]))
    return query.where(or_(*terms))
