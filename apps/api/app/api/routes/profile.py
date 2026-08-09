from __future__ import annotations

from datetime import datetime

from fastapi import APIRouter

from app.api.deps import CurrentUser, DbDep
from app.schemas.common import OnboardingUpdate, ProfileUpdate

router = APIRouter(prefix="/profile", tags=["profile"])


@router.get("")
def get_profile(current_user: CurrentUser) -> dict[str, object]:
    profile = current_user.profile
    return {
        "email": current_user.email,
        "household_size": profile.household_size,
        "weekly_meal_target": profile.weekly_meal_target,
        "max_cook_minutes": profile.max_cook_minutes,
        "difficulty_preference": profile.difficulty_preference,
        "dietary_preferences": profile.dietary_preferences,
        "allergens": profile.allergens,
        "disliked_ingredients": profile.disliked_ingredients,
        "favorite_proteins": profile.favorite_proteins,
        "budget_preference": profile.budget_preference,
        "walmart_zip": profile.walmart_zip,
        "notification_preferences": profile.notification_preferences,
        "onboarding_completed_at": profile.onboarding_completed_at,
        "tutorial_completed_at": profile.tutorial_completed_at,
        "tutorial_dismissed_at": profile.tutorial_dismissed_at,
        "tutorial_version_seen": profile.tutorial_version_seen,
    }


@router.put("")
def update_profile(
    payload: ProfileUpdate, db: DbDep, current_user: CurrentUser
) -> dict[str, object]:
    profile = current_user.profile
    for key, value in payload.model_dump().items():
        setattr(profile, key, value)
    db.commit()
    return get_profile(current_user)


@router.patch("/onboarding")
def update_onboarding(
    payload: OnboardingUpdate, db: DbDep, current_user: CurrentUser
) -> dict[str, object]:
    now = datetime.utcnow()
    profile = current_user.profile
    if payload.action == "complete_onboarding":
        profile.onboarding_completed_at = now
        profile.tutorial_version_seen = payload.tutorial_version
    elif payload.action == "complete_tutorial":
        profile.tutorial_completed_at = now
        profile.tutorial_dismissed_at = None
        profile.tutorial_version_seen = payload.tutorial_version
    elif payload.action == "dismiss_tutorial":
        profile.tutorial_dismissed_at = now
        profile.tutorial_version_seen = payload.tutorial_version
    db.commit()
    return get_profile(current_user)
