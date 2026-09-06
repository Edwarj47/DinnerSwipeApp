from __future__ import annotations

from datetime import datetime

from fastapi import APIRouter, HTTPException, Query, UploadFile
from sqlalchemy import or_, select
from sqlalchemy.orm import selectinload

from app.api.deps import BasicUser, DbDep
from app.core.config import settings
from app.models.entities import Favorite, HiddenRecipe, Recipe
from app.schemas.common import RecipeCreate, RecipeOut, SwipeRequest
from app.services.media_storage import get_media_storage
from app.services.recipes import (
    accessible_recipes_query,
    create_recipe,
    record_swipe,
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
    max_total_minutes: int | None = Query(default=None, ge=1, le=1440),
    limit: int = Query(30, ge=1, le=100),
    offset: int = Query(0, ge=0),
) -> list[dict[str, object]]:
    query = accessible_recipes_query(current_user)
    if q:
        query = query.where(Recipe.name.ilike(f"%{q}%"))
    effective_max = max_total_minutes or (
        current_user.profile.max_cook_minutes if current_user.profile else None
    )
    if effective_max:
        query = query.where(
            or_(Recipe.total_minutes.is_(None), Recipe.total_minutes <= effective_max)
        )
    if not include_hidden:
        hidden_ids = select(HiddenRecipe.recipe_id).where(HiddenRecipe.user_id == current_user.id)
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
        select(Recipe)
        .options(
            selectinload(Recipe.ingredients),
            selectinload(Recipe.instructions),
            selectinload(Recipe.tags),
        )
        .where(
            Recipe.id == recipe_id,
            Recipe.archived_at.is_(None),
            or_(Recipe.owner_user_id.is_(None), Recipe.owner_user_id == current_user.id),
        )
    )
    if not recipe:
        raise HTTPException(status_code=404, detail="Recipe not found")
    return serialize_recipe(recipe, current_user.id, db)


@router.post("/{recipe_id}/archive")
def archive_recipe(recipe_id: str, db: DbDep, current_user: BasicUser) -> dict[str, str]:
    recipe = db.get(Recipe, recipe_id)
    if not recipe or recipe.owner_user_id != current_user.id:
        raise HTTPException(status_code=404, detail="Recipe not found")
    recipe.archived_at = datetime.utcnow()
    db.commit()
    return {"status": "archived"}


@router.post("/swipes")
def swipe(payload: SwipeRequest, db: DbDep, current_user: BasicUser) -> dict[str, str]:
    record_swipe(db, current_user, payload.recipe_id, payload.action, payload.session_id)
    return {"status": "recorded"}


@router.post("/{recipe_id}/favorite")
def favorite(recipe_id: str, db: DbDep, current_user: BasicUser) -> dict[str, str]:
    if not db.scalar(
        select(Favorite).where(Favorite.user_id == current_user.id, Favorite.recipe_id == recipe_id)
    ):
        db.add(Favorite(user_id=current_user.id, recipe_id=recipe_id))
        db.commit()
    return {"status": "favorited"}
