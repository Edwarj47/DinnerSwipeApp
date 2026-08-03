from __future__ import annotations

from fastapi import APIRouter

from app.api.deps import CurrentUser, DbDep
from app.schemas.common import HouseholdJoinRequest, HouseholdOut, VoteRequest
from app.services.groups import (
    join_household,
    record_weekly_vote,
    serialize_household,
    vote_summary,
)

router = APIRouter(prefix="/households", tags=["households"])


@router.get("/current", response_model=HouseholdOut)
def get_current_household(db: DbDep, current_user: CurrentUser) -> dict[str, object]:
    return serialize_household(db, current_user)


@router.post("/join", response_model=HouseholdOut)
def join_current_household(
    payload: HouseholdJoinRequest, db: DbDep, current_user: CurrentUser
) -> dict[str, object]:
    return join_household(db, current_user, payload.invite_code)


@router.get("/current/votes")
def current_votes(db: DbDep, current_user: CurrentUser) -> dict[str, object]:
    return vote_summary(db, current_user)


@router.post("/current/votes")
def vote(payload: VoteRequest, db: DbDep, current_user: CurrentUser) -> dict[str, object]:
    return record_weekly_vote(db, current_user, payload.recipe_id, payload.vote)
