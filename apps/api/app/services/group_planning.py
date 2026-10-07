from __future__ import annotations

from datetime import date, timedelta
from typing import Any
from zoneinfo import ZoneInfo

from fastapi import HTTPException
from sqlalchemy import Select, func, or_, select
from sqlalchemy.orm import Session, selectinload

from app.models.entities import (
    Favorite,
    HiddenRecipe,
    Household,
    HouseholdDiscoverChoice,
    HouseholdMember,
    HouseholdRecipe,
    HouseholdVote,
    MealMacroConfirmation,
    MealProposal,
    MealProposalMember,
    MealSwipe,
    Recipe,
    User,
    WeeklyPlan,
    WeeklyPlanSlot,
)
from app.services import planning


def authorize(db: Session, user: User, household_id: str, *, owner: bool = False) -> Household:
    # Lock the space before reading the role: transfers and membership changes use this lock too.
    db.execute(select(User.id).where(User.id == user.id).with_for_update()).one()
    group = db.scalar(select(Household).where(Household.id == household_id).with_for_update())
    member = db.scalar(
        select(HouseholdMember)
        .where(
            HouseholdMember.household_id == household_id,
            HouseholdMember.user_id == user.id,
        )
        .execution_options(populate_existing=True)
    )
    if not group or group.is_personal or not member:
        raise HTTPException(404, "Group not found")
    if owner and member.role != "owner":
        raise HTTPException(403, "Only the group owner can change the shared plan.")
    return group


def library_query(household_id: str) -> Select[tuple[Recipe]]:
    return (
        select(Recipe)
        .where(
            Recipe.validation_status == "approved",
            Recipe.archived_at.is_(None),
            or_(
                Recipe.household_id == household_id,
                Recipe.id.in_(
                    select(HouseholdRecipe.recipe_id).where(
                        HouseholdRecipe.household_id == household_id
                    )
                ),
            ),
        )
        .options(
            selectinload(Recipe.ingredients),
            selectinload(Recipe.instructions),
            selectinload(Recipe.tags),
        )
    )


def require_recipe(
    db: Session, group: Household, recipe_id: str, *, enabled: bool = False
) -> Recipe:
    from app.services.groups import household_preference_terms, recipe_group_safety

    recipe = db.scalar(library_query(group.id).where(Recipe.id == recipe_id))
    if not recipe:
        raise HTTPException(404, "Recipe is not in this group's library.")
    if enabled and not db.scalar(
        select(HouseholdDiscoverChoice.id).where(
            HouseholdDiscoverChoice.household_id == group.id,
            HouseholdDiscoverChoice.recipe_id == recipe_id,
        )
    ):
        raise HTTPException(409, "This recipe is no longer a Discover choice. Refresh the deck.")
    if recipe_group_safety(group, recipe, household_preference_terms(db, group))["is_blocked"]:
        raise HTTPException(422, "Group safety settings block this recipe.")
    return recipe


def settings(group: Household) -> dict[str, Any]:
    return {"mode": "manual", "reset_day": 0, "notify": True, "time_zone": "UTC"} | (
        group.planning_settings or {}
    )


def current_plan(db: Session, user: User, household_id: str, *, owner: bool = False) -> WeeklyPlan:
    from app.services.recipes import regenerate_grocery_list

    group = authorize(db, user, household_id, owner=owner)
    config = settings(group)
    today = planning.now_utc().astimezone(ZoneInfo(config["time_zone"])).date()
    week = today - timedelta(days=today.weekday())
    cycle = (today - timedelta(days=(today.weekday() - config["reset_day"]) % 7)).isoformat()
    due = (
        config["mode"] == "automatic"
        and isinstance(config.get("cursor"), str)
        and config["cursor"] < cycle
    )
    plan = db.scalar(
        select(WeeklyPlan).where(WeeklyPlan.household_id == group.id, WeeklyPlan.week_start == week)
    )
    changed = False
    if not plan:
        previous = db.scalar(
            select(WeeklyPlan)
            .where(WeeklyPlan.household_id == group.id, WeeklyPlan.week_start < week)
            .order_by(WeeklyPlan.week_start.desc())
            .limit(1)
        )
        plan = WeeklyPlan(household_id=group.id, week_start=week, meal_target=0)
        db.add(plan)
        db.flush()
        if previous and not due:
            allowed = set(db.scalars(library_query(group.id).with_only_columns(Recipe.id)))
            for old in db.scalars(
                select(WeeklyPlanSlot).where(WeeklyPlanSlot.weekly_plan_id == previous.id)
            ):
                if old.recipe_id not in allowed:
                    continue
                db.add(
                    WeeklyPlanSlot(
                        weekly_plan_id=plan.id,
                        recipe_id=old.recipe_id,
                        slot_date=week + (old.slot_date - previous.week_start)
                        if old.slot_date
                        else None,
                        servings=old.servings,
                        sort_order=old.sort_order,
                        slot_type="meal",
                    )
                )
        changed = True
    if due:
        clear_slots(db, plan)
        changed = True
    if due or (config["mode"] == "automatic" and not config.get("cursor")):
        group.planning_settings = config | {"cursor": cycle}
        changed = True
    if changed:
        db.flush()
        regenerate_grocery_list(db, user, plan, preserve_edits=True, commit=False)
    # Caller commits the whole operation, including reconciliation and groceries.
    return plan


def clear_slots(
    db: Session, plan: WeeklyPlan, slot_date: date | None = None, slot_id: str | None = None
) -> None:
    rows = db.scalars(select(WeeklyPlanSlot).where(WeeklyPlanSlot.weekly_plan_id == plan.id)).all()
    ids = [
        row.id
        for row in rows
        if (slot_date is None or row.slot_date == slot_date)
        and (slot_id is None or row.id == slot_id)
    ]
    if not ids:
        return
    db.query(MealMacroConfirmation).filter(
        MealMacroConfirmation.weekly_plan_slot_id.in_(ids)
    ).update({MealMacroConfirmation.weekly_plan_slot_id: None}, synchronize_session=False)
    db.query(MealSwipe).filter(
        MealSwipe.planned_slot_id.in_(ids), MealSwipe.undone_at.is_(None)
    ).update(
        {MealSwipe.undone_at: planning.now_utc().replace(tzinfo=None)}, synchronize_session=False
    )
    db.query(MealProposal).filter(MealProposal.planned_slot_id.in_(ids)).update(
        {MealProposal.planned_slot_id: None}, synchronize_session=False
    )
    for row in rows:
        if row.id in ids:
            db.delete(row)
    db.flush()


def add_slot(
    db: Session, plan: WeeklyPlan, recipe_id: str, slot_date: date | None = None, servings: int = 1
) -> WeeklyPlanSlot:
    if slot_date and not plan.week_start <= slot_date < plan.week_start + timedelta(days=7):
        raise HTTPException(422, "Choose a day in this week.")
    highest = db.scalar(
        select(func.max(WeeklyPlanSlot.sort_order)).where(WeeklyPlanSlot.weekly_plan_id == plan.id)
    )
    slot = WeeklyPlanSlot(
        weekly_plan_id=plan.id,
        recipe_id=recipe_id,
        slot_date=slot_date,
        servings=servings,
        sort_order=(highest if highest is not None else -1) + 1,
        slot_type="meal",
    )
    db.add(slot)
    db.flush()
    proposal = db.scalar(
        select(MealProposal).where(
            MealProposal.household_id == plan.household_id,
            MealProposal.week_start == plan.week_start,
            MealProposal.recipe_id == recipe_id,
            MealProposal.status == "pending",
        )
    )
    if proposal:
        proposal.status = "approved"
        proposal.planned_slot_id = slot.id
    return slot


def propose(
    db: Session, user: User, group: Household, plan: WeeklyPlan, recipe_id: str
) -> MealProposal:
    require_recipe(db, group, recipe_id)
    proposal = db.scalar(
        select(MealProposal).where(
            MealProposal.household_id == group.id,
            MealProposal.week_start == plan.week_start,
            MealProposal.recipe_id == recipe_id,
        )
    )
    if not proposal:
        proposal = MealProposal(
            household_id=group.id, week_start=plan.week_start, recipe_id=recipe_id
        )
        db.add(proposal)
        db.flush()
    if proposal.status != "pending":
        raise HTTPException(409, "This request has already been reviewed.")
    if not db.scalar(
        select(MealProposalMember.id).where(
            MealProposalMember.proposal_id == proposal.id, MealProposalMember.user_id == user.id
        )
    ):
        db.add(MealProposalMember(proposal_id=proposal.id, user_id=user.id))
        db.flush()
    return proposal


def record_swipe(
    db: Session,
    user: User,
    recipe_id: str,
    action: str,
    session_id: str,
    request_id: str | None,
    household_id: str,
) -> MealSwipe:
    from app.services.recipes import regenerate_grocery_list

    group = authorize(db, user, household_id)
    previous = (
        db.scalar(
            select(MealSwipe).where(
                MealSwipe.user_id == user.id, MealSwipe.request_id == request_id
            )
        )
        if request_id
        else None
    )
    if previous:
        if (previous.recipe_id, previous.action, previous.household_id) != (
            recipe_id,
            action,
            household_id,
        ):
            raise HTTPException(409, "This choice ID was already used for different details.")
        return previous
    require_recipe(db, group, recipe_id, enabled=True)
    plan = current_plan(db, user, group.id)
    event = MealSwipe(
        user_id=user.id,
        recipe_id=recipe_id,
        action=action,
        session_id=session_id,
        request_id=request_id,
        household_id=group.id,
    )
    db.add(event)
    if action == "add":
        member = db.scalar(
            select(HouseholdMember).where(
                HouseholdMember.household_id == group.id, HouseholdMember.user_id == user.id
            )
        )
        if member and member.role == "owner":
            event.planned_slot_id = add_slot(db, plan, recipe_id).id
            regenerate_grocery_list(db, user, plan, preserve_edits=True, commit=False)
        else:
            event.proposal_id = propose(db, user, group, plan, recipe_id).id
    if action in {"favorite", "hide"}:
        model = Favorite if action == "favorite" else HiddenRecipe
        if not db.scalar(
            select(model.id).where(model.user_id == user.id, model.recipe_id == recipe_id)
        ):
            db.add(model(user_id=user.id, recipe_id=recipe_id))
    db.commit()
    return event


def undo_swipe(db: Session, user: User, event: MealSwipe) -> None:
    from app.services.recipes import regenerate_grocery_list

    if not event.household_id:
        raise HTTPException(404, "Group choice not found")
    authorize(db, user, event.household_id, owner=bool(event.planned_slot_id))
    if event.undone_at:
        return
    plan = current_plan(db, user, event.household_id)
    if event.proposal_id:
        proposal = db.get(MealProposal, event.proposal_id)
        if not proposal or proposal.status != "pending" or proposal.week_start != plan.week_start:
            raise HTTPException(
                409, "This request has already been reviewed or belongs to an earlier week."
            )
        db.query(MealProposalMember).filter(
            MealProposalMember.proposal_id == proposal.id, MealProposalMember.user_id == user.id
        ).delete()
        db.query(HouseholdVote).filter(
            HouseholdVote.household_id == event.household_id,
            HouseholdVote.week_start == plan.week_start,
            HouseholdVote.recipe_id == event.recipe_id,
            HouseholdVote.user_id == user.id,
        ).delete()
    else:
        slot = db.get(WeeklyPlanSlot, event.planned_slot_id) if event.planned_slot_id else None
        if not slot or slot.weekly_plan_id != plan.id or slot.recipe_id != event.recipe_id:
            raise HTTPException(409, "This meal has changed. Review it in This Week.")
        clear_slots(db, plan, slot_id=slot.id)
        regenerate_grocery_list(db, user, plan, preserve_edits=True, commit=False)
    event.undone_at = planning.now_utc().replace(tzinfo=None)
    db.commit()
