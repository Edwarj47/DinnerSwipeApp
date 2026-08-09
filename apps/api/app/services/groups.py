from __future__ import annotations

import secrets
import string
from typing import Any

from fastapi import HTTPException
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.models.entities import (
    Household,
    HouseholdMember,
    Recipe,
    User,
    UserProfile,
    WeeklyPlan,
    WeeklyPlanVote,
)
from app.services.parsing import normalize_name
from app.services.recipes import (
    accessible_recipes_query,
    get_or_create_current_plan,
    serialize_recipe,
)

ALPHABET = string.ascii_uppercase + string.digits
SAFETY_MODES = {"off", "warn", "block"}


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
        "allergen_filter_mode": household.allergen_filter_mode,
        "dislike_filter_mode": household.dislike_filter_mode,
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


def update_household_settings(
    db: Session, user: User, allergen_filter_mode: str, dislike_filter_mode: str
) -> dict[str, Any]:
    household = current_household(db, user)
    require_owner(db, user, household)
    if allergen_filter_mode not in SAFETY_MODES or dislike_filter_mode not in SAFETY_MODES:
        raise HTTPException(status_code=422, detail="Unsupported household safety mode")
    household.allergen_filter_mode = allergen_filter_mode
    household.dislike_filter_mode = dislike_filter_mode
    db.commit()
    db.refresh(household)
    return serialize_household(db, user)


def transfer_household_owner(db: Session, user: User, target_user_id: str) -> dict[str, Any]:
    household = current_household(db, user)
    current = require_owner(db, user, household)
    target = db.scalar(
        select(HouseholdMember).where(
            HouseholdMember.household_id == household.id, HouseholdMember.user_id == target_user_id
        )
    )
    if not target:
        raise HTTPException(status_code=404, detail="Target member not found in this group")
    if target.user_id == user.id:
        return serialize_household(db, user)
    target.role = "owner"
    current.role = "member"
    db.commit()
    return serialize_household(db, user)


def group_vote_options(
    db: Session, user: User, max_total_minutes: int | None = None, limit: int = 12
) -> list[dict[str, Any]]:
    household = current_household(db, user)
    preferences = household_preference_terms(db, household)
    query = accessible_recipes_query(user).limit(max(1, min(limit, 50)))
    if max_total_minutes is not None:
        query = query.where(
            Recipe.total_minutes.is_(None) | (Recipe.total_minutes <= max_total_minutes)
        )
    rows = db.scalars(query).all()
    options: list[dict[str, Any]] = []
    for recipe in rows:
        safety = recipe_group_safety(household, recipe, preferences)
        if safety["is_blocked"]:
            continue
        options.append({"recipe": serialize_recipe(recipe, user.id, db), **safety})
    return options


def record_weekly_vote(db: Session, user: User, recipe_id: str, vote: str) -> dict[str, Any]:
    plan = group_vote_plan(db, user)
    recipe = db.get(Recipe, recipe_id)
    household = current_household(db, user)
    household_id = user.profile.household_id if user.profile else None
    if not recipe or recipe.archived_at is not None:
        raise HTTPException(status_code=404, detail="Recipe not found")
    if recipe.household_id and recipe.household_id != household_id:
        raise HTTPException(status_code=404, detail="Recipe not found")
    safety = recipe_group_safety(household, recipe, household_preference_terms(db, household))
    if safety["is_blocked"]:
        raise HTTPException(
            status_code=400,
            detail="This recipe is blocked by the group's allergy or dislike settings.",
        )
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


def current_member(db: Session, user: User, household: Household) -> HouseholdMember | None:
    return db.scalar(
        select(HouseholdMember).where(
            HouseholdMember.household_id == household.id, HouseholdMember.user_id == user.id
        )
    )


def require_owner(db: Session, user: User, household: Household) -> HouseholdMember:
    member = current_member(db, user, household)
    if not member or member.role != "owner":
        raise HTTPException(status_code=403, detail="Only a group owner can change this setting")
    return member


def household_preference_terms(db: Session, household: Household) -> dict[str, set[str]]:
    profiles = db.scalars(
        select(UserProfile)
        .join(HouseholdMember, HouseholdMember.user_id == UserProfile.user_id)
        .where(HouseholdMember.household_id == household.id)
    ).all()
    allergens: set[str] = set()
    dislikes: set[str] = set()
    for profile in profiles:
        allergens.update(clean_preference_terms(profile.allergens or []))
        dislikes.update(clean_preference_terms(profile.disliked_ingredients or []))
    return {"allergens": allergens, "dislikes": dislikes}


def clean_preference_terms(values: list[str]) -> set[str]:
    terms: set[str] = set()
    for value in values:
        normalized = normalize_name(str(value))
        if len(normalized) >= 3:
            terms.add(normalized)
    return terms


def recipe_group_safety(
    household: Household, recipe: Recipe, preferences: dict[str, set[str]]
) -> dict[str, Any]:
    ingredient_texts = recipe_ingredient_texts(recipe)
    allergy_matches = matching_terms(preferences["allergens"], ingredient_texts)
    dislike_matches = matching_terms(preferences["dislikes"], ingredient_texts)
    blocked_labels: list[str] = []
    warning_labels: list[str] = []
    safety_notes: list[str] = []
    apply_matches(
        allergy_matches,
        mode=household.allergen_filter_mode,
        prefix="Allergy",
        blocked_labels=blocked_labels,
        warning_labels=warning_labels,
    )
    apply_matches(
        dislike_matches,
        mode=household.dislike_filter_mode,
        prefix="Dislike",
        blocked_labels=blocked_labels,
        warning_labels=warning_labels,
    )
    if blocked_labels:
        safety_notes.append("Hidden because group owner safety settings block matching items.")
    if warning_labels:
        safety_notes.append("Review ingredients before voting because a group preference matched.")
    return {
        "is_blocked": bool(blocked_labels),
        "warning_labels": warning_labels,
        "blocked_labels": blocked_labels,
        "safety_notes": safety_notes,
    }


def apply_matches(
    matches: set[str],
    *,
    mode: str,
    prefix: str,
    blocked_labels: list[str],
    warning_labels: list[str],
) -> None:
    if mode == "off":
        return
    labels = [f"{prefix}: {term}" for term in sorted(matches)]
    if mode == "block":
        blocked_labels.extend(labels)
    else:
        warning_labels.extend(labels)


def recipe_ingredient_texts(recipe: Recipe) -> set[str]:
    texts: set[str] = set()
    for ingredient in recipe.ingredients:
        normalized = normalize_name(ingredient.normalized_name or "")
        original = normalize_name(ingredient.original_text or "")
        if normalized:
            texts.add(normalized)
        if original:
            texts.add(original)
    return texts


def matching_terms(preferences: set[str], ingredient_texts: set[str]) -> set[str]:
    matches: set[str] = set()
    for preference in preferences:
        for ingredient_text in ingredient_texts:
            if preference in ingredient_text or ingredient_text in preference:
                matches.add(preference)
                break
    return matches


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
