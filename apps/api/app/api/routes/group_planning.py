from __future__ import annotations

from datetime import date, timedelta
from typing import Any, Literal

from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel, Field
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.api.deps import BasicUser, DbDep
from app.models.entities import (
    Household,
    HouseholdDiscoverChoice,
    HouseholdMember,
    HouseholdVote,
    MealProposal,
    MealProposalMember,
    Recipe,
    User,
    WeeklyPlan,
    WeeklyPlanSlot,
)
from app.schemas.common import (
    WeeklyPlanningUpdate,
    WeeklyPlanReorder,
    WeeklyPlanReset,
    WeeklySlotCreate,
    WeeklySlotUpdate,
)
from app.services import group_planning as service
from app.services.groups import household_preference_terms, recipe_group_safety
from app.services.recipes import regenerate_grocery_list, serialize_plan, serialize_recipe

router = APIRouter(prefix="/households/{household_id}", tags=["group-planning"])
reminder_router = APIRouter(prefix="/households", tags=["group-planning"])


class ChoiceUpdate(BaseModel):
    enable_ids: list[str] = Field(default_factory=list, max_length=500)
    disable_ids: list[str] = Field(default_factory=list, max_length=500)
    bulk_action: Literal["enable", "disable"] | None = None
    q: str = Field(default="", max_length=200)


class ProposalCreate(BaseModel):
    recipe_id: str


class ProposalDecision(BaseModel):
    action: Literal["approve", "decline"]
    slot_date: date | None = None
    servings: int = Field(default=1, ge=1, le=30)


class ProposalVote(BaseModel):
    vote: Literal["yes", "maybe", "no"]


class ReminderUpdate(BaseModel):
    notify: bool


@reminder_router.get("/planning-reminders")
def reminders(db: DbDep, current_user: BasicUser) -> list[dict[str, Any]]:
    preferences = reminder_preferences(current_user)
    groups = db.scalars(
        select(Household)
        .join(HouseholdMember)
        .where(HouseholdMember.user_id == current_user.id, Household.is_personal.is_(False))
    ).all()
    return [
        {
            "id": group.id,
            "name": group.name,
            "settings": service.settings(group)
            | {"notify": service.settings(group)["notify"] and preferences.get(group.id, True)},
        }
        for group in groups
    ]


@router.patch("/planning-reminder")
def save_reminder(
    household_id: str, payload: ReminderUpdate, db: DbDep, current_user: BasicUser
) -> dict[str, bool]:
    from app.models.entities import User, UserProfile

    db.execute(select(User.id).where(User.id == current_user.id).with_for_update()).one()
    service.authorize(db, current_user, household_id)
    profile = db.scalar(
        select(UserProfile)
        .where(UserProfile.user_id == current_user.id)
        .with_for_update()
        .execution_options(populate_existing=True)
    )
    if not profile:
        raise HTTPException(404, "Profile not found")
    preferences = dict(profile.notification_preferences or {})
    preferences["group_planning_reminders"] = reminder_preferences(current_user) | {
        household_id: payload.notify
    }
    profile.notification_preferences = preferences
    db.commit()
    return {"notify": payload.notify}


def reminder_preferences(user: User) -> dict[str, bool]:
    stored = (
        (user.profile.notification_preferences or {}).get("group_planning_reminders", {})
        if user.profile
        else {}
    )
    return (
        {str(key): bool(value) for key, value in stored.items()} if isinstance(stored, dict) else {}
    )


@router.get("/library")
def library(
    household_id: str,
    db: DbDep,
    current_user: BasicUser,
    q: str = Query(default="", max_length=200),
    limit: int = Query(default=50, ge=1, le=100),
    offset: int = Query(default=0, ge=0),
    discover: bool = False,
) -> dict[str, Any]:
    group = service.authorize(db, current_user, household_id)
    query = service.library_query(household_id)
    if q.strip():
        query = query.where(Recipe.name.ilike(f"%{q.strip()}%"))
    enabled = set(
        db.scalars(
            select(HouseholdDiscoverChoice.recipe_id).where(
                HouseholdDiscoverChoice.household_id == household_id
            )
        )
    )
    if discover:
        query = query.where(Recipe.id.in_(enabled))
    total = db.scalar(select(func.count()).select_from(query.subquery()))
    preferences = household_preference_terms(db, group)
    items = []
    for recipe in db.scalars(
        query.order_by(Recipe.name, Recipe.id).limit(limit).offset(offset)
    ).unique():
        safety = recipe_group_safety(group, recipe, preferences)
        if discover and safety["is_blocked"]:
            continue
        items.append(
            {
                "recipe": serialize_recipe(recipe, current_user.id, db),
                "enabled": recipe.id in enabled,
                **safety,
            }
        )
    return {
        "items": items,
        "total": total,
        "enabled_count": len(enabled),
        "offset": offset,
        "page_size": limit,
    }


@router.patch("/discover-choices")
def update_choices(
    household_id: str, payload: ChoiceUpdate, db: DbDep, current_user: BasicUser
) -> dict[str, str]:
    service.authorize(db, current_user, household_id, owner=True)
    allowed = set(db.scalars(service.library_query(household_id).with_only_columns(Recipe.id)))
    enable, disable = set(payload.enable_ids), set(payload.disable_ids)
    if (enable | disable) - allowed or enable & disable:
        raise HTTPException(422, "Choose recipes from this group's library.")
    if payload.bulk_action:
        query = service.library_query(household_id)
        if payload.q.strip():
            query = query.where(Recipe.name.ilike(f"%{payload.q.strip()}%"))
        matches = set(db.scalars(query.with_only_columns(Recipe.id)))
        if payload.bulk_action == "enable":
            enable |= matches
            enable -= disable
        else:
            disable |= matches
            disable -= enable
    existing = {
        row.recipe_id: row
        for row in db.scalars(
            select(HouseholdDiscoverChoice).where(
                HouseholdDiscoverChoice.household_id == household_id
            )
        )
    }
    for recipe_id in enable - existing.keys():
        db.add(HouseholdDiscoverChoice(household_id=household_id, recipe_id=recipe_id))
    for recipe_id in disable & existing.keys():
        db.delete(existing[recipe_id])
    db.commit()
    return {"status": "saved"}


@router.get("/proposals")
def proposals(household_id: str, db: DbDep, current_user: BasicUser) -> dict[str, Any]:
    plan = service.current_plan(db, current_user, household_id)
    active = set(
        db.scalars(
            select(HouseholdMember.user_id).where(HouseholdMember.household_id == household_id)
        )
    )
    enabled = set(
        db.scalars(
            select(HouseholdDiscoverChoice.recipe_id).where(
                HouseholdDiscoverChoice.household_id == household_id
            )
        )
    )
    items = []
    for row in db.scalars(
        select(MealProposal)
        .where(
            MealProposal.household_id == household_id, MealProposal.week_start == plan.week_start
        )
        .order_by(MealProposal.created_at)
    ):
        members = (
            set(
                db.scalars(
                    select(MealProposalMember.user_id).where(
                        MealProposalMember.proposal_id == row.id
                    )
                )
            )
            & active
        )
        if not members and row.status == "pending":
            continue
        votes = db.scalars(
            select(HouseholdVote).where(
                HouseholdVote.household_id == household_id,
                HouseholdVote.week_start == plan.week_start,
                HouseholdVote.recipe_id == row.recipe_id,
                HouseholdVote.user_id.in_(active),
            )
        ).all()
        recipe = db.get(Recipe, row.recipe_id)
        if not recipe:
            continue
        items.append(
            {
                "id": row.id,
                "recipe": serialize_recipe(recipe, current_user.id, db),
                "status": row.status,
                "proposer_count": len(members),
                "is_proposer": current_user.id in members,
                "extra_request": row.recipe_id not in enabled,
                "votes": {
                    value: sum(v.vote == value for v in votes) for value in ("yes", "maybe", "no")
                },
                "my_vote": next((v.vote for v in votes if v.user_id == current_user.id), None),
            }
        )
    db.commit()
    return {"week_start": plan.week_start, "items": items}


@router.post("/proposals")
def create_proposal(
    household_id: str, payload: ProposalCreate, db: DbDep, current_user: BasicUser
) -> dict[str, str]:
    group = service.authorize(db, current_user, household_id)
    plan = service.current_plan(db, current_user, household_id)
    proposal = service.propose(db, current_user, group, plan, payload.recipe_id)
    db.commit()
    return {"id": proposal.id, "status": proposal.status}


def pending_proposal(
    db: Session, user: User, household_id: str, proposal_id: str, *, owner: bool = False
) -> tuple[Household, WeeklyPlan, MealProposal]:
    group = service.authorize(db, user, household_id, owner=owner)
    plan = service.current_plan(db, user, household_id)
    row = db.get(MealProposal, proposal_id)
    if not row or row.household_id != household_id or row.week_start != plan.week_start:
        raise HTTPException(404, "Request not found in this week.")
    if row.status != "pending":
        raise HTTPException(409, "This request has already been reviewed.")
    if not db.scalar(
        select(MealProposalMember.id)
        .join(HouseholdMember, HouseholdMember.user_id == MealProposalMember.user_id)
        .where(
            MealProposalMember.proposal_id == row.id, HouseholdMember.household_id == household_id
        )
    ):
        raise HTTPException(409, "This request has been withdrawn.")
    return group, plan, row


@router.post("/proposals/{proposal_id}/vote")
def vote(
    household_id: str, proposal_id: str, payload: ProposalVote, db: DbDep, current_user: BasicUser
) -> dict[str, str]:
    _, plan, row = pending_proposal(db, current_user, household_id, proposal_id)
    if not db.scalar(select(MealProposalMember.id).where(MealProposalMember.proposal_id == row.id)):
        raise HTTPException(409, "This request has been withdrawn.")
    record = db.scalar(
        select(HouseholdVote).where(
            HouseholdVote.household_id == household_id,
            HouseholdVote.week_start == plan.week_start,
            HouseholdVote.recipe_id == row.recipe_id,
            HouseholdVote.user_id == current_user.id,
        )
    )
    if not record:
        record = HouseholdVote(
            household_id=household_id,
            week_start=plan.week_start,
            recipe_id=row.recipe_id,
            user_id=current_user.id,
        )
        db.add(record)
    record.vote = payload.vote
    db.commit()
    return {"status": "saved"}


@router.delete("/proposals/{proposal_id}/participation")
def withdraw(
    household_id: str, proposal_id: str, db: DbDep, current_user: BasicUser
) -> dict[str, str]:
    _, plan, row = pending_proposal(db, current_user, household_id, proposal_id)
    db.query(MealProposalMember).filter(
        MealProposalMember.proposal_id == row.id, MealProposalMember.user_id == current_user.id
    ).delete()
    db.query(HouseholdVote).filter(
        HouseholdVote.household_id == household_id,
        HouseholdVote.week_start == plan.week_start,
        HouseholdVote.recipe_id == row.recipe_id,
        HouseholdVote.user_id == current_user.id,
    ).delete()
    db.commit()
    return {"status": "withdrawn"}


@router.post("/proposals/{proposal_id}/decision")
def decide(
    household_id: str,
    proposal_id: str,
    payload: ProposalDecision,
    db: DbDep,
    current_user: BasicUser,
) -> dict[str, str]:
    group, plan, row = pending_proposal(db, current_user, household_id, proposal_id, owner=True)
    if payload.action == "approve":
        service.require_recipe(db, group, row.recipe_id)
        row.planned_slot_id = service.add_slot(
            db, plan, row.recipe_id, payload.slot_date, payload.servings
        ).id
        row.status = "approved"
        regenerate_grocery_list(db, current_user, plan, preserve_edits=True, commit=False)
    else:
        row.status = "declined"
    db.commit()
    return {"status": row.status}


@router.get("/weekly-plans/current")
def calendar(household_id: str, db: DbDep, current_user: BasicUser) -> dict[str, Any]:
    plan = service.current_plan(db, current_user, household_id)
    db.commit()
    return serialize_plan(db, plan)


@router.post("/weekly-plans/current/slots")
def add_meal(
    household_id: str, payload: WeeklySlotCreate, db: DbDep, current_user: BasicUser
) -> dict[str, Any]:
    group = service.authorize(db, current_user, household_id, owner=True)
    plan = service.current_plan(db, current_user, household_id)
    service.require_recipe(db, group, payload.recipe_id)
    service.add_slot(db, plan, payload.recipe_id, payload.slot_date, payload.servings or 1)
    regenerate_grocery_list(db, current_user, plan, preserve_edits=True)
    return serialize_plan(db, plan)


@router.put("/weekly-plans/current/slots/{slot_id}")
def update_meal(
    household_id: str, slot_id: str, payload: WeeklySlotUpdate, db: DbDep, current_user: BasicUser
) -> dict[str, Any]:
    service.authorize(db, current_user, household_id, owner=True)
    plan = service.current_plan(db, current_user, household_id)
    slot = db.get(WeeklyPlanSlot, slot_id)
    if not slot or slot.weekly_plan_id != plan.id:
        raise HTTPException(404, "Meal not found")
    values = payload.model_dump(exclude_unset=True)
    if values.get("slot_type", "meal") != "meal" or "recipe_id" in values:
        raise HTTPException(422, "Remove the meal or add another recipe instead.")
    if values.get("slot_date") and not plan.week_start <= values[
        "slot_date"
    ] < plan.week_start + timedelta(days=7):
        raise HTTPException(422, "Choose a day in this week.")
    for key, value in values.items():
        setattr(slot, key, value)
    regenerate_grocery_list(db, current_user, plan, preserve_edits=True)
    return serialize_plan(db, plan)


@router.delete("/weekly-plans/current/slots/{slot_id}")
def remove_meal(
    household_id: str, slot_id: str, db: DbDep, current_user: BasicUser
) -> dict[str, Any]:
    plan = service.current_plan(db, current_user, household_id, owner=True)
    slot = db.get(WeeklyPlanSlot, slot_id)
    if not slot or slot.weekly_plan_id != plan.id:
        raise HTTPException(404, "Meal not found")
    service.clear_slots(db, plan, slot_id=slot_id)
    regenerate_grocery_list(db, current_user, plan, preserve_edits=True)
    return serialize_plan(db, plan)


@router.post("/weekly-plans/current/reset")
def reset(
    household_id: str, payload: WeeklyPlanReset, db: DbDep, current_user: BasicUser
) -> dict[str, Any]:
    plan = service.current_plan(db, current_user, household_id, owner=True)
    if payload.slot_date and not plan.week_start <= payload.slot_date < plan.week_start + timedelta(
        days=7
    ):
        raise HTTPException(422, "Choose a day in this week.")
    service.clear_slots(db, plan, payload.slot_date)
    regenerate_grocery_list(db, current_user, plan, preserve_edits=True)
    return serialize_plan(db, plan)


@router.post("/weekly-plans/current/reorder")
def reorder(
    household_id: str, payload: WeeklyPlanReorder, db: DbDep, current_user: BasicUser
) -> dict[str, Any]:
    plan = service.current_plan(db, current_user, household_id, owner=True)
    slots = db.scalars(select(WeeklyPlanSlot).where(WeeklyPlanSlot.weekly_plan_id == plan.id)).all()
    if len(payload.ordered_slot_ids) != len(slots) or set(payload.ordered_slot_ids) != {
        row.id for row in slots
    }:
        raise HTTPException(409, "This plan changed. Refresh and try again.")
    positions = {key: index for index, key in enumerate(payload.ordered_slot_ids)}
    for row in slots:
        row.sort_order = positions[row.id]
    db.commit()
    return serialize_plan(db, plan)


@router.get("/planning-settings")
def get_settings(household_id: str, db: DbDep, current_user: BasicUser) -> dict[str, Any]:
    config = service.settings(service.authorize(db, current_user, household_id))
    preferences = reminder_preferences(current_user)
    return config | {"personal_notify": preferences.get(household_id, True)}


@router.put("/planning-settings")
def save_settings(
    household_id: str, payload: WeeklyPlanningUpdate, db: DbDep, current_user: BasicUser
) -> dict[str, Any]:
    from zoneinfo import ZoneInfo

    from app.services import planning

    group = service.authorize(db, current_user, household_id, owner=True)
    today = planning.now_utc().astimezone(ZoneInfo(payload.time_zone)).date()
    group.planning_settings = payload.model_dump(exclude={"initialize_only"}) | {
        "cursor": (today - timedelta(days=(today.weekday() - payload.reset_day) % 7)).isoformat()
    }
    db.commit()
    return service.settings(group)
