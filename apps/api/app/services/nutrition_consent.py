from datetime import datetime

from fastapi import HTTPException

from app.core.config import settings
from app.models.entities import User

# Reuse the per-account fields for the combined OpenAI/fatsecret tools agreement.
FATSECRET_TERMS_VERSION = "fatsecret-terms-v2"
FATSECRET_TERMS_URL = "https://platform.fatsecret.com/terms"
NUTRITION_DISCLOSURE = (
    "Meal AI sends your description or completed voice recording to OpenAI. Food searches go "
    "to fatsecret. Their data-processing and retention policies apply. Review the result "
    "before saving. By continuing, you agree to Dinner Swipe and fatsecret's terms and "
    "acknowledge the Privacy Policy for this processing. Your agreement is saved to your "
    "account for this revision and covers both the calculator and meal AI. Meal AI and "
    "voice are optional."
)


def consent_status(user: User) -> dict[str, object]:
    return {
        "accepted": bool(
            user.fatsecret_terms_version == FATSECRET_TERMS_VERSION
            and user.fatsecret_terms_accepted_at
        ),
        "terms_version": FATSECRET_TERMS_VERSION,
        "terms_url": FATSECRET_TERMS_URL,
        "disclosure": NUTRITION_DISCLOSURE,
        "app_terms_url": f"{settings.app_public_url.rstrip('/')}/terms",
        "privacy_url": f"{settings.app_public_url.rstrip('/')}/privacy",
        "accepted_at": user.fatsecret_terms_accepted_at,
    }


def require_nutrition_consent(user: User) -> None:
    if not consent_status(user)["accepted"]:
        raise HTTPException(403, "Review and accept the nutrition tools agreement first.")


def accept_nutrition_terms(user: User, version: str) -> None:
    if version != FATSECRET_TERMS_VERSION:
        raise HTTPException(409, "The nutrition tools agreement changed. Please review it again.")
    if not consent_status(user)["accepted"]:
        user.fatsecret_terms_version = version
        user.fatsecret_terms_accepted_at = datetime.utcnow()
