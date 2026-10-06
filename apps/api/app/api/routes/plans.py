from __future__ import annotations

from datetime import timedelta

from fastapi import APIRouter, HTTPException
from sqlalchemy import select

from app.api.deps import BasicUser, DbDep
from app.models.entities import MealMacroConfirmation, Recipe, WeeklyPlanSlot
from app.schemas.common import (
    WeeklyPlanReorder,
    WeeklyPlanReset,
    WeeklySlotCreate,
    WeeklySlotUpdate,
)
from app.services.planning import reset_plan_slots
from app.services.recipes import (
    accessible_recipes_query,
    clear_plan_slot,
    get_or_create_current_plan,
    regenerate_grocery_list,
    retire_slot_choices,
    serialize_plan,
)

router = APIRouter(prefix="/weekly-plans", tags=["weekly-plans"])


@router.get("/current")
def current_plan(db: DbDep, current_user: BasicUser) -> dict[str, object]:
    plan = get_or_create_current_plan(db, current_user)
    return serialize_plan(db, plan)


@router.post("/current/reset")
def reset_plan(payload: WeeklyPlanReset, db: DbDep, current_user: BasicUser) -> dict[str, object]:
    plan = get_or_create_current_plan(db, current_user, lock=True)
    if payload.slot_date and not plan.week_start <= payload.slot_date < plan.week_start + timedelta(
        days=7
    ):
        raise HTTPException(status_code=422, detail="Choose a day in this week.")
    reset_plan_slots(db, current_user, plan, payload.slot_date)
    regenerate_grocery_list(db, current_user, plan, preserve_edits=True)
    return serialize_plan(db, plan)


@router.post("/current/reorder")
def reorder_plan(
    payload: WeeklyPlanReorder, db: DbDep, current_user: BasicUser
) -> dict[str, object]:
    # Use the same user lock as swipe planning to serialize competing additions.
    plan = get_or_create_current_plan(db, current_user, lock=True)
    slots = list(
        db.scalars(
            select(WeeklyPlanSlot).where(WeeklyPlanSlot.weekly_plan_id == plan.id).with_for_update()
        ).all()
    )
    ids = payload.ordered_slot_ids
    if len(ids) != len(set(ids)) or set(ids) != {slot.id for slot in slots}:
        raise HTTPException(409, "This plan changed. Refresh and try again.")
    positions = {slot_id: index for index, slot_id in enumerate(ids)}
    for slot in slots:
        slot.sort_order = positions[slot.id]
    db.commit()
    return serialize_plan(db, plan)


@router.put("/current/slots/{slot_id}")
def update_slot(
    slot_id: str, payload: WeeklySlotUpdate, db: DbDep, current_user: BasicUser
) -> dict[str, object]:
    plan = get_or_create_current_plan(db, current_user, lock=True)
    slot = db.scalar(
        select(WeeklyPlanSlot).where(
            WeeklyPlanSlot.id == slot_id, WeeklyPlanSlot.weekly_plan_id == plan.id
        )
    )
    if not slot:
        raise HTTPException(status_code=404, detail="Slot not found")
    updates = payload.model_dump(exclude_unset=True)
    if updates.get("slot_date") and not plan.week_start <= updates[
        "slot_date"
    ] < plan.week_start + timedelta(days=7):
        raise HTTPException(status_code=422, detail="Choose a day in this week.")
    if updates.get("recipe_id") and not db.scalar(
        accessible_recipes_query(current_user).where(Recipe.id == updates["recipe_id"])
    ):
        raise HTTPException(status_code=404, detail="Recipe not found")
    if updates.get("slot_type") in {"leftovers", "dining_out", "flexible"}:
        updates["recipe_id"] = None
    if "recipe_id" in updates and updates["recipe_id"] != slot.recipe_id:
        retire_slot_choices(db, current_user.id, [slot.id])
        db.query(MealMacroConfirmation).filter(
            MealMacroConfirmation.weekly_plan_slot_id == slot.id,
            MealMacroConfirmation.user_id == current_user.id,
        ).update({MealMacroConfirmation.weekly_plan_slot_id: None}, synchronize_session=False)
    for key, value in updates.items():
        setattr(slot, key, value)
    db.flush()
    regenerate_grocery_list(db, current_user, plan, preserve_edits=True)
    return serialize_plan(db, plan)


@router.delete("/current/slots/{slot_id}")
def remove_slot(slot_id: str, db: DbDep, current_user: BasicUser) -> dict[str, object]:
    plan = get_or_create_current_plan(db, current_user, lock=True)
    slot = db.scalar(
        select(WeeklyPlanSlot).where(
            WeeklyPlanSlot.id == slot_id, WeeklyPlanSlot.weekly_plan_id == plan.id
        )
    )
    if not slot:
        raise HTTPException(status_code=404, detail="Slot not found")
    clear_plan_slot(db, current_user, plan, slot)
    return serialize_plan(db, plan)


@router.post("/current/slots")
def add_slot(payload: WeeklySlotCreate, db: DbDep, current_user: BasicUser) -> dict[str, object]:
    plan = get_or_create_current_plan(db, current_user, lock=True)
    if payload.slot_date and not plan.week_start <= payload.slot_date < plan.week_start + timedelta(
        days=7
    ):
        raise HTTPException(status_code=422, detail="Choose a day in this week.")
    recipe = db.scalar(accessible_recipes_query(current_user).where(Recipe.id == payload.recipe_id))
    if not recipe:
        raise HTTPException(status_code=404, detail="Recipe not found")
    slots = list(
        db.scalars(
            select(WeeklyPlanSlot)
            .where(WeeklyPlanSlot.weekly_plan_id == plan.id)
            .order_by(WeeklyPlanSlot.sort_order)
        ).all()
    )
    # Reuse an open place on this day, then an unscheduled place; never overwrite a meal.
    slot = next(
        (
            item
            for day in (payload.slot_date, None)
            for item in slots
            if item.slot_date == day
            and item.recipe_id is None
            and item.slot_type == "flexible"
            and not item.is_locked
        ),
        None,
    )
    if slot is None:
        slot = WeeklyPlanSlot(
            weekly_plan_id=plan.id,
            sort_order=max((item.sort_order for item in slots), default=-1) + 1,
        )
        db.add(slot)
    slot.slot_date = payload.slot_date
    slot.recipe_id = recipe.id
    slot.slot_type = "meal"
    slot.servings = payload.servings or (
        current_user.profile.household_size if current_user.profile else 4
    )
    db.flush()
    regenerate_grocery_list(db, current_user, plan, preserve_edits=True)
    return serialize_plan(db, plan)
