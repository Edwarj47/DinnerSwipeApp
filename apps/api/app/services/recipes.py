from __future__ import annotations

from datetime import date, timedelta
from typing import Any

from sqlalchemy import Select, and_, func, or_, select
from sqlalchemy.orm import Session, selectinload

from app.models.entities import (
    Favorite,
    GroceryList,
    GroceryListItem,
    HiddenRecipe,
    MealSwipe,
    PantryItem,
    Recipe,
    RecipeIngredient,
    RecipeInstructionStep,
    RecipeTag,
    User,
    WeeklyPlan,
    WeeklyPlanSlot,
)
from app.schemas.common import RecipeCreate
from app.services.parsing import normalize_name, parse_ingredients, recipe_hash
from app.services.retailers import WalmartSearchLinkAdapter
from app.services.validation import validate_recipe_payload


def serialize_recipe(
    recipe: Recipe, user_id: str | None = None, db: Session | None = None
) -> dict[str, Any]:
    favorite = False
    hidden = False
    if user_id and db:
        favorite_count = db.scalar(
            select(func.count())
            .select_from(Favorite)
            .where(Favorite.user_id == user_id, Favorite.recipe_id == recipe.id)
        )
        favorite = (favorite_count or 0) > 0
        hidden_count = db.scalar(
            select(func.count())
            .select_from(HiddenRecipe)
            .where(HiddenRecipe.user_id == user_id, HiddenRecipe.recipe_id == recipe.id)
        )
        hidden = (hidden_count or 0) > 0
    return {
        "id": recipe.id,
        "name": recipe.name,
        "description": recipe.description,
        "photo_url": recipe.photo_url,
        "servings": recipe.servings,
        "prep_minutes": recipe.prep_minutes,
        "cook_minutes": recipe.cook_minutes,
        "total_minutes": recipe.total_minutes,
        "difficulty": recipe.difficulty,
        "cuisine": recipe.cuisine,
        "meal_type": recipe.meal_type,
        "source_type": recipe.source_type,
        "source_url": recipe.source_url,
        "source_title": recipe.source_title,
        "validation_status": recipe.validation_status,
        "validation_warnings": recipe.validation_warnings or [],
        "duplicate_status": recipe.duplicate_status,
        "image_status": recipe.image_status,
        "created_at": recipe.created_at,
        "updated_at": recipe.updated_at,
        "ingredients": [
            {
                "original_text": i.original_text,
                "normalized_name": i.normalized_name,
                "quantity": i.quantity,
                "unit": i.unit,
                "preparation_note": i.preparation_note,
                "is_optional": i.is_optional,
                "section": i.section,
                "sort_order": i.sort_order,
            }
            for i in recipe.ingredients
        ],
        "instructions": [
            {
                "step_number": s.step_number,
                "text": s.text,
                "section": s.section,
                "timer_minutes": s.timer_minutes,
            }
            for s in recipe.instructions
        ],
        "tags": [tag.tag for tag in recipe.tags],
        "is_favorite": favorite,
        "is_hidden": hidden,
        "last_selected_date": None,
    }


def create_recipe(db: Session, payload: RecipeCreate, user: User | None = None) -> Recipe:
    ingredients = []
    for i in payload.ingredients:
        item = i.model_dump()
        if not i.normalized_name:
            parsed = parse_ingredients(i.original_text)
            if parsed:
                item = item | {
                    "normalized_name": parsed[0]["normalized_name"],
                    "quantity": item.get("quantity")
                    if item.get("quantity") is not None
                    else parsed[0]["quantity"],
                    "unit": item.get("unit") or parsed[0]["unit"],
                }
            else:
                item["normalized_name"] = normalize_name(i.original_text)
        ingredients.append(item)
    instructions = [s.model_dump() for s in payload.instructions]
    content_hash = recipe_hash(payload.name, ingredients, instructions)
    validation = validate_recipe_payload(
        payload.model_dump() | {"ingredients": ingredients, "instructions": instructions},
        payload.accept_placeholder_photo,
    )
    duplicate = db.scalar(select(Recipe).where(Recipe.content_hash == content_hash))
    recipe = Recipe(
        owner_user_id=user.id if user else None,
        household_id=user.profile.household_id if user and user.profile else None,
        name=payload.name.strip(),
        description=payload.description,
        photo_url=payload.photo_url,
        photo_source_url=payload.photo_url,
        servings=payload.servings,
        prep_minutes=payload.prep_minutes,
        cook_minutes=payload.cook_minutes,
        total_minutes=payload.total_minutes
        or ((payload.prep_minutes or 0) + (payload.cook_minutes or 0) or None),
        difficulty=payload.difficulty,
        cuisine=payload.cuisine,
        meal_type=payload.meal_type,
        source_type=payload.source_type,
        source_url=payload.source_url,
        source_title=payload.source_title,
        validation_status="approved" if validation["can_approve"] else "requires_review",
        validation_warnings=validation["warnings"],
        duplicate_status="exact_duplicate" if duplicate else "new",
        created_by=user.id if user else "seed",
        content_hash=content_hash,
        image_status=validation["image_status"],
    )
    db.add(recipe)
    db.flush()
    for item in ingredients:
        db.add(RecipeIngredient(recipe_id=recipe.id, **item))
    for step in instructions:
        db.add(RecipeInstructionStep(recipe_id=recipe.id, **step))
    for tag in payload.tags:
        clean = normalize_name(tag)
        if clean:
            db.add(RecipeTag(recipe_id=recipe.id, tag=clean))
    db.commit()
    db.refresh(recipe)
    return recipe


def accessible_recipes_query(user: User) -> Select[tuple[Recipe]]:
    return (
        select(Recipe)
        .options(
            selectinload(Recipe.ingredients),
            selectinload(Recipe.instructions),
            selectinload(Recipe.tags),
        )
        .where(
            Recipe.archived_at.is_(None),
            Recipe.validation_status == "approved",
            or_(Recipe.owner_user_id.is_(None), Recipe.owner_user_id == user.id),
        )
        .order_by(Recipe.created_at.desc())
    )


def get_or_create_current_plan(db: Session, user: User) -> WeeklyPlan:
    today = date.today()
    week_start = today - timedelta(days=today.weekday())
    plan = db.scalar(
        select(WeeklyPlan).where(WeeklyPlan.user_id == user.id, WeeklyPlan.week_start == week_start)
    )
    if plan:
        return plan
    target = user.profile.weekly_meal_target if user.profile else 5
    plan = WeeklyPlan(user_id=user.id, week_start=week_start, meal_target=target)
    db.add(plan)
    db.flush()
    for index in range(target):
        db.add(
            WeeklyPlanSlot(
                weekly_plan_id=plan.id,
                slot_type="flexible",
                servings=user.profile.household_size if user.profile else 4,
                sort_order=index,
            )
        )
    db.commit()
    db.refresh(plan)
    return plan


def add_recipe_to_week(db: Session, user: User, recipe_id: str) -> WeeklyPlan:
    plan = get_or_create_current_plan(db, user)
    slot = db.scalar(
        select(WeeklyPlanSlot)
        .where(WeeklyPlanSlot.weekly_plan_id == plan.id, WeeklyPlanSlot.recipe_id.is_(None))
        .order_by(WeeklyPlanSlot.sort_order)
    )
    if not slot:
        slot = WeeklyPlanSlot(
            weekly_plan_id=plan.id,
            slot_type="meal",
            recipe_id=recipe_id,
            servings=user.profile.household_size if user.profile else 4,
            sort_order=99,
        )
        db.add(slot)
    else:
        slot.slot_type = "meal"
        slot.recipe_id = recipe_id
    db.commit()
    return plan


def record_swipe(db: Session, user: User, recipe_id: str, action: str, session_id: str) -> None:
    db.add(MealSwipe(user_id=user.id, recipe_id=recipe_id, action=action, session_id=session_id))
    if action == "favorite":
        if not db.scalar(
            select(Favorite).where(Favorite.user_id == user.id, Favorite.recipe_id == recipe_id)
        ):
            db.add(Favorite(user_id=user.id, recipe_id=recipe_id))
    if action == "hide":
        if not db.scalar(
            select(HiddenRecipe).where(
                HiddenRecipe.user_id == user.id, HiddenRecipe.recipe_id == recipe_id
            )
        ):
            db.add(HiddenRecipe(user_id=user.id, recipe_id=recipe_id))
    if action == "add":
        add_recipe_to_week(db, user, recipe_id)
    db.commit()


def serialize_plan(db: Session, plan: WeeklyPlan) -> dict[str, Any]:
    slots = db.scalars(
        select(WeeklyPlanSlot)
        .where(WeeklyPlanSlot.weekly_plan_id == plan.id)
        .order_by(WeeklyPlanSlot.sort_order)
    ).all()

    def recipe_name(recipe_id: str | None) -> str | None:
        if not recipe_id:
            return None
        recipe = db.get(Recipe, recipe_id)
        return recipe.name if recipe else None

    return {
        "id": plan.id,
        "week_start": plan.week_start,
        "meal_target": plan.meal_target,
        "slots": [
            {
                "id": slot.id,
                "slot_date": slot.slot_date,
                "slot_type": slot.slot_type,
                "recipe_id": slot.recipe_id,
                "recipe_name": recipe_name(slot.recipe_id),
                "servings": slot.servings,
                "is_locked": slot.is_locked,
                "sort_order": slot.sort_order,
            }
            for slot in slots
        ],
    }


def category_for(name: str) -> str:
    if any(word in name for word in ["chicken", "beef", "sausage", "egg", "turkey"]):
        return "protein"
    if any(word in name for word in ["rice", "pasta", "tortilla", "bun", "bread"]):
        return "grains"
    if any(word in name for word in ["salt", "pepper", "oil", "garlic", "sauce"]):
        return "pantry"
    return "produce"


def regenerate_grocery_list(db: Session, user: User, plan: WeeklyPlan) -> GroceryList:
    existing = db.scalar(
        select(GroceryList).where(
            GroceryList.user_id == user.id, GroceryList.weekly_plan_id == plan.id
        )
    )
    if existing:
        db.query(GroceryListItem).filter(GroceryListItem.grocery_list_id == existing.id).delete()
        grocery = existing
    else:
        grocery = GroceryList(user_id=user.id, weekly_plan_id=plan.id)
        db.add(grocery)
        db.flush()
    pantry = {
        item.normalized_name
        for item in db.scalars(select(PantryItem).where(PantryItem.user_id == user.id)).all()
    }
    aggregate: dict[tuple[str, str | None], dict[str, Any]] = {}
    slots = db.scalars(select(WeeklyPlanSlot).where(WeeklyPlanSlot.weekly_plan_id == plan.id)).all()
    for slot in slots:
        if slot.slot_type != "meal" or not slot.recipe_id:
            continue
        recipe = db.scalar(
            select(Recipe)
            .options(selectinload(Recipe.ingredients))
            .where(and_(Recipe.id == slot.recipe_id, Recipe.archived_at.is_(None)))
        )
        if not recipe:
            continue
        scale = slot.servings / recipe.servings if recipe.servings else 1
        for ingredient in recipe.ingredients:
            if ingredient.normalized_name in pantry:
                continue
            key = (ingredient.normalized_name, ingredient.unit)
            bucket = aggregate.setdefault(
                key,
                {
                    "display_name": ingredient.normalized_name.title(),
                    "quantity": 0.0 if ingredient.quantity is not None else None,
                    "unit": ingredient.unit,
                    "notes": None,
                },
            )
            if ingredient.quantity is not None and bucket["quantity"] is not None:
                bucket["quantity"] += ingredient.quantity * scale
            elif ingredient.quantity is None:
                bucket["notes"] = "Quantity requires review"
    walmart = WalmartSearchLinkAdapter()
    for (name, _unit), item in sorted(aggregate.items()):
        db.add(
            GroceryListItem(
                grocery_list_id=grocery.id,
                normalized_name=name,
                display_name=item["display_name"],
                quantity=round(item["quantity"], 2) if item["quantity"] is not None else None,
                unit=item["unit"],
                category=category_for(name),
                walmart_search_url=walmart.build_search_url(name),
                match_status="search_link",
                notes=item["notes"],
            )
        )
    db.commit()
    db.refresh(grocery)
    return grocery
