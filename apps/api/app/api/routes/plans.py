from __future__ import annotations

from datetime import timedelta

from fastapi import APIRouter, HTTPException
from sqlalchemy import select

from app.api.deps import BasicUser, DbDep
from app.models.entities import MealMacroConfirmation, Recipe, WeeklyPlanSlot
from app.schemas.common import WeeklyPlanReset, WeeklySlotUpdate
from app.services.recipes import (
    accessible_recipes_query,
    get_or_create_current_plan,
    regenerate_grocery_list,
    serialize_plan,
)

router = APIRouter(prefix="/weekly-plans", tags=["weekly-plans"])


@router.get("/current")
def current_plan(db: DbDep, current_user: BasicUser) -> dict[str, object]:
    plan = get_or_create_current_plan(db, current_user)
    return serialize_plan(db, plan)


@router.post("/current/reset")
def reset_plan(payload: WeeklyPlanReset, db: DbDep, current_user: BasicUser) -> dict[str, object]:
    plan = get_or_create_current_plan(db, current_user)
    if payload.slot_date and not plan.week_start <= payload.slot_date < plan.week_start + timedelta(
        days=7
    ):
        raise HTTPException(status_code=422, detail="Choose a day in this week.")
    slots = list(
        db.scalars(
            select(WeeklyPlanSlot)
            .where(WeeklyPlanSlot.weekly_plan_id == plan.id)
            .order_by(WeeklyPlanSlot.sort_order, WeeklyPlanSlot.id)
        ).all()
    )
    selected = [
        slot for slot in slots if payload.slot_date is None or slot.slot_date == payload.slot_date
    ]
    # Logged nutrition is historical data, not part of the editable plan.
    ids = [slot.id for slot in selected]
    if ids:
        db.query(MealMacroConfirmation).filter(
            MealMacroConfirmation.weekly_plan_slot_id.in_(ids),
            MealMacroConfirmation.user_id == current_user.id,
        ).update({MealMacroConfirmation.weekly_plan_slot_id: None}, synchronize_session=False)
    servings = current_user.profile.household_size if current_user.profile else 4
    for slot in selected:
        slot.recipe_id = None
        slot.slot_type = "flexible"
        slot.servings = servings
        slot.is_locked = False
        if payload.slot_date is None:
            slot.slot_date = None
    if payload.slot_date is None:
        target = current_user.profile.weekly_meal_target if current_user.profile else 5
        plan.meal_target = target
        for slot in slots[target:]:
            db.delete(slot)
        for index, slot in enumerate(slots[:target]):
            slot.sort_order = index
        for index in range(len(slots), target):
            db.add(
                WeeklyPlanSlot(
                    weekly_plan_id=plan.id,
                    slot_type="flexible",
                    servings=servings,
                    sort_order=index,
                )
            )
    db.flush()
    regenerate_grocery_list(db, current_user, plan, preserve_edits=True)
    return serialize_plan(db, plan)


@router.put("/current/slots/{slot_id}")
def update_slot(
    slot_id: str, payload: WeeklySlotUpdate, db: DbDep, current_user: BasicUser
) -> dict[str, object]:
    plan = get_or_create_current_plan(db, current_user)
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
    for key, value in updates.items():
        setattr(slot, key, value)
    db.commit()
    return serialize_plan(db, plan)


@router.delete("/current/slots/{slot_id}")
def remove_slot(slot_id: str, db: DbDep, current_user: BasicUser) -> dict[str, object]:
    plan = get_or_create_current_plan(db, current_user)
    slot = db.scalar(
        select(WeeklyPlanSlot).where(
            WeeklyPlanSlot.id == slot_id, WeeklyPlanSlot.weekly_plan_id == plan.id
        )
    )
    if not slot:
        raise HTTPException(status_code=404, detail="Slot not found")
    slot.recipe_id = None
    slot.slot_type = "flexible"
    db.commit()
    return serialize_plan(db, plan)
