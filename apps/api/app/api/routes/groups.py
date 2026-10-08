from __future__ import annotations

from fastapi import APIRouter, Query

from app.api.deps import BasicUser, DbDep, VerifiedBasicUser
from app.core.rate_limit import auth_rate_limiter
from app.schemas.common import (
    HouseholdCreate,
    HouseholdJoinRequest,
    HouseholdOut,
    HouseholdOwnerTransferRequest,
    HouseholdRecipeOptionsOut,
    HouseholdRecipeRequest,
    HouseholdRecipeShareOut,
    HouseholdRecipeShareRequest,
    HouseholdSettingsUpdate,
    HouseholdVoteOptionOut,
    VoteRequest,
)
from app.services.groups import (
    create_household,
    group_recipe_options,
    group_vote_options,
    join_household,
    leave_household,
    list_households,
    preview_invite,
    record_weekly_vote,
    rotate_invite,
    serialize_household,
    set_default_household,
    share_recipe,
    share_recipes,
    switch_household,
    transfer_household_owner,
    update_household_settings,
    vote_summary,
)

router = APIRouter(prefix="/households", tags=["households"])


@router.get("", response_model=list[HouseholdOut])
def get_households(db: DbDep, current_user: BasicUser) -> list[dict[str, object]]:
    return list_households(db, current_user)


@router.post("", response_model=HouseholdOut)
def create_group(
    payload: HouseholdCreate, db: DbDep, current_user: VerifiedBasicUser
) -> dict[str, object]:
    auth_rate_limiter.check(f"groups:create:{current_user.id}", 10, 60)
    return create_household(db, current_user, payload.name)


@router.post("/invite-preview")
def invite_preview(
    payload: HouseholdJoinRequest, db: DbDep, current_user: BasicUser
) -> dict[str, object]:
    auth_rate_limiter.check(f"groups:invite:{current_user.id}", 20, 60)
    return preview_invite(db, payload.invite_code)


@router.post("/{household_id}/switch", response_model=HouseholdOut)
def switch_group(household_id: str, db: DbDep, current_user: BasicUser) -> dict[str, object]:
    return switch_household(db, current_user, household_id)


@router.post("/{household_id}/leave", response_model=HouseholdOut)
def leave_group(household_id: str, db: DbDep, current_user: BasicUser) -> dict[str, object]:
    return leave_household(db, current_user, household_id)


@router.post("/{household_id}/default", response_model=HouseholdOut)
def set_default_group(household_id: str, db: DbDep, current_user: BasicUser) -> dict[str, object]:
    return set_default_household(db, current_user, household_id)


@router.post("/{household_id}/rotate-invite", response_model=HouseholdOut)
def reset_invite(
    household_id: str, db: DbDep, current_user: VerifiedBasicUser
) -> dict[str, object]:
    return rotate_invite(db, current_user, household_id)


@router.post("/{household_id}/recipes")
def add_group_recipe(
    household_id: str, payload: HouseholdRecipeRequest, db: DbDep, current_user: VerifiedBasicUser
) -> dict[str, bool]:
    return share_recipe(db, current_user, household_id, payload.recipe_id)


@router.get("/{household_id}/recipes", response_model=HouseholdRecipeOptionsOut)
def recipe_sharing_options(
    household_id: str,
    db: DbDep,
    current_user: BasicUser,
    q: str = Query(default="", max_length=200),
    limit: int = Query(default=50, ge=1, le=100),
    offset: int = Query(default=0, ge=0),
) -> dict[str, object]:
    return group_recipe_options(db, current_user, household_id, q=q, limit=limit, offset=offset)


@router.post("/{household_id}/recipes/share", response_model=HouseholdRecipeShareOut)
def share_group_recipes(
    household_id: str,
    payload: HouseholdRecipeShareRequest,
    db: DbDep,
    current_user: VerifiedBasicUser,
) -> dict[str, int]:
    auth_rate_limiter.check(f"groups:share:{current_user.id}", 20, 60)
    return share_recipes(db, current_user, household_id, **payload.model_dump())


@router.get("/current", response_model=HouseholdOut)
def get_current_household(db: DbDep, current_user: BasicUser) -> dict[str, object]:
    return serialize_household(db, current_user)


@router.post("/join", response_model=HouseholdOut)
def join_current_household(
    payload: HouseholdJoinRequest, db: DbDep, current_user: VerifiedBasicUser
) -> dict[str, object]:
    auth_rate_limiter.check(f"groups:join:{current_user.id}", 10, 60)
    return join_household(db, current_user, payload.invite_code)


@router.patch("/current/settings", response_model=HouseholdOut)
@router.patch("/{household_id}/settings", response_model=HouseholdOut)
def update_current_household_settings(
    payload: HouseholdSettingsUpdate,
    db: DbDep,
    current_user: VerifiedBasicUser,
    household_id: str | None = None,
) -> dict[str, object]:
    return update_household_settings(
        db,
        current_user,
        payload.allergen_filter_mode,
        payload.dislike_filter_mode,
        household_id,
    )


@router.post("/current/transfer-owner", response_model=HouseholdOut)
@router.post("/{household_id}/transfer-owner", response_model=HouseholdOut)
def transfer_current_household_owner(
    payload: HouseholdOwnerTransferRequest,
    db: DbDep,
    current_user: VerifiedBasicUser,
    household_id: str | None = None,
) -> dict[str, object]:
    return transfer_household_owner(db, current_user, payload.user_id, household_id)


@router.get("/current/vote-options", response_model=list[HouseholdVoteOptionOut])
@router.get("/{household_id}/vote-options", response_model=list[HouseholdVoteOptionOut])
def current_vote_options(
    db: DbDep,
    current_user: BasicUser,
    max_total_minutes: int | None = Query(default=None, ge=0, le=1440),
    limit: int = Query(default=12, ge=1, le=50),
    household_id: str | None = None,
) -> list[dict[str, object]]:
    return group_vote_options(
        db,
        current_user,
        max_total_minutes=max_total_minutes,
        limit=limit,
        household_id=household_id,
    )


@router.get("/current/votes")
@router.get("/{household_id}/votes")
def current_votes(
    db: DbDep, current_user: BasicUser, household_id: str | None = None
) -> dict[str, object]:
    return vote_summary(db, current_user, household_id)


@router.post("/current/votes")
@router.post("/{household_id}/votes")
def vote(
    payload: VoteRequest,
    db: DbDep,
    current_user: VerifiedBasicUser,
    household_id: str | None = None,
) -> dict[str, object]:
    return record_weekly_vote(db, current_user, payload.recipe_id, payload.vote, household_id)
