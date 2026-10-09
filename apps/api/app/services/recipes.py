from __future__ import annotations

import json
from datetime import UTC, date, datetime, timedelta
from hashlib import sha256
from typing import Any
from uuid import uuid4

from fastapi import HTTPException
from sqlalchemy import Select, func, or_, select, true
from sqlalchemy.orm import Session, selectinload

from app.core.actor import current_actor
from app.models.entities import (
    Favorite,
    GroceryList,
    GroceryListItem,
    HiddenRecipe,
    Household,
    HouseholdRecipe,
    MealMacroConfirmation,
    MealSwipe,
    Recipe,
    RecipeIngredient,
    RecipeInstructionStep,
    RecipeMacroProfile,
    RecipeTag,
    User,
    UserProfile,
    WeeklyPlan,
    WeeklyPlanSlot,
)
from app.schemas.common import RecipeCreate, RecipeNutrition
from app.services.pantry import (
    grocery_requirements,
    pantry_adjusted_requirements,
    update_manual_pantry,
)
from app.services.parsing import normalize_name, parse_ingredients, recipe_hash
from app.services.private_media import canonical_photo, photo_url
from app.services.retailers import WalmartSearchLinkAdapter
from app.services.validation import validate_recipe_payload

IGNORED_FEEDBACK_KEY = "ignored_recipe_feedback"
COMPLETED_FEEDBACK_KEY = "completed_recipe_feedback"


def recipe_feedback_fingerprint(recipe: Recipe) -> str:
    value = [
        recipe.validation_status,
        recipe.validation_warnings or [],
        recipe.duplicate_status,
        recipe.image_status,
    ]
    return sha256(json.dumps(value, sort_keys=True).encode()).hexdigest()


def set_recipe_feedback(db: Session, user_id: str, recipes: list[Recipe], action: str) -> None:
    profile = db.scalar(
        select(UserProfile)
        .where(UserProfile.user_id == user_id)
        .with_for_update()
        .execution_options(populate_existing=True)
    )
    if not profile:
        raise HTTPException(404, "Profile not found")
    preferences = dict(profile.notification_preferences or {})
    for key, active_action in (
        (IGNORED_FEEDBACK_KEY, "ignore"),
        (COMPLETED_FEEDBACK_KEY, "complete"),
    ):
        stored = preferences.get(key, {})
        feedback = dict(stored) if isinstance(stored, dict) else {}
        for recipe in recipes:
            if action == active_action:
                feedback[recipe.id] = recipe_feedback_fingerprint(recipe)
            else:
                feedback.pop(recipe.id, None)
        if len(feedback) > 2000:
            raise HTTPException(422, "Return some feedback to review before updating more recipes.")
        preferences[key] = feedback
    profile.notification_preferences = preferences
    db.commit()


def serialize_recipe(
    recipe: Recipe, user_id: str | None = None, db: Session | None = None
) -> dict[str, Any]:
    favorite = False
    hidden = False
    feedback_ignored = False
    feedback_completed = False
    nutrition = None
    calculator_id = None
    if db:
        from app.services.calculator import find_calculation

        calculation = find_calculation(db, recipe_id=recipe.id)
        calculator_id = calculation.id if calculation else None
        profile = db.scalar(
            select(RecipeMacroProfile).where(RecipeMacroProfile.recipe_id == recipe.id)
        )
        if profile:
            nutrition = {
                field: getattr(profile, f"{field}_per_serving")
                for field in RecipeNutrition.model_fields
            }
    if user_id and db:
        user = db.get(User, user_id)
        ignored = (
            (user.profile.notification_preferences or {}).get(IGNORED_FEEDBACK_KEY, {})
            if user and user.profile
            else {}
        )
        feedback_ignored = isinstance(ignored, dict) and ignored.get(
            recipe.id
        ) == recipe_feedback_fingerprint(recipe)
        completed = (
            (user.profile.notification_preferences or {}).get(COMPLETED_FEEDBACK_KEY, {})
            if user and user.profile
            else {}
        )
        feedback_completed = isinstance(completed, dict) and completed.get(
            recipe.id
        ) == recipe_feedback_fingerprint(recipe)
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
        "photo_url": photo_url(db, user, "recipes", recipe.id, recipe.photo_url)
        if db and user_id and user
        else None,
        "servings": recipe.servings,
        "prep_minutes": recipe.prep_minutes,
        "cook_minutes": recipe.cook_minutes,
        "total_minutes": recipe_total_minutes(recipe),
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
        "is_archived": recipe.archived_at is not None,
        "can_edit": bool(user_id and recipe.owner_user_id == user_id),
        "nutrition": nutrition,
        "calculator_id": calculator_id,
        "last_selected_date": None,
        "feedback_ignored": feedback_ignored,
        "feedback_completed": feedback_completed,
    }


def recipe_total_minutes(recipe: Recipe) -> int | None:
    if recipe.prep_minutes is not None or recipe.cook_minutes is not None:
        return (recipe.prep_minutes or 0) + (recipe.cook_minutes or 0)
    return recipe.total_minutes


def recipe_children(payload: RecipeCreate) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
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
    return ingredients, instructions


def update_recipe(
    db: Session, recipe: Recipe, payload: RecipeCreate, *, commit: bool = True
) -> Recipe:
    from app.services.calculator import find_calculation, has_provider, resolve

    actor = current_actor.get()
    user = (
        db.get(User, actor.user_id)
        if actor
        else db.get(User, recipe.owner_user_id)
        if recipe.owner_user_id
        else None
    )
    payload = payload.model_copy(update={"photo_url": canonical_photo(db, user, payload.photo_url)})

    calculation = find_calculation(db, recipe_id=recipe.id)
    if calculation:
        calculation.servings = payload.servings
    ingredients, instructions = recipe_children(payload)
    validation = validate_recipe_payload(
        payload.model_dump() | {"ingredients": ingredients, "instructions": instructions},
        payload.accept_placeholder_photo,
        allow_incomplete=True,
    )
    if not validation["can_approve"]:
        raise HTTPException(422, "; ".join(validation["errors"]))
    content_hash = recipe_hash(payload.name, ingredients, instructions)
    duplicate = db.scalar(
        select(Recipe.id).where(Recipe.content_hash == content_hash, Recipe.id != recipe.id)
    )
    # Keep ownership, provenance and historical meal confirmations unchanged.
    for field in (
        "description",
        "photo_url",
        "servings",
        "prep_minutes",
        "cook_minutes",
        "difficulty",
        "cuisine",
        "meal_type",
        "source_url",
        "source_title",
    ):
        setattr(recipe, field, getattr(payload, field))
    recipe.name = payload.name.strip()
    recipe.total_minutes = (
        payload.total_minutes
        if payload.total_minutes is not None
        else (
            (payload.prep_minutes or 0) + (payload.cook_minutes or 0)
            if payload.prep_minutes is not None or payload.cook_minutes is not None
            else None
        )
    )
    recipe.photo_source_url = payload.photo_url
    recipe.ingredients = [RecipeIngredient(**item) for item in ingredients]
    recipe.instructions = [RecipeInstructionStep(**step) for step in instructions]
    tags = dict.fromkeys(normalize_name(value) for value in payload.tags)
    existing_tags = {item.tag: item for item in recipe.tags}
    recipe.tags = [existing_tags.get(tag) or RecipeTag(tag=tag) for tag in tags if tag]
    recipe.content_hash = content_hash
    recipe.duplicate_status = "exact_duplicate" if duplicate else "new"
    recipe.validation_status = "approved"
    recipe.validation_warnings = validation["warnings"]
    recipe.image_status = validation["image_status"]
    if "nutrition" in payload.model_fields_set:
        save_recipe_nutrition(db, recipe, payload.nutrition or RecipeNutrition())
    elif calculation and not has_provider(calculation):
        totals, _ = resolve(calculation, scale=1 / payload.servings)
        save_recipe_nutrition(db, recipe, RecipeNutrition.model_validate(totals))
    db.flush()
    # Refresh materialized grocery lists only for plans using this recipe this week.
    plans = db.scalars(
        select(WeeklyPlan).where(
            WeeklyPlan.week_start >= current_week_start() - timedelta(days=7),
            WeeklyPlan.week_start <= current_week_start() + timedelta(days=7),
            WeeklyPlan.id.in_(
                select(WeeklyPlanSlot.weekly_plan_id).where(WeeklyPlanSlot.recipe_id == recipe.id)
            ),
        )
    ).all()
    for plan in plans:
        if plan.household_id:
            from app.models.entities import HouseholdMember

            owner_id = db.scalar(
                select(HouseholdMember.user_id).where(
                    HouseholdMember.household_id == plan.household_id,
                    HouseholdMember.role == "owner",
                )
            )
            user = db.get(User, owner_id) if owner_id else None
            if user:
                regenerate_grocery_list(db, user, plan, preserve_edits=True, commit=False)
            continue
        user = db.get(User, plan.user_id)
        if user and plan.week_start == current_week_start(user):
            regenerate_grocery_list(db, user, plan, preserve_edits=True, commit=False)
    db.commit() if commit else db.flush()
    db.refresh(recipe)
    return recipe


def create_recipe(
    db: Session, payload: RecipeCreate, user: User | None = None, *, commit: bool = True
) -> Recipe:
    from app.models.nutrition import NutritionCalculation
    from app.services.billing import require_premium
    from app.services.calculator import has_provider, resolve

    payload = payload.model_copy(update={"photo_url": canonical_photo(db, user, payload.photo_url)})

    source = None
    if payload.calculator_source_id:
        if not user:
            raise HTTPException(404, "Calculation not found.")
        require_premium(db, user)
        source = db.get(NutritionCalculation, payload.calculator_source_id)
        if (
            not source
            or not source.recipe_id
            or not db.scalar(accessible_recipes_query(user).where(Recipe.id == source.recipe_id))
        ):
            raise HTTPException(404, "Calculation not found.")
        if has_provider(source) and payload.nutrition is not None:
            raise HTTPException(422, "Database recipes use refreshed nutrition.")
    ingredients, instructions = recipe_children(payload)
    content_hash = recipe_hash(payload.name, ingredients, instructions)
    validation = validate_recipe_payload(
        payload.model_dump() | {"ingredients": ingredients, "instructions": instructions},
        payload.accept_placeholder_photo,
        allow_incomplete=True,
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
        if payload.total_minutes is not None
        else (
            (payload.prep_minutes or 0) + (payload.cook_minutes or 0)
            if payload.prep_minutes is not None or payload.cook_minutes is not None
            else None
        ),
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
    if payload.nutrition is not None:
        save_recipe_nutrition(db, recipe, payload.nutrition)
    if source and user:
        copied = NutritionCalculation(
            user_id=user.id,
            recipe_id=recipe.id,
            items=source.items,
            servings=payload.servings,
            request_id=str(uuid4()),
        )
        db.add(copied)
        if not has_provider(source):
            totals, _ = resolve(source, scale=1 / payload.servings)
            save_recipe_nutrition(db, recipe, RecipeNutrition.model_validate(totals))
    if commit:
        db.commit()
    else:
        db.flush()
    db.refresh(recipe)
    return recipe


def save_recipe_nutrition(db: Session, recipe: Recipe, nutrition: RecipeNutrition) -> None:
    from app.services.calculator import find_calculation, has_provider

    calculation = find_calculation(db, recipe_id=recipe.id)
    if calculation and has_provider(calculation):
        raise HTTPException(422, "Edit database nutrition in the macro calculator.")
    profile = db.scalar(select(RecipeMacroProfile).where(RecipeMacroProfile.recipe_id == recipe.id))
    if not profile:
        profile = RecipeMacroProfile(recipe_id=recipe.id)
        db.add(profile)
    for field, value in nutrition.model_dump().items():
        setattr(profile, f"{field}_per_serving", value)
    profile.source = "recipe"
    profile.needs_review = False


def accessible_recipes_query(
    user: User, household_id: str | None = None, *, include_archived: bool = False
) -> Select[tuple[Recipe]]:
    household_id = household_id or (user.profile.household_id if user.profile else None)
    return (
        select(Recipe)
        .options(
            selectinload(Recipe.ingredients),
            selectinload(Recipe.instructions),
            selectinload(Recipe.tags),
        )
        .where(
            true() if include_archived else Recipe.archived_at.is_(None),
            Recipe.validation_status == "approved",
            or_(
                Recipe.owner_user_id.is_(None),
                Recipe.owner_user_id == user.id,
                Recipe.household_id == household_id,
                Recipe.id.in_(
                    select(HouseholdRecipe.recipe_id).where(
                        HouseholdRecipe.household_id == household_id
                    )
                ),
            ),
        )
        .order_by(Recipe.created_at.desc())
    )


def current_week_start(user: User | None = None) -> date:
    if user is not None:
        from app.services.planning import week_start_for

        return week_start_for(user)
    today = datetime.now(UTC).date()
    return today - timedelta(days=today.weekday())


def get_or_create_current_plan(db: Session, user: User, *, lock: bool = False) -> WeeklyPlan:
    from app.services.planning import reconcile_current_plan

    return reconcile_current_plan(db, user, lock=lock)


def add_recipe_to_week(db: Session, user: User, recipe_id: str, plan: WeeklyPlan) -> WeeklyPlanSlot:
    slot = db.scalar(
        select(WeeklyPlanSlot)
        .where(
            WeeklyPlanSlot.weekly_plan_id == plan.id,
            WeeklyPlanSlot.recipe_id.is_(None),
            WeeklyPlanSlot.slot_type.in_(["flexible", "meal"]),
            WeeklyPlanSlot.is_locked.is_(False),
        )
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
    # Discover chooses a meal, not a day. Empty slots may retain dates after a reset.
    slot.slot_date = None
    db.flush()
    return slot


def record_swipe(
    db: Session,
    user: User,
    recipe_id: str,
    action: str,
    session_id: str,
    request_id: str | None = None,
) -> MealSwipe:
    plan = get_or_create_current_plan(db, user) if action == "add" else None
    # Serialize retries for this account before checking the unique request key.
    db.execute(select(User.id).where(User.id == user.id).with_for_update()).one()
    if request_id:
        previous = db.scalar(
            select(MealSwipe).where(
                MealSwipe.user_id == user.id, MealSwipe.request_id == request_id
            )
        )
        if previous:
            if (
                previous.recipe_id != recipe_id
                or previous.action != action
                or previous.household_id
            ):
                raise HTTPException(409, "This choice was already saved with different details.")
            return previous
    if not db.scalar(accessible_recipes_query(user).where(Recipe.id == recipe_id)):
        raise HTTPException(404, "Recipe not found")
    swipe = MealSwipe(
        user_id=user.id,
        recipe_id=recipe_id,
        action=action,
        session_id=session_id,
        request_id=request_id,
    )
    db.add(swipe)
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
    if plan:
        swipe.planned_slot_id = add_recipe_to_week(db, user, recipe_id, plan).id
        db.flush()
        regenerate_grocery_list(db, user, plan, preserve_edits=True)
    db.commit()
    return swipe


def retire_slot_choices(db: Session, user_id: str, slot_ids: list[str]) -> None:
    """Keep action counts, but exclude removed plans from the weekly shortlist."""
    if slot_ids:
        db.query(MealSwipe).filter(
            MealSwipe.user_id == user_id,
            MealSwipe.planned_slot_id.in_(slot_ids),
            MealSwipe.undone_at.is_(None),
        ).update({MealSwipe.undone_at: datetime.utcnow()}, synchronize_session=False)


def clear_plan_slot(db: Session, user: User, plan: WeeklyPlan, slot: WeeklyPlanSlot) -> None:
    retire_slot_choices(db, user.id, [slot.id])
    slot.recipe_id = None
    slot.slot_type = "flexible"
    slot.is_locked = False
    db.query(MealMacroConfirmation).filter(
        MealMacroConfirmation.weekly_plan_slot_id == slot.id,
        MealMacroConfirmation.user_id == user.id,
    ).update({MealMacroConfirmation.weekly_plan_slot_id: None}, synchronize_session=False)
    db.flush()
    regenerate_grocery_list(db, user, plan, preserve_edits=True)


def serialize_plan(db: Session, plan: WeeklyPlan) -> dict[str, Any]:
    slots = db.scalars(
        select(WeeklyPlanSlot)
        .where(WeeklyPlanSlot.weekly_plan_id == plan.id)
        .order_by(WeeklyPlanSlot.sort_order)
    ).all()

    def recipe_summary(recipe_id: str | None) -> dict[str, Any]:
        if not recipe_id:
            return {
                "recipe_name": None,
                "recipe_photo_url": None,
                "recipe_total_minutes": None,
                "recipe_difficulty": None,
            }
        recipe = db.get(Recipe, recipe_id)
        return {
            "recipe_name": recipe.name if recipe else None,
            "recipe_photo_url": photo_url(db, viewer, "recipes", recipe.id, recipe.photo_url)
            if recipe and viewer
            else None,
            "recipe_total_minutes": recipe_total_minutes(recipe) if recipe else None,
            "recipe_difficulty": recipe.difficulty if recipe else None,
        }

    actor = current_actor.get()
    viewer = (
        db.get(User, actor.user_id)
        if actor
        else db.get(User, plan.user_id)
        if plan.user_id
        else None
    )
    owner = db.get(User, plan.user_id) if plan.user_id else None
    group = db.get(Household, plan.household_id) if plan.household_id else None
    return {
        "id": plan.id,
        "household_id": plan.household_id,
        "week_start": plan.week_start,
        "reset_cycle": (
            (group.planning_settings or {}).get("cursor")
            if group
            else (
                (owner.profile.notification_preferences or {}) if owner and owner.profile else {}
            ).get("weekly_planning_cursor")
        ),
        "meal_target": plan.meal_target,
        "slots": [
            {
                "id": slot.id,
                "slot_date": slot.slot_date,
                "slot_type": slot.slot_type,
                "recipe_id": slot.recipe_id,
                "servings": slot.servings,
                "is_locked": slot.is_locked,
                "sort_order": slot.sort_order,
            }
            | recipe_summary(slot.recipe_id)
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


def regenerate_grocery_list(
    db: Session,
    user: User,
    plan: WeeklyPlan,
    *,
    preserve_edits: bool = False,
    commit: bool = True,
) -> GroceryList:
    existing = db.scalar(
        select(GroceryList).where(
            GroceryList.household_id == plan.household_id
            if plan.household_id
            else GroceryList.user_id == user.id,
            GroceryList.weekly_plan_id == plan.id,
        )
    )
    retained = {}
    if existing:
        items = db.query(GroceryListItem).filter(GroceryListItem.grocery_list_id == existing.id)
        if preserve_edits:
            items = items.filter(GroceryListItem.match_status != "manual")
            retained = {(item.normalized_name, item.unit): item for item in items.all()}
        else:
            items.delete()
        grocery = existing
    else:
        grocery = GroceryList(
            user_id=None if plan.household_id else user.id,
            household_id=plan.household_id,
            weekly_plan_id=plan.id,
        )
        db.add(grocery)
        db.flush()
    requirements = grocery_requirements(db, plan)
    aggregate = pantry_adjusted_requirements(db, user.id, plan, requirements)
    walmart = WalmartSearchLinkAdapter()
    for (name, _unit), item in aggregate.items():
        row = retained.pop((name, _unit), None)
        if row is None:
            row = GroceryListItem(
                grocery_list_id=grocery.id, normalized_name=name, is_checked=False
            )
            db.add(row)
        row.display_name = item["display_name"]
        row.quantity = round(item["quantity"], 2) if item["quantity"] is not None else None
        row.required_quantity = (
            round(item["required_quantity"], 2) if item["required_quantity"] is not None else None
        )
        row.unit = item["unit"]
        row.category = category_for(name)
        row.walmart_search_url = walmart.build_search_url(name)
        row.match_status = "search_link"
        row.notes = item["notes"]
    for row in retained.values():
        db.delete(row)
    db.flush()
    update_manual_pantry(db, user.id, plan, grocery.id, requirements)
    if commit:
        db.commit()
    else:
        db.flush()
    db.refresh(grocery)
    return grocery
