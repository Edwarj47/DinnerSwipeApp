from __future__ import annotations

import secrets
import string
from typing import Any

from fastapi import HTTPException
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.models.entities import Household, HouseholdMember, Recipe, User, WeeklyPlan, WeeklyPlanVote
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
        "current_user_role": next(
            (member.role for member, member_user in rows if member_user.id == user.id), "member"
        ),
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
    plan = group_vote_plan(db, user)
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
    household = current_household(db, user)
    plan = group_vote_plan(db, user)
    member_rows = db.execute(
        select(HouseholdMember, User)
        .join(User, User.id == HouseholdMember.user_id)
        .where(HouseholdMember.household_id == household.id)
        .order_by(User.email)
    ).all()
    member_count = len(member_rows)
    is_owner = any(
        member.user_id == user.id and member.role == "owner" for member, _ in member_rows
    )
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
            recipe_id,
            {
                "recipe_id": recipe_id,
                "recipe_name": name,
                "yes": 0,
                "maybe": 0,
                "no": 0,
                "score": 0,
            },
        )
        item[vote] = count
    for item in recipes.values():
        item["score"] = item["yes"] * 2 + item["maybe"] - item["no"] * 2
        item["total_votes"] = item["yes"] + item["maybe"] + item["no"]
        item["majority_vote"] = majority_vote(item)
        item["percentages"] = {
            key: round((int(item[key]) / member_count) * 100)
            for key in ("yes", "maybe", "no")
            if member_count and int(item[key]) > 0
        }
    ranked = sorted(
        recipes.values(),
        key=lambda item: (
            majority_rank(str(item["majority_vote"])),
            int(item["yes"]),
            int(item["score"]),
            int(item["maybe"]),
        ),
        reverse=True,
    )
    if is_owner:
        voter_rows = db.execute(
            select(WeeklyPlanVote.recipe_id, User.email, WeeklyPlanVote.vote)
            .join(User, User.id == WeeklyPlanVote.user_id)
            .join(HouseholdMember, HouseholdMember.user_id == User.id)
            .where(
                WeeklyPlanVote.weekly_plan_id == plan.id,
                HouseholdMember.household_id == household.id,
            )
            .order_by(User.email)
        ).all()
        by_recipe: dict[str, list[dict[str, str]]] = {}
        for recipe_id, email, vote in voter_rows:
            by_recipe.setdefault(recipe_id, []).append({"email": email, "vote": vote})
        for item in ranked:
            item["voters"] = by_recipe.get(str(item["recipe_id"]), [])
    return {
        "weekly_plan_id": plan.id,
        "total_members": member_count,
        "can_view_voters": is_owner,
        "top_match": ranked[0] if ranked else None,
        "votes": ranked,
    }


def group_vote_plan(db: Session, user: User) -> WeeklyPlan:
    household = current_household(db, user)
    owner = db.scalar(
        select(User)
        .join(HouseholdMember, HouseholdMember.user_id == User.id)
        .where(HouseholdMember.household_id == household.id, HouseholdMember.role == "owner")
        .order_by(HouseholdMember.created_at)
    )
    return get_or_create_current_plan(db, owner or user)


def majority_vote(item: dict[str, Any]) -> str:
    yes = int(item["yes"])
    maybe = int(item["maybe"])
    no = int(item["no"])
    if yes > maybe and yes > no:
        return "yes"
    if no > yes and no > maybe:
        return "no"
    if maybe > yes and maybe > no:
        return "maybe"
    return "tied"


def majority_rank(vote: str) -> int:
    return {"yes": 4, "maybe": 3, "tied": 2, "no": 1}.get(vote, 0)
