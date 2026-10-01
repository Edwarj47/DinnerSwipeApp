from __future__ import annotations

from datetime import date, datetime, time, timedelta
from typing import Literal

from fastapi import APIRouter, HTTPException, Query, UploadFile
from sqlalchemy import delete, func, or_, select

from app.api.deps import BasicUser, DbDep
from app.core.config import settings
from app.models.entities import Favorite, HiddenRecipe, MealSwipe, Recipe, WeeklyPlanSlot
from app.schemas.common import RecipeCreate, RecipeNutrition, RecipeOut, SwipeRequest
from app.services.media_storage import get_media_storage
from app.services.recipes import (
    accessible_recipes_query,
    clear_plan_slot,
    create_recipe,
    current_week_start,
    get_or_create_current_plan,
    record_swipe,
    save_recipe_nutrition,
    serialize_recipe,
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
        start = datetime.combine(current_week_start(), time.min)
        query = query.where(
            Recipe.id.in_(
                select(MealSwipe.recipe_id).where(
                    MealSwipe.user_id == current_user.id,
                    MealSwipe.created_at >= start,
                    MealSwipe.created_at < start + timedelta(days=7),
                    MealSwipe.action.in_(["add", "favorite"]),
                    MealSwipe.undone_at.is_(None),
                )
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
async def upload_recipe_photo(file: UploadFile, current_user: BasicUser) -> dict[str, str]:
    suffix = ALLOWED_IMAGE_TYPES.get(file.content_type or "")
    if not suffix:
        raise HTTPException(status_code=400, detail="Only JPEG, PNG, and WebP images are supported")
    data = await file.read(settings.max_image_upload_size_bytes + 1)
    if len(data) > settings.max_image_upload_size_bytes:
        raise HTTPException(status_code=413, detail="Image is too large")
    if suffix == ".jpg" and not data.startswith(b"\xff\xd8\xff"):
        raise HTTPException(status_code=400, detail="Invalid JPEG image")
    if suffix == ".png" and not data.startswith(b"\x89PNG\r\n\x1a\n"):
        raise HTTPException(status_code=400, detail="Invalid PNG image")
    if suffix == ".webp" and not (data.startswith(b"RIFF") and data[8:12] == b"WEBP"):
        raise HTTPException(status_code=400, detail="Invalid WebP image")
    stored = get_media_storage().save_recipe_image(
        user_id=current_user.id,
        data=data,
        suffix=suffix,
        content_type=file.content_type or "application/octet-stream",
    )
    return {"photo_url": stored.url, "image_status": "validated", "storage_backend": stored.backend}


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
    stored = await upload_recipe_photo(file, current_user)
    recipe.photo_url = stored["photo_url"]
    recipe.photo_source_url = stored["photo_url"]
    recipe.image_status = "validated"
    recipe.validation_warnings = [
        warning
        for warning in recipe.validation_warnings or []
        if warning != "Photo missing; placeholder accepted"
    ]
    db.commit()
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
    week = week_start or current_week_start()
    week -= timedelta(days=week.weekday())
    start = datetime.combine(week, time.min)
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
            MealSwipe.created_at < start + timedelta(days=7),
        )
        .group_by(MealSwipe.recipe_id, MealSwipe.action)
    ).all()
    return {
        "week_start": week,
        "timezone": "UTC",
        "counts": [
            {"recipe_id": recipe_id, "action": action, "selections": count, "undone": undone}
            for recipe_id, action, count, undone in rows
        ],
    }


@router.post("/swipes/{request_id}/undo")
def undo_swipe(request_id: str, db: DbDep, current_user: BasicUser) -> dict[str, str]:
    plan = get_or_create_current_plan(db, current_user)
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
