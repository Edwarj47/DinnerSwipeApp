from __future__ import annotations

from datetime import date
from typing import Annotated, Any
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query, Response

from app.api.deps import BasicUser, DbDep
from app.core.config import settings
from app.core.rate_limit import auth_rate_limiter
from app.models import workouts as workout_models  # noqa: F401
from app.models.entities import User
from app.schemas.workouts import (
    DiscoverChoicesInput,
    LogInput,
    PlanningSettingsInput,
    PlanResetInput,
    ProposalDecisionInput,
    ProposalInput,
    ReorderInput,
    SlotCreateInput,
    SlotUpdateInput,
    TemplateInput,
    TemplateShareInput,
)
from app.services import workouts as service


def private_response(response: Response) -> None:
    response.headers["Cache-Control"] = "no-store"


router = APIRouter(prefix="/workouts", tags=["workouts"], dependencies=[Depends(private_response)])


def get_workout_user(current_user: BasicUser) -> User:
    if not current_user.email_verified:
        raise HTTPException(403, "Verify your email before using workouts.")
    if not getattr(settings, "workouts_enabled", False):
        raise HTTPException(404, "Workouts are not enabled.")
    auth_rate_limiter.check(f"workouts:access:{current_user.id}", 180, 60)
    return current_user


WorkoutUser = Annotated[User, Depends(get_workout_user)]


@router.get("/status")
def status(current_user: BasicUser) -> dict[str, bool]:
    return {"enabled": bool(getattr(settings, "workouts_enabled", False))}


@router.get("/templates")
def templates(
    db: DbDep,
    current_user: WorkoutUser,
    household_id: UUID | None = None,
    discover: bool = False,
    limit: int = Query(default=100, ge=1, le=100),
    offset: int = Query(default=0, ge=0),
) -> dict[str, Any]:
    return service.templates(
        db, current_user, str(household_id) if household_id else None, discover, limit, offset
    )


@router.post("/templates")
def create_template(payload: TemplateInput, db: DbDep, current_user: WorkoutUser) -> dict[str, Any]:
    template = service.save_template(db, current_user, payload)
    result = service.render_template(db, current_user, template)
    db.commit()
    return result


@router.put("/templates/{template_id}")
def edit_template(
    template_id: UUID, payload: TemplateInput, db: DbDep, current_user: WorkoutUser
) -> dict[str, Any]:
    template = service.save_template(db, current_user, payload, str(template_id))
    result = service.render_template(db, current_user, template)
    db.commit()
    return result


@router.post("/templates/share")
def share_templates(
    payload: TemplateShareInput, db: DbDep, current_user: WorkoutUser
) -> dict[str, str]:
    service.share_templates(
        db, current_user, str(payload.household_id), [str(value) for value in payload.template_ids]
    )
    db.commit()
    return {"status": "shared"}


@router.patch("/discover-choices")
def choices(payload: DiscoverChoicesInput, db: DbDep, current_user: WorkoutUser) -> dict[str, str]:
    service.discover_choices(
        db,
        current_user,
        str(payload.household_id),
        [str(value) for value in payload.enable_ids],
        [str(value) for value in payload.disable_ids],
    )
    db.commit()
    return {"status": "saved"}


@router.get("/plans/current")
def current_plan(
    db: DbDep, current_user: WorkoutUser, household_id: UUID | None = None
) -> dict[str, Any]:
    result = service.current_plan(db, current_user, str(household_id) if household_id else None)
    db.commit()
    return result


@router.get("/planning-settings")
def planning_settings(
    db: DbDep, current_user: WorkoutUser, household_id: UUID | None = None
) -> dict[str, Any]:
    group, _ = service.scope(db, current_user, str(household_id) if household_id else None)
    return service.planning_settings(db, current_user, group)


@router.get("/planning-reminders")
def reminders(db: DbDep, current_user: WorkoutUser) -> dict[str, Any]:
    from sqlalchemy import select

    from app.models.entities import Household, HouseholdMember

    groups = db.scalars(
        select(Household)
        .join(HouseholdMember)
        .where(HouseholdMember.user_id == current_user.id, Household.is_personal.is_(False))
    )
    return {
        "personal": service.planning_settings(db, current_user, None),
        "groups": [
            {
                "id": group.id,
                "name": group.name,
                "settings": service.planning_settings(db, current_user, group),
            }
            for group in groups
        ],
    }


@router.put("/planning-settings")
def save_planning_settings(
    payload: PlanningSettingsInput,
    db: DbDep,
    current_user: WorkoutUser,
    household_id: UUID | None = None,
) -> dict[str, Any]:
    result = service.save_settings(
        db, current_user, str(household_id) if household_id else None, payload
    )
    db.commit()
    return result


@router.post("/plans/current/reset")
def reset_plan(
    payload: PlanResetInput,
    db: DbDep,
    current_user: WorkoutUser,
    household_id: UUID | None = None,
) -> dict[str, Any]:
    result = service.reset_plan(
        db, current_user, str(household_id) if household_id else None, payload.slot_date
    )
    db.commit()
    return result


@router.get("/plans/history")
def history(
    week_start: date, db: DbDep, current_user: WorkoutUser, household_id: UUID | None = None
) -> dict[str, Any]:
    return service.history(
        db, current_user, str(household_id) if household_id else None, week_start
    )


@router.patch("/plans/reorder")
def reorder(payload: ReorderInput, db: DbDep, current_user: WorkoutUser) -> dict[str, Any]:
    result = service.reorder(
        db,
        current_user,
        str(payload.household_id) if payload.household_id else None,
        [str(value) for value in payload.slot_ids],
    )
    db.commit()
    return result


@router.post("/plans/slots")
def add_slot(payload: SlotCreateInput, db: DbDep, current_user: WorkoutUser) -> dict[str, Any]:
    slot = service.add_slot(
        db,
        current_user,
        str(payload.household_id) if payload.household_id else None,
        str(payload.template_id),
        payload.slot_date,
    )
    result = service.serialize_slot(db, current_user, slot)
    db.commit()
    return result


@router.patch("/plans/slots/{slot_id}")
def update_slot(
    slot_id: UUID, payload: SlotUpdateInput, db: DbDep, current_user: WorkoutUser
) -> dict[str, Any]:
    result = service.serialize_slot(
        db, current_user, service.update_slot(db, current_user, str(slot_id), payload)
    )
    db.commit()
    return result


@router.delete("/plans/slots/{slot_id}")
def delete_slot(slot_id: UUID, db: DbDep, current_user: WorkoutUser) -> dict[str, str]:
    service.delete_slot(db, current_user, str(slot_id))
    db.commit()
    return {"status": "deleted"}


@router.post("/proposals")
def propose(payload: ProposalInput, db: DbDep, current_user: WorkoutUser) -> dict[str, Any]:
    proposal = service.propose(
        db, current_user, str(payload.household_id), str(payload.template_id)
    )
    result = service.serialize_proposal(db, current_user, proposal)
    db.commit()
    return result


@router.get("/proposals")
def proposals(
    household_id: UUID,
    db: DbDep,
    current_user: WorkoutUser,
    limit: int = Query(default=100, ge=1, le=100),
    offset: int = Query(default=0, ge=0),
) -> dict[str, Any]:
    return service.proposals(db, current_user, str(household_id), limit, offset)


@router.post("/proposals/{proposal_id}/decision")
def decision(
    proposal_id: UUID, payload: ProposalDecisionInput, db: DbDep, current_user: WorkoutUser
) -> dict[str, Any]:
    proposal = service.decide(db, current_user, str(proposal_id), payload.action, payload.slot_date)
    result = service.serialize_proposal(db, current_user, proposal)
    db.commit()
    return result


@router.put("/logs/{request_uuid}")
def save_log(
    request_uuid: UUID, payload: LogInput, db: DbDep, current_user: WorkoutUser
) -> dict[str, Any]:
    result = service.serialize_log(
        db, current_user, service.save_log(db, current_user, str(request_uuid), payload)
    )
    db.commit()
    return result


@router.get("/logs")
def logs(
    db: DbDep,
    current_user: WorkoutUser,
    limit: int = Query(default=100, ge=1, le=100),
    offset: int = Query(default=0, ge=0),
) -> dict[str, Any]:
    return service.logs(db, current_user, limit, offset)


@router.get("/progress")
def progress(db: DbDep, current_user: WorkoutUser) -> dict[str, Any]:
    return service.progress(db, current_user)
