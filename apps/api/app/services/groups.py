from __future__ import annotations

import secrets
import string
from typing import Any

from fastapi import HTTPException
from sqlalchemy import Select, func, or_, select
from sqlalchemy.orm import Session

from app.models.entities import (
    Household,
    HouseholdMember,
    HouseholdRecipe,
    HouseholdVote,
    Recipe,
    User,
    UserProfile,
    WeeklyPlan,
)
from app.services.billing import is_premium_active, subscription_for_user
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


def current_household(db: Session, user: User, household_id: str | None = None) -> Household:
    if household_id == "current":
        household_id = None
    household_id = household_id or (user.profile.household_id if user.profile else None)
    if not household_id:
        raise HTTPException(status_code=404, detail="Household not found")
    household = db.get(Household, household_id)
    if not household or not current_member(db, user, household):
        raise HTTPException(status_code=404, detail="Household not found")
    return household


def serialize_household(db: Session, user: User, household_id: str | None = None) -> dict[str, Any]:
    household = current_household(db, user, household_id)
    member = current_member(db, user, household)
    invite_code = (
        ensure_invite_code(db, household)
        if not household.is_personal and member and member.role == "owner"
        else ""
    )
    rows = db.execute(
        select(HouseholdMember, User)
        .join(User, User.id == HouseholdMember.user_id)
        .where(HouseholdMember.household_id == household.id)
        .order_by(HouseholdMember.created_at)
    ).all()
    return {
        "id": household.id,
        "name": household.name,
        "is_personal": household.is_personal,
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


def list_households(db: Session, user: User) -> list[dict[str, Any]]:
    ids = db.scalars(
        select(Household.id)
        .join(HouseholdMember)
        .where(HouseholdMember.user_id == user.id)
        .order_by(Household.is_personal.desc(), Household.created_at)
    ).all()
    return [serialize_household(db, user, household_id) for household_id in ids]


def require_group_capacity(db: Session, user: User) -> None:
    # Serialize concurrent create/join requests for this user before counting memberships.
    db.scalar(select(User).where(User.id == user.id).with_for_update())
    count = (
        db.scalar(
            select(func.count())
            .select_from(HouseholdMember)
            .join(Household)
            .where(HouseholdMember.user_id == user.id, Household.is_personal.is_(False))
        )
        or 0
    )
    if count and not is_premium_active(subscription_for_user(db, user)):
        raise HTTPException(
            status_code=403,
            detail=(
                "Basic includes one shared group. Upgrade to Premium to create or join more groups."
            ),
        )


def create_household(db: Session, user: User, name: str) -> dict[str, Any]:
    name = name.strip()
    if not name:
        raise HTTPException(status_code=422, detail="Enter a group name.")
    require_group_capacity(db, user)
    household = Household(name=name, invite_code=generate_invite_code(db))
    db.add(household)
    db.flush()
    db.add(HouseholdMember(household_id=household.id, user_id=user.id, role="owner"))
    user.profile.household_id = household.id
    db.commit()
    return serialize_household(db, user)


def switch_household(db: Session, user: User, household_id: str) -> dict[str, Any]:
    household = current_household(db, user, household_id)
    user.profile.household_id = household.id
    db.commit()
    return serialize_household(db, user)


def leave_household(db: Session, user: User, household_id: str) -> dict[str, Any]:
    db.scalar(select(User).where(User.id == user.id).with_for_update())
    household = current_household(db, user, household_id)
    db.scalar(select(Household).where(Household.id == household.id).with_for_update())
    if household.is_personal:
        raise HTTPException(status_code=400, detail="Your private kitchen stays with your account.")
    member = current_member(db, user, household)
    assert member is not None
    count = (
        db.scalar(
            select(func.count())
            .select_from(HouseholdMember)
            .where(HouseholdMember.household_id == household.id)
        )
        or 0
    )
    if member.role == "owner" and count > 1:
        raise HTTPException(status_code=409, detail="Transfer ownership before leaving this group.")
    kitchen = db.scalar(
        select(Household)
        .join(HouseholdMember)
        .where(HouseholdMember.user_id == user.id, Household.is_personal.is_(True))
    )
    if not kitchen:
        raise HTTPException(
            status_code=409, detail="Your private kitchen is unavailable. Try again."
        )
    db.delete(member)
    if count == 1:
        household.invite_code = None
    if user.profile.household_id == household.id:
        user.profile.household_id = kitchen.id
    db.commit()
    return serialize_household(db, user)


def preview_invite(db: Session, invite_code: str) -> dict[str, Any]:
    household = find_invited_household(db, invite_code)
    count = db.scalar(
        select(func.count())
        .select_from(HouseholdMember)
        .where(HouseholdMember.household_id == household.id)
    )
    return {"id": household.id, "name": household.name, "member_count": count}


def find_invited_household(db: Session, invite_code: str, *, lock: bool = False) -> Household:
    query = select(Household).where(
        Household.invite_code == invite_code.strip().upper(), Household.is_personal.is_(False)
    )
    household = db.scalar(query.with_for_update() if lock else query)
    if not household:
        raise HTTPException(
            status_code=404,
            detail="This invitation is no longer available. Ask the owner for a new one.",
        )
    return household


def rotate_invite(db: Session, user: User, household_id: str) -> dict[str, Any]:
    household = current_household(db, user, household_id)
    db.scalar(select(Household).where(Household.id == household.id).with_for_update())
    require_owner(db, user, household)
    if household.is_personal:
        raise HTTPException(status_code=400, detail="Create a shared group to invite people.")
    household.invite_code = generate_invite_code(db)
    db.commit()
    return serialize_household(db, user, household.id)


def own_shareable_recipes(user: User, q: str = "") -> Select[tuple[Recipe]]:
    query = accessible_recipes_query(user).where(Recipe.owner_user_id == user.id).order_by(None)
    if q.strip():
        query = query.where(Recipe.name.icontains(q.strip(), autoescape=True))
    return query


def group_recipe_options(
    db: Session,
    user: User,
    household_id: str,
    *,
    q: str = "",
    limit: int = 50,
    offset: int = 0,
) -> dict[str, Any]:
    household = current_household(db, user, household_id)
    if household.is_personal:
        raise HTTPException(
            status_code=404, detail="Choose one of your own recipes and a shared group."
        )
    query = own_shareable_recipes(user, q)
    already_shared = or_(
        Recipe.household_id == household.id,
        Recipe.id.in_(
            select(HouseholdRecipe.recipe_id).where(HouseholdRecipe.household_id == household.id)
        ),
    )
    total = db.scalar(select(func.count()).select_from(query.subquery())) or 0
    shared_count = (
        db.scalar(select(func.count()).select_from(query.where(already_shared).subquery())) or 0
    )
    recipes = (
        db.scalars(query.order_by(func.lower(Recipe.name), Recipe.id).limit(limit).offset(offset))
        .unique()
        .all()
    )
    shared_ids = set(
        db.scalars(
            select(HouseholdRecipe.recipe_id).where(
                HouseholdRecipe.household_id == household.id,
                HouseholdRecipe.recipe_id.in_([recipe.id for recipe in recipes]),
            )
        )
    )
    return {
        "items": [
            {
                "recipe": serialize_recipe(recipe, user.id, db),
                "is_shared": recipe.household_id == household.id or recipe.id in shared_ids,
            }
            for recipe in recipes
        ],
        "total": total,
        "shared_count": shared_count,
    }


def share_recipes(
    db: Session,
    user: User,
    household_id: str,
    *,
    recipe_ids: list[str],
    select_all: bool = False,
    excluded_recipe_ids: list[str] | None = None,
    q: str = "",
) -> dict[str, int]:
    # Shares and membership changes lock the same group. Recheck membership under
    # that lock, and lock source recipes in a stable order before committing once.
    target_id = household_id
    if household_id == "current":
        if not user.profile or not user.profile.household_id:
            raise HTTPException(status_code=404, detail="Choose a shared group.")
        target_id = user.profile.household_id
    household = db.scalar(select(Household).where(Household.id == target_id).with_for_update())
    if not household or household.is_personal or not current_member(db, user, household):
        raise HTTPException(
            status_code=404, detail="Choose one of your own recipes and a shared group."
        )
    query = own_shareable_recipes(user, q if select_all else "")
    selected_ids = set(recipe_ids)
    if select_all:
        if excluded_recipe_ids:
            query = query.where(Recipe.id.not_in(excluded_recipe_ids))
    else:
        query = query.where(Recipe.id.in_(selected_ids))
    recipes = db.scalars(query.order_by(Recipe.id).with_for_update()).unique().all()
    if not select_all and (not selected_ids or len(recipes) != len(selected_ids)):
        raise HTTPException(status_code=404, detail="One or more recipes are unavailable to share.")
    shared_ids = set(
        db.scalars(
            select(HouseholdRecipe.recipe_id).where(
                HouseholdRecipe.household_id == household.id,
                HouseholdRecipe.recipe_id.in_([recipe.id for recipe in recipes]),
            )
        )
    )
    already_shared_count = 0
    for recipe in recipes:
        if recipe.household_id == household.id or recipe.id in shared_ids:
            already_shared_count += 1
        else:
            db.add(HouseholdRecipe(household_id=household.id, recipe_id=recipe.id))
    db.commit()
    return {
        "shared_count": len(recipes) - already_shared_count,
        "already_shared_count": already_shared_count,
        "recipe_count": len(recipes),
    }


def share_recipe(db: Session, user: User, household_id: str, recipe_id: str) -> dict[str, bool]:
    share_recipes(db, user, household_id, recipe_ids=[recipe_id])
    return {"shared": True}


def join_household(db: Session, user: User, invite_code: str) -> dict[str, Any]:
    db.scalar(select(User).where(User.id == user.id).with_for_update())
    household = find_invited_household(db, invite_code, lock=True)
    existing = db.scalar(
        select(HouseholdMember).where(
            HouseholdMember.household_id == household.id, HouseholdMember.user_id == user.id
        )
    )
    if not existing:
        require_group_capacity(db, user)
        db.add(HouseholdMember(household_id=household.id, user_id=user.id, role="member"))
    if user.profile:
        user.profile.household_id = household.id
    db.commit()
    return serialize_household(db, user)


def update_household_settings(
    db: Session,
    user: User,
    allergen_filter_mode: str,
    dislike_filter_mode: str,
    household_id: str | None = None,
) -> dict[str, Any]:
    household = current_household(db, user, household_id)
    db.scalar(select(Household).where(Household.id == household.id).with_for_update())
    require_owner(db, user, household)
    if allergen_filter_mode not in SAFETY_MODES or dislike_filter_mode not in SAFETY_MODES:
        raise HTTPException(status_code=422, detail="Unsupported household safety mode")
    household.allergen_filter_mode = allergen_filter_mode
    household.dislike_filter_mode = dislike_filter_mode
    db.commit()
    db.refresh(household)
    return serialize_household(db, user, household.id)


def transfer_household_owner(
    db: Session, user: User, target_user_id: str, household_id: str | None = None
) -> dict[str, Any]:
    household = current_household(db, user, household_id)
    db.scalar(select(Household).where(Household.id == household.id).with_for_update())
    current = require_owner(db, user, household)
    target = db.scalar(
        select(HouseholdMember).where(
            HouseholdMember.household_id == household.id, HouseholdMember.user_id == target_user_id
        )
    )
    if not target:
        raise HTTPException(status_code=404, detail="Target member not found in this group")
    if target.user_id == user.id:
        return serialize_household(db, user, household.id)
    target.role = "owner"
    current.role = "member"
    db.commit()
    return serialize_household(db, user, household.id)


def group_vote_options(
    db: Session,
    user: User,
    max_total_minutes: int | None = None,
    limit: int = 12,
    household_id: str | None = None,
) -> list[dict[str, Any]]:
    household = current_household(db, user, household_id)
    preferences = household_preference_terms(db, household)
    query = group_recipes_query(user, household)
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
        if len(options) >= limit:
            break
    return options


def record_weekly_vote(
    db: Session, user: User, recipe_id: str, vote: str, household_id: str | None = None
) -> dict[str, Any]:
    household = current_household(db, user, household_id)
    plan = group_vote_plan(db, user, household.id)
    recipe = db.scalar(group_recipes_query(user, household).where(Recipe.id == recipe_id))
    if not recipe:
        raise HTTPException(status_code=404, detail="Recipe not found")
    safety = recipe_group_safety(household, recipe, household_preference_terms(db, household))
    if safety["is_blocked"]:
        raise HTTPException(
            status_code=400,
            detail="This recipe is blocked by the group's allergy or dislike settings.",
        )
    db.scalar(select(User).where(User.id == user.id).with_for_update())
    row = db.scalar(
        select(HouseholdVote).where(
            HouseholdVote.household_id == household.id,
            HouseholdVote.week_start == plan.week_start,
            HouseholdVote.user_id == user.id,
            HouseholdVote.recipe_id == recipe_id,
        )
    )
    if row:
        row.vote = vote
    else:
        db.add(
            HouseholdVote(
                household_id=household.id,
                week_start=plan.week_start,
                user_id=user.id,
                recipe_id=recipe_id,
                vote=vote,
            )
        )
    db.commit()
    return vote_summary(db, user, household.id)


def vote_summary(db: Session, user: User, household_id: str | None = None) -> dict[str, Any]:
    household = current_household(db, user, household_id)
    plan = group_vote_plan(db, user, household.id)
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
            HouseholdVote.recipe_id,
            Recipe.name,
            HouseholdVote.vote,
            func.count(HouseholdVote.id),
        )
        .join(Recipe, Recipe.id == HouseholdVote.recipe_id)
        .where(
            HouseholdVote.household_id == household.id,
            HouseholdVote.week_start == plan.week_start,
            HouseholdVote.user_id.in_([member.user_id for member, _ in member_rows]),
        )
        .group_by(HouseholdVote.recipe_id, Recipe.name, HouseholdVote.vote)
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
            select(HouseholdVote.recipe_id, User.email, HouseholdVote.vote)
            .join(User, User.id == HouseholdVote.user_id)
            .join(HouseholdMember, HouseholdMember.user_id == User.id)
            .where(
                HouseholdVote.household_id == household.id,
                HouseholdVote.week_start == plan.week_start,
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
        "household_id": household.id,
        "weekly_plan_id": plan.id,
        "total_members": member_count,
        "can_view_voters": is_owner,
        "top_match": ranked[0] if ranked else None,
        "votes": ranked,
    }


def group_vote_plan(db: Session, user: User, household_id: str | None = None) -> WeeklyPlan:
    household = current_household(db, user, household_id)
    owner = db.scalar(
        select(User)
        .join(HouseholdMember, HouseholdMember.user_id == User.id)
        .where(HouseholdMember.household_id == household.id, HouseholdMember.role == "owner")
        .order_by(HouseholdMember.created_at)
    )
    return get_or_create_current_plan(db, owner or user)


def group_recipes_query(user: User, household: Household) -> Select[tuple[Recipe]]:
    if household.is_personal:
        return accessible_recipes_query(user, household.id)
    return accessible_recipes_query(user, household.id).where(
        Recipe.owner_user_id.is_(None)
        | (Recipe.household_id == household.id)
        | Recipe.id.in_(
            select(HouseholdRecipe.recipe_id).where(HouseholdRecipe.household_id == household.id)
        )
    )


def current_member(db: Session, user: User, household: Household) -> HouseholdMember | None:
    return db.scalar(
        select(HouseholdMember)
        .where(HouseholdMember.household_id == household.id, HouseholdMember.user_id == user.id)
        .execution_options(populate_existing=True)
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
