from __future__ import annotations

from fastapi import APIRouter, HTTPException
from sqlalchemy import select

from app.api.deps import CurrentUser, DbDep
from app.models.entities import WeeklyPlanSlot
from app.schemas.common import WeeklySlotUpdate
from app.services.recipes import get_or_create_current_plan, serialize_plan

router = APIRouter(prefix="/weekly-plans", tags=["weekly-plans"])


@router.get("/current")
def current_plan(db: DbDep, current_user: CurrentUser) -> dict[str, object]:
    plan = get_or_create_current_plan(db, current_user)
    return serialize_plan(db, plan)


@router.put("/current/slots/{slot_id}")
def update_slot(
    slot_id: str, payload: WeeklySlotUpdate, db: DbDep, current_user: CurrentUser
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
    if updates.get("slot_type") in {"leftovers", "dining_out", "flexible"}:
        updates["recipe_id"] = None
    for key, value in updates.items():
        setattr(slot, key, value)
    db.commit()
    return serialize_plan(db, plan)


@router.delete("/current/slots/{slot_id}")
def remove_slot(slot_id: str, db: DbDep, current_user: CurrentUser) -> dict[str, object]:
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
