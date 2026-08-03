from __future__ import annotations

import secrets
import string
from typing import Any

from fastapi import HTTPException
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.models.entities import Household, HouseholdMember, Recipe, User, WeeklyPlanVote
from app.services.recipes import get_or_create_current_plan

ALPHABET = string.ascii_uppercase + string.digits


def generate_invite_code(db: Session) -> str:
    for _ in range(20):
        code = "".join(secrets.choice(ALPHABET) for _ in range(8))
        if not db.scalar(select(Household).where(Household.invite_code == code)):
            return code
    raise RuntimeError("Could not allocate household invite code")


def ensure_invite_code(db: Session, household: Household) -> str:
    if not household.invite_code:
        household.invite_code = generate_invite_code(db)
        db.commit()
        db.refresh(household)
    return household.invite_code


def current_household(db: Session, user: User) -> Household:
    household_id = user.profile.household_id if user.profile else None
    if not household_id:
        raise HTTPException(status_code=404, detail="Household not found")
    household = db.get(Household, household_id)
    if not household:
        raise HTTPException(status_code=404, detail="Household not found")
    return household


def serialize_household(db: Session, user: User) -> dict[str, Any]:
    household = current_household(db, user)
    invite_code = ensure_invite_code(db, household)
    rows = db.execute(
        select(HouseholdMember, User)
        .join(User, User.id == HouseholdMember.user_id)
        .where(HouseholdMember.household_id == household.id)
        .order_by(HouseholdMember.created_at)
    ).all()
    return {
        "id": household.id,
        "name": household.name,
        "invite_code": invite_code,
        "members": [
            {"id": member.user_id, "email": member_user.email, "role": member.role}
            for member, member_user in rows
        ],
    }


def join_household(db: Session, user: User, invite_code: str) -> dict[str, Any]:
    household = db.scalar(select(Household).where(Household.invite_code == invite_code.upper()))
    if not household:
        raise HTTPException(status_code=404, detail="Invite code not found")
    existing = db.scalar(
        select(HouseholdMember).where(
            HouseholdMember.household_id == household.id, HouseholdMember.user_id == user.id
        )
    )
    if not existing:
        db.add(HouseholdMember(household_id=household.id, user_id=user.id, role="member"))
    if user.profile:
        user.profile.household_id = household.id
    db.commit()
    return serialize_household(db, user)


def record_weekly_vote(db: Session, user: User, recipe_id: str, vote: str) -> dict[str, Any]:
    plan = get_or_create_current_plan(db, user)
    recipe = db.get(Recipe, recipe_id)
    household_id = user.profile.household_id if user.profile else None
    if not recipe or recipe.archived_at is not None:
        raise HTTPException(status_code=404, detail="Recipe not found")
    if recipe.household_id and recipe.household_id != household_id:
        raise HTTPException(status_code=404, detail="Recipe not found")
    row = db.scalar(
        select(WeeklyPlanVote).where(
            WeeklyPlanVote.weekly_plan_id == plan.id,
            WeeklyPlanVote.user_id == user.id,
            WeeklyPlanVote.recipe_id == recipe_id,
        )
    )
    if row:
        row.vote = vote
    else:
        db.add(
            WeeklyPlanVote(weekly_plan_id=plan.id, user_id=user.id, recipe_id=recipe_id, vote=vote)
        )
    db.commit()
    return vote_summary(db, user)


def vote_summary(db: Session, user: User) -> dict[str, Any]:
    plan = get_or_create_current_plan(db, user)
    rows = db.execute(
        select(
            WeeklyPlanVote.recipe_id,
            Recipe.name,
            WeeklyPlanVote.vote,
            func.count(WeeklyPlanVote.id),
        )
        .join(Recipe, Recipe.id == WeeklyPlanVote.recipe_id)
        .where(WeeklyPlanVote.weekly_plan_id == plan.id)
        .group_by(WeeklyPlanVote.recipe_id, Recipe.name, WeeklyPlanVote.vote)
        .order_by(Recipe.name)
    ).all()
    recipes: dict[str, dict[str, Any]] = {}
    for recipe_id, name, vote, count in rows:
        item = recipes.setdefault(
            recipe_id, {"recipe_id": recipe_id, "recipe_name": name, "yes": 0, "maybe": 0, "no": 0}
        )
        item[vote] = count
    return {"weekly_plan_id": plan.id, "votes": list(recipes.values())}
