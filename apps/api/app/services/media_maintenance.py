from __future__ import annotations

from datetime import datetime, timedelta
from pathlib import Path

from sqlalchemy import or_, select
from sqlalchemy.orm import Session

from app.core.config import settings
from app.models.entities import Recipe, UrlIngestionCandidate, User
from app.models.security import MediaObject
from app.services.media_storage import get_media_storage
from app.services.private_media import LOCAL_KEY, object_url


def referenced(db: Session, media: MediaObject) -> bool:
    prefixes = [
        object_url(media.id),
        f"{settings.public_api_url.rstrip('/')}/media/{media.storage_key}",
    ]
    if db.scalar(
        select(Recipe.id)
        .where(
            or_(
                *[
                    field.startswith(prefix)
                    for field in (Recipe.photo_url, Recipe.photo_source_url)
                    for prefix in prefixes
                ]
            )
        )
        .limit(1)
    ):
        return True
    return bool(
        db.scalar(
            select(UrlIngestionCandidate.id)
            .where(
                or_(
                    *[
                        UrlIngestionCandidate.extracted_data["photo_url"]
                        .as_string()
                        .startswith(prefix)
                        for prefix in prefixes
                    ]
                )
            )
            .limit(1)
        )
    )


def backfill_local_media(db: Session) -> dict[str, int]:
    """Inventory existing media without renaming URLs or enabling legacy deletion."""
    result = {"indexed": 0, "skipped": 0}
    root = Path(settings.image_storage_path).resolve()
    for path in (root / "uploads").glob("*/*"):
        if path.is_symlink() or not path.is_file() or not path.resolve().is_relative_to(root):
            result["skipped"] += 1
            continue
        key = path.relative_to(root).as_posix()
        match = LOCAL_KEY.fullmatch(key)
        if not match or not db.get(User, match[1]):
            result["skipped"] += 1
            continue
        if db.scalar(select(MediaObject.id).where(MediaObject.storage_key == key)):
            continue
        stat = path.stat()
        media = MediaObject(
            owner_user_id=match[1],
            storage_key=key,
            backend="local",
            content_type={"jpg": "image/jpeg", "png": "image/png", "webp": "image/webp"}[match[3]],
            size_bytes=stat.st_size,
            created_at=datetime.utcfromtimestamp(stat.st_mtime),
            managed=False,
        )
        db.add(media)
        db.flush()
        if referenced(db, media):
            media.claimed_at = datetime.utcnow()
        result["indexed"] += 1
    db.commit()
    return result


def cleanup_media(db: Session) -> int:
    if not settings.media_cleanup_enabled:
        return 0
    cutoff = datetime.utcnow() - timedelta(hours=24)
    deleted = 0
    storage = get_media_storage()
    cursor = ""
    while True:
        rows = list(
            db.scalars(
                select(MediaObject)
                .where(
                    MediaObject.managed.is_(True),
                    MediaObject.deleted_at.is_(None),
                    MediaObject.created_at < cutoff,
                    MediaObject.id > cursor,
                )
                .order_by(MediaObject.id)
                .limit(100)
                .with_for_update(skip_locked=True)
            )
        )
        if not rows:
            break
        cursor = rows[-1].id
        for media in rows:
            if referenced(db, media):
                media.orphaned_at = None
            elif media.orphaned_at is None:
                media.orphaned_at = (
                    media.created_at if media.claimed_at is None else datetime.utcnow()
                )
            elif media.orphaned_at < cutoff and media.backend == storage.backend:
                storage.delete(media.storage_key)
                media.deleted_at = datetime.utcnow()
                deleted += 1
        db.commit()
    return deleted
