"""Server-controlled private pilot; never grant access through editable profile values."""

from fastapi import HTTPException

from app.core.config import settings


def enabled_for(user_id: str) -> bool:
    owner = settings.content_automation_owner_user_id
    return owner is not None and str(owner) == user_id


def require_owner(user_id: str) -> None:
    if not enabled_for(user_id):
        raise HTTPException(404, "Not found")
