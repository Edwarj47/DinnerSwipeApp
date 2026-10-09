from __future__ import annotations

from datetime import date, datetime, timedelta
from typing import Literal

from fastapi import APIRouter, HTTPException, Query, UploadFile
from sqlalchemy import delete, func, or_, select

from app.api.deps import BasicUser, DbDep
from app.core.config import settings
from app.models.entities import (
    Favorite,
    HiddenRecipe,
    MealSwipe,
    Recipe,
    WeeklyPlan,
    WeeklyPlanSlot,
)
from app.schemas.common import (
    RecipeCreate,
    RecipeFeedbackBatch,
    RecipeFeedbackPreference,
    RecipeNutrition,
    RecipeOut,
    SwipeRequest,
)
from app.services.planning import planning_settings, week_bounds
from app.services.private_media import canonical_photo, object_url, photo_url, store_image
from app.services.recipes import (
    accessible_recipes_query,
    clear_plan_slot,
    create_recipe,
    current_week_start,
    get_or_create_current_plan,
    record_swipe,
    save_recipe_nutrition,
    serialize_recipe,
    set_recipe_feedback,
    update_recipe,
)

router = APIRouter(prefix="/recipes", tags=["recipes"])
ALLOWED_IMAGE_TYPES = {"image/jpeg": ".jpg", "image/png": ".png", "image/webp": ".webp"}


@router.get("", response_model=list[RecipeOut])
def list_recipes(
    db: DbDep,
    current_user: BasicUser,
    q: str | None = None,
    include_hidden: bool = False,
    owned_only: bool = False,
    weekly_picks: bool = False,
    apply_preferences: bool = True,
    max_total_minutes: int | None = Query(default=None, ge=1, le=1440),
    limit: int = Query(30, ge=1, le=100),
    offset: int = Query(0, ge=0),
    collection: Literal["library", "hidden", "archived"] | None = None,
) -> list[dict[str, object]]:
    query = accessible_recipes_query(current_user, include_archived=collection == "archived")
    hidden_ids = select(HiddenRecipe.recipe_id).where(HiddenRecipe.user_id == current_user.id)
    if collection == "archived":
        query = query.where(
            Recipe.owner_user_id == current_user.id, Recipe.archived_at.is_not(None)
        )
    elif collection == "hidden":
        query = query.where(Recipe.id.in_(hidden_ids))
    if owned_only:
        query = query.where(Recipe.owner_user_id == current_user.id)
    if q:
        query = query.where(Recipe.name.ilike(f"%{q}%"))
    if weekly_picks:
        week = current_week_start(current_user)
        start, end = week_bounds(current_user, week)
        query = query.where(
            or_(
                Recipe.id.in_(
                    select(MealSwipe.recipe_id).where(
                        MealSwipe.user_id == current_user.id,
                        MealSwipe.created_at >= start,
                        MealSwipe.created_at < end,
                        MealSwipe.action.in_(["add", "favorite"]),
                        MealSwipe.undone_at.is_(None),
                    )
                ),
                Recipe.id.in_(
                    select(WeeklyPlanSlot.recipe_id)
                    .join(WeeklyPlan, WeeklyPlan.id == WeeklyPlanSlot.weekly_plan_id)
                    .where(WeeklyPlan.user_id == current_user.id, WeeklyPlan.week_start == week)
                ),
            )
        )
    effective_max = max_total_minutes or (
        current_user.profile.max_cook_minutes
        if apply_preferences and not collection and current_user.profile
        else None
    )
    if effective_max:
        query = query.where(
            or_(Recipe.total_minutes.is_(None), Recipe.total_minutes <= effective_max)
        )
    if collection == "library" or (not collection and not include_hidden):
        query = query.where(Recipe.id.not_in(hidden_ids))
    recipes = db.scalars(query.limit(limit).offset(offset)).unique().all()
    return [serialize_recipe(recipe, current_user.id, db) for recipe in recipes]


@router.post("", response_model=RecipeOut)
def create_recipe_route(
    payload: RecipeCreate, db: DbDep, current_user: BasicUser
) -> dict[str, object]:
    recipe = create_recipe(db, payload, current_user)
    return serialize_recipe(recipe, current_user.id, db)


@router.post("/photo-upload")
async def upload_recipe_photo(
    file: UploadFile, current_user: BasicUser, db: DbDep
) -> dict[str, str]:
    suffix = ALLOWED_IMAGE_TYPES.get(file.content_type or "")
    if not suffix:
        raise HTTPException(status_code=400, detail="Only JPEG, PNG, and WebP images are supported")
    data = await file.read(settings.max_image_upload_size_bytes + 1)
    if len(data) > settings.max_image_upload_size_bytes:
        raise HTTPException(status_code=413, detail="Image is too large")
    from starlette.concurrency import run_in_threadpool

    stored = await run_in_threadpool(store_image, db, current_user, data)
    return {
        "photo_url": photo_url(db, current_user, "objects", stored.id, object_url(stored.id)) or "",
        "image_status": "validated",
        "storage_backend": stored.backend,
    }


@router.put("/feedback-preferences", response_model=list[RecipeOut])
def update_feedback_batch(
    payload: RecipeFeedbackBatch, db: DbDep, current_user: BasicUser
) -> list[dict[str, object]]:
    recipe_ids = list(dict.fromkeys(payload.recipe_ids))
    recipes = list(
        db.scalars(
            accessible_recipes_query(current_user, include_archived=True).where(
                Recipe.id.in_(recipe_ids)
            )
        )
        .unique()
        .all()
    )
    if len(recipes) != len(recipe_ids):
        raise HTTPException(404, "One or more recipes are unavailable. Refresh and try again.")
    set_recipe_feedback(db, current_user.id, recipes, payload.action)
    return [serialize_recipe(recipe, current_user.id, db) for recipe in recipes]


@router.get("/{recipe_id}", response_model=RecipeOut)
def get_recipe(recipe_id: str, db: DbDep, current_user: BasicUser) -> dict[str, object]:
    recipe = db.scalar(
        accessible_recipes_query(current_user).where(
            Recipe.id == recipe_id,
            Recipe.archived_at.is_(None),
        )
    )
    if not recipe:
        raise HTTPException(status_code=404, detail="Recipe not found")
    return serialize_recipe(recipe, current_user.id, db)


@router.put("/{recipe_id}/photo", response_model=RecipeOut)
async def update_recipe_photo(
    recipe_id: str, file: UploadFile, db: DbDep, current_user: BasicUser
) -> dict[str, object]:
    recipe = db.get(Recipe, recipe_id)
    if not recipe or recipe.owner_user_id != current_user.id:
        raise HTTPException(404, "Recipe not found")
    stored = await upload_recipe_photo(file, current_user, db)
    recipe.photo_url = canonical_photo(db, current_user, stored["photo_url"])
    recipe.photo_source_url = recipe.photo_url
    recipe.image_status = "validated"
    recipe.validation_warnings = [
        warning
        for warning in recipe.validation_warnings or []
        if warning != "Photo missing; placeholder accepted"
    ]
    db.commit()
    return serialize_recipe(recipe, current_user.id, db)


@router.put("/{recipe_id}/feedback-preference", response_model=RecipeOut)
def update_feedback_preference(
    recipe_id: str, payload: RecipeFeedbackPreference, db: DbDep, current_user: BasicUser
) -> dict[str, object]:
    recipe = db.scalar(
        accessible_recipes_query(current_user, include_archived=True).where(Recipe.id == recipe_id)
    )
    if not recipe:
        raise HTTPException(404, "Recipe not found")
    set_recipe_feedback(db, current_user.id, [recipe], "ignore" if payload.ignored else "review")
    return serialize_recipe(recipe, current_user.id, db)


@router.put("/{recipe_id}", response_model=RecipeOut)
def update_recipe_route(
    recipe_id: str, payload: RecipeCreate, db: DbDep, current_user: BasicUser
) -> dict[str, object]:
    recipe = db.scalar(
        select(Recipe)
        .where(Recipe.id == recipe_id, Recipe.owner_user_id == current_user.id)
        .with_for_update()
    )
    if not recipe:
        raise HTTPException(404, "Recipe not found")
    recipe = update_recipe(db, recipe, payload)
    return serialize_recipe(recipe, current_user.id, db)


@router.post("/{recipe_id}/archive")
def archive_recipe(recipe_id: str, db: DbDep, current_user: BasicUser) -> dict[str, str]:
    recipe = db.get(Recipe, recipe_id)
    if not recipe or recipe.owner_user_id != current_user.id:
        raise HTTPException(status_code=404, detail="Recipe not found")
    recipe.archived_at = datetime.utcnow()
    db.commit()
    return {"status": "archived"}


@router.post("/{recipe_id}/restore")
def restore_recipe(recipe_id: str, db: DbDep, current_user: BasicUser) -> dict[str, str]:
    recipe = db.get(Recipe, recipe_id)
    if not recipe or recipe.owner_user_id != current_user.id:
        raise HTTPException(404, "Recipe not found")
    recipe.archived_at = None
    db.execute(
        delete(HiddenRecipe).where(
            HiddenRecipe.user_id == current_user.id,
            HiddenRecipe.recipe_id == recipe_id,
        )
    )
    db.commit()
    return {"status": "restored"}


@router.post("/{recipe_id}/unhide")
def unhide_recipe(recipe_id: str, db: DbDep, current_user: BasicUser) -> dict[str, str]:
    if not db.scalar(accessible_recipes_query(current_user).where(Recipe.id == recipe_id)):
        raise HTTPException(404, "Recipe not found")
    db.execute(
        delete(HiddenRecipe).where(
            HiddenRecipe.user_id == current_user.id,
            HiddenRecipe.recipe_id == recipe_id,
        )
    )
    db.commit()
    return {"status": "visible"}


@router.put("/{recipe_id}/nutrition", response_model=RecipeOut)
def update_recipe_nutrition(
    recipe_id: str,
    payload: RecipeNutrition,
    db: DbDep,
    current_user: BasicUser,
) -> dict[str, object]:
    recipe = db.get(Recipe, recipe_id)
    if not recipe or recipe.owner_user_id != current_user.id:
        raise HTTPException(404, "Recipe not found")
    save_recipe_nutrition(db, recipe, payload)
    db.commit()
    return serialize_recipe(recipe, current_user.id, db)


@router.post("/swipes")
def swipe(payload: SwipeRequest, db: DbDep, current_user: BasicUser) -> dict[str, str]:
    if payload.household_id:
        from app.services.group_planning import record_swipe as group_swipe

        event = group_swipe(
            db,
            current_user,
            payload.recipe_id,
            payload.action,
            payload.session_id,
            payload.request_id,
            payload.household_id,
        )
        return {"status": "recorded", "swipe_id": event.id}
    event = record_swipe(
        db, current_user, payload.recipe_id, payload.action, payload.session_id, payload.request_id
    )
    return {"status": "recorded", "swipe_id": event.id}


@router.get("/swipes/summary")
def swipe_summary(
    db: DbDep,
    current_user: BasicUser,
    week_start: date | None = None,
) -> dict[str, object]:
    week = week_start or current_week_start(current_user)
    week -= timedelta(days=week.weekday())
    start, end = week_bounds(current_user, week)
    rows = db.execute(
        select(
            MealSwipe.recipe_id,
            MealSwipe.action,
            func.count(MealSwipe.id),
            func.count(MealSwipe.undone_at),
        )
        .where(
            MealSwipe.user_id == current_user.id,
            MealSwipe.created_at >= start,
            MealSwipe.created_at < end,
        )
        .group_by(MealSwipe.recipe_id, MealSwipe.action)
    ).all()
    return {
        "week_start": week,
        "timezone": planning_settings(current_user)["time_zone"],
        "counts": [
            {"recipe_id": recipe_id, "action": action, "selections": count, "undone": undone}
            for recipe_id, action, count, undone in rows
        ],
    }


@router.post("/swipes/{request_id}/undo")
def undo_swipe(request_id: str, db: DbDep, current_user: BasicUser) -> dict[str, str]:
    event = db.scalar(
        select(MealSwipe)
        .where(
            MealSwipe.user_id == current_user.id,
            MealSwipe.request_id == request_id,
        )
        .with_for_update()
    )
    if not event or event.action != "add":
        raise HTTPException(404, "Planned choice not found")
    if event.household_id:
        from app.services.group_planning import undo_swipe as group_undo

        group_undo(db, current_user, event)
        return {"status": "undone"}
    plan = get_or_create_current_plan(db, current_user)
    if event.undone_at:
        return {"status": "undone"}
    slot = db.scalar(
        select(WeeklyPlanSlot).where(
            WeeklyPlanSlot.id == event.planned_slot_id,
            WeeklyPlanSlot.weekly_plan_id == plan.id,
            WeeklyPlanSlot.recipe_id == event.recipe_id,
        )
    )
    if not slot:
        raise HTTPException(409, "This dinner has changed. Review it in This Week.")
    clear_plan_slot(db, current_user, plan, slot)
    return {"status": "undone"}


@router.post("/{recipe_id}/favorite")
def favorite(recipe_id: str, db: DbDep, current_user: BasicUser) -> dict[str, str]:
    if not db.scalar(
        select(Favorite).where(Favorite.user_id == current_user.id, Favorite.recipe_id == recipe_id)
    ):
        db.add(Favorite(user_id=current_user.id, recipe_id=recipe_id))
        db.commit()
    return {"status": "favorited"}
