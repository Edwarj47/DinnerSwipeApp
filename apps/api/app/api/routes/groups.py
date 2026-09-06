from __future__ import annotations

from fastapi import APIRouter, Query

from app.api.deps import BasicUser, DbDep, VerifiedBasicUser
from app.schemas.common import (
    HouseholdJoinRequest,
    HouseholdOut,
    HouseholdOwnerTransferRequest,
    HouseholdSettingsUpdate,
    HouseholdVoteOptionOut,
    VoteRequest,
)
from app.services.groups import (
    group_vote_options,
    join_household,
    record_weekly_vote,
    serialize_household,
    transfer_household_owner,
    update_household_settings,
    vote_summary,
)

router = APIRouter(prefix="/households", tags=["households"])


@router.get("/current", response_model=HouseholdOut)
def get_current_household(db: DbDep, current_user: BasicUser) -> dict[str, object]:
    return serialize_household(db, current_user)


@router.post("/join", response_model=HouseholdOut)
def join_current_household(
    payload: HouseholdJoinRequest, db: DbDep, current_user: VerifiedBasicUser
) -> dict[str, object]:
    return join_household(db, current_user, payload.invite_code)


@router.patch("/current/settings", response_model=HouseholdOut)
def update_current_household_settings(
    payload: HouseholdSettingsUpdate, db: DbDep, current_user: VerifiedBasicUser
) -> dict[str, object]:
    return update_household_settings(
        db,
        current_user,
        payload.allergen_filter_mode,
        payload.dislike_filter_mode,
    )


@router.post("/current/transfer-owner", response_model=HouseholdOut)
def transfer_current_household_owner(
    payload: HouseholdOwnerTransferRequest, db: DbDep, current_user: VerifiedBasicUser
) -> dict[str, object]:
    return transfer_household_owner(db, current_user, payload.user_id)


@router.get("/current/vote-options", response_model=list[HouseholdVoteOptionOut])
def current_vote_options(
    db: DbDep,
    current_user: BasicUser,
    max_total_minutes: int | None = Query(default=None, ge=0, le=1440),
    limit: int = Query(default=12, ge=1, le=50),
) -> list[dict[str, object]]:
    return group_vote_options(db, current_user, max_total_minutes=max_total_minutes, limit=limit)


@router.get("/current/votes")
def current_votes(db: DbDep, current_user: BasicUser) -> dict[str, object]:
    return vote_summary(db, current_user)


@router.post("/current/votes")
def vote(payload: VoteRequest, db: DbDep, current_user: VerifiedBasicUser) -> dict[str, object]:
    return record_weekly_vote(db, current_user, payload.recipe_id, payload.vote)
