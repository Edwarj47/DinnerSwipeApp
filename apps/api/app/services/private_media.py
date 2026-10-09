from __future__ import annotations

import hashlib
import io
import re
import warnings
from datetime import UTC, datetime, timedelta
from typing import cast
from urllib.parse import urlparse

from fastapi import HTTPException
from jose import JWTError, jwt
from PIL import Image, ImageOps, UnidentifiedImageError
from sqlalchemy import func, or_, select
from sqlalchemy.orm import Session

from app.core.config import settings
from app.core.security import ALGORITHM
from app.models.entities import (
    HouseholdMember,
    HouseholdRecipe,
    Recipe,
    UrlIngestionCandidate,
    User,
)
from app.models.security import MediaObject
from app.services.media_storage import get_media_storage

Image.MAX_IMAGE_PIXELS = 20_000_000
MEDIA_PREFIX = "/api/v1/media/"
LOCAL_KEY = re.compile(r"^uploads/([a-f0-9-]{36})/([a-f0-9]{32})\.(jpg|png|webp)$")


def allowed_recipe(db: Session, user: User, recipe_id: str) -> Recipe | None:
    groups = select(HouseholdMember.household_id).where(HouseholdMember.user_id == user.id)
    return db.scalar(
        select(Recipe).where(
            Recipe.id == recipe_id,
            or_(
                Recipe.owner_user_id == user.id,
                Recipe.owner_user_id.is_(None),
                Recipe.household_id.in_(groups),
                Recipe.id.in_(
                    select(HouseholdRecipe.recipe_id).where(
                        HouseholdRecipe.household_id.in_(groups)
                    )
                ),
            ),
        )
    )


def source_for(db: Session, user: User, kind: str, resource_id: str) -> str:
    if kind == "recipes":
        row = allowed_recipe(db, user, resource_id)
        value = row.photo_url if row else None
    elif kind == "drafts":
        draft = db.get(UrlIngestionCandidate, resource_id)
        value = (
            cast(str | None, draft.extracted_data.get("photo_url"))
            if draft and draft.user_id == user.id
            else None
        )
    elif kind == "objects":
        media = db.get(MediaObject, resource_id)
        if not media or media.deleted_at:
            raise HTTPException(404, "Photo not found")
        if media.owner_user_id != user.id:
            references = db.scalars(
                select(Recipe.id).where(Recipe.photo_url == object_url(media.id))
            ).all()
            if not any(allowed_recipe(db, user, value) for value in references):
                raise HTTPException(404, "Photo not found")
        value = object_url(media.id)
    else:
        value = None
    if not isinstance(value, str) or not value:
        raise HTTPException(404, "Photo not found")
    return value


def object_url(media_id: str) -> str:
    return f"{settings.public_api_url.rstrip('/')}{MEDIA_PREFIX}objects/{media_id}"


def photo_url(
    db: Session, user: User, kind: str, resource_id: str, source: str | None
) -> str | None:
    if not source:
        return None
    digest = hashlib.sha256(source.encode()).hexdigest()
    token = jwt.encode(
        {
            "sub": user.id,
            "sv": user.session_version,
            "type": "photo",
            "kind": kind,
            "id": resource_id,
            "source": digest,
            "exp": datetime.now(UTC) + timedelta(minutes=5),
        },
        settings.jwt_secret,
        algorithm=ALGORITHM,
    )
    endpoint = f"{settings.public_api_url.rstrip('/')}{MEDIA_PREFIX}{kind}/{resource_id}"
    return f"{endpoint}?v={digest}&token={token}"


def authorize_photo(db: Session, token: str, kind: str, resource_id: str) -> tuple[User, str]:
    try:
        value = jwt.decode(
            token,
            settings.jwt_secret,
            algorithms=[ALGORITHM],
            options={"require_exp": True, "require_sub": True},
        )
    except JWTError:
        raise HTTPException(401, "Photo link expired. Refresh recipes.") from None
    user = db.get(User, value["sub"])
    if (
        not user
        or not user.is_active
        or value.get("sv") != user.session_version
        or value.get("type") != "photo"
        or value.get("kind") != kind
        or value.get("id") != resource_id
    ):
        raise HTTPException(401, "Photo not available")
    source = source_for(db, user, kind, resource_id)
    if value.get("source") != hashlib.sha256(source.encode()).hexdigest():
        raise HTTPException(404, "Photo has changed")
    return user, source


def normalize_image(data: bytes) -> bytes:
    if not data or len(data) > settings.max_image_upload_size_bytes:
        raise HTTPException(413, "Image is too large")
    try:
        with warnings.catch_warnings():
            warnings.simplefilter("error", Image.DecompressionBombWarning)
            with Image.open(io.BytesIO(data)) as image:
                if image.format not in {"JPEG", "PNG", "WEBP"}:
                    raise ValueError("Unsupported image")
                image.load()
                normalized = ImageOps.exif_transpose(image)
                normalized.thumbnail((2000, 2000))
                output = io.BytesIO()
                normalized.convert("RGB").save(output, format="JPEG", quality=88)
                return output.getvalue()
    except (
        UnidentifiedImageError,
        OSError,
        ValueError,
        Image.DecompressionBombError,
        Image.DecompressionBombWarning,
    ):
        raise HTTPException(400, "Invalid JPEG, PNG, or WebP image") from None


def store_image(db: Session, user: User, data: bytes) -> MediaObject:
    data = normalize_image(data)
    # Serialize quota checks with uploads for this account across API workers.
    db.scalar(select(User).where(User.id == user.id).with_for_update())
    used = (
        db.scalar(
            select(func.coalesce(func.sum(MediaObject.size_bytes), 0)).where(
                MediaObject.owner_user_id == user.id, MediaObject.deleted_at.is_(None)
            )
        )
        or 0
    )
    if used + len(data) > settings.media_account_quota_bytes:
        raise HTTPException(413, "Photo storage is full. Remove unused photos before uploading.")
    storage = get_media_storage()
    stored = storage.save_recipe_image(
        user_id=user.id, data=data, suffix=".jpg", content_type="image/jpeg"
    )
    media = MediaObject(
        owner_user_id=user.id,
        storage_key=stored.key,
        backend=stored.backend,
        content_type="image/jpeg",
        size_bytes=len(data),
    )
    try:
        db.add(media)
        db.commit()
        db.refresh(media)
    except Exception:
        db.rollback()
        storage.delete(stored.key)
        raise
    return media


def local_object(db: Session, source: str) -> MediaObject | None:
    parsed = urlparse(source)
    path = parsed.path
    if parsed.netloc not in {
        urlparse(settings.public_api_url).netloc,
        urlparse(settings.media_public_base_url).netloc,
    }:
        return None
    if path.startswith(MEDIA_PREFIX + "objects/"):
        media = db.get(MediaObject, path.removeprefix(MEDIA_PREFIX + "objects/"))
        return media if media and not media.deleted_at else None
    if path.startswith("/media/") and LOCAL_KEY.fullmatch(path.removeprefix("/media/")):
        return db.scalar(
            select(MediaObject).where(
                MediaObject.storage_key == path.removeprefix("/media/"),
                MediaObject.deleted_at.is_(None),
            )
        )
    return None


def canonical_photo(db: Session, user: User | None, source: str | None) -> str | None:
    if not source:
        return None
    parsed = urlparse(source)
    if (
        len(source) > 8000
        or parsed.scheme not in {"http", "https"}
        or parsed.username
        or parsed.password
    ):
        raise HTTPException(422, "Invalid recipe photo")
    if parsed.netloc == urlparse(settings.public_api_url).netloc and parsed.path.startswith(
        MEDIA_PREFIX
    ):
        if not user:
            raise HTTPException(422, "Private photos require an account")
        parts = parsed.path.removeprefix(MEDIA_PREFIX).split("/")
        if len(parts) != 2:
            raise HTTPException(422, "Invalid recipe photo")
        source = source_for(db, user, parts[0], parts[1])
    media = local_object(db, source)
    if media:
        media = db.scalar(
            select(MediaObject)
            .where(MediaObject.id == media.id)
            .with_for_update()
            .execution_options(populate_existing=True)
        )
        if not media or media.deleted_at:
            raise HTTPException(404, "Photo not found")
        if not user:
            raise HTTPException(422, "Private photos require an account")
        if media.owner_user_id != user.id:
            references = db.scalars(select(Recipe.id).where(Recipe.photo_url == source)).all()
            if not any(allowed_recipe(db, user, value) for value in references):
                raise HTTPException(404, "Photo not found")
        media.claimed_at = datetime.utcnow()
        media.orphaned_at = None
        return object_url(media.id)
    if urlparse(source).netloc == urlparse(settings.public_api_url).netloc:
        legacy_key = urlparse(source).path.removeprefix("/media/")
        match = LOCAL_KEY.fullmatch(legacy_key)
        if match and user:
            references = db.scalars(select(Recipe.id).where(Recipe.photo_url == source)).all()
            if match[1] == user.id or any(allowed_recipe(db, user, value) for value in references):
                return source
        raise HTTPException(422, "Photo unavailable. Upload the photo again.")
    return source


def image_bytes(db: Session, source: str) -> bytes | None:
    media = local_object(db, source)
    if media:
        storage = get_media_storage()
        if media.backend != storage.backend:
            raise HTTPException(503, "Photo storage is unavailable")
        try:
            return normalize_image(storage.read(media.storage_key))
        except (FileNotFoundError, ValueError):
            raise HTTPException(404, "Photo not found") from None
    # Legacy local images stay readable through an authorized recipe until backfilled.
    path = urlparse(source).path.removeprefix("/media/")
    if urlparse(source).netloc == urlparse(settings.public_api_url).netloc and LOCAL_KEY.fullmatch(
        path
    ):
        try:
            return normalize_image(get_media_storage().read(path))
        except (FileNotFoundError, ValueError):
            raise HTTPException(404, "Photo not found") from None
    return None
