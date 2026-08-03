from __future__ import annotations

from fastapi import APIRouter

from app.api.deps import CurrentUser, DbDep
from app.schemas.common import ProfileUpdate

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
