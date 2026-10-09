from datetime import datetime

from fastapi import HTTPException

from app.models.entities import User

FATSECRET_TERMS_VERSION = "fatsecret-terms-v1"
FATSECRET_TERMS_URL = "https://platform.fatsecret.com/terms"


def consent_status(user: User) -> dict[str, object]:
    return {
        "accepted": bool(
            user.fatsecret_terms_version == FATSECRET_TERMS_VERSION
            and user.fatsecret_terms_accepted_at
        ),
        "terms_version": FATSECRET_TERMS_VERSION,
        "terms_url": FATSECRET_TERMS_URL,
        "accepted_at": user.fatsecret_terms_accepted_at,
    }


def require_nutrition_consent(user: User) -> None:
    if not consent_status(user)["accepted"]:
        raise HTTPException(403, "Accept the database terms in the calculator first.")


def accept_nutrition_terms(user: User, version: str) -> None:
    if version != FATSECRET_TERMS_VERSION:
        raise HTTPException(409, "The database terms changed. Please review them again.")
    if not consent_status(user)["accepted"]:
        user.fatsecret_terms_version = version
        user.fatsecret_terms_accepted_at = datetime.utcnow()
