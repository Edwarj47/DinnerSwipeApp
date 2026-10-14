from __future__ import annotations

import hashlib
import json
from collections.abc import Callable
from copy import deepcopy
from datetime import date, timedelta
from typing import Any
from zoneinfo import ZoneInfo

import structlog
from fastapi import HTTPException
from sqlalchemy import Select, func, select
from sqlalchemy.orm import Session

from app.core.config import settings
from app.database.session import SessionLocal
from app.models.entities import Household, HouseholdMember, User
from app.models.workouts import (
    WorkoutLog,
    WorkoutPlan,
    WorkoutPlanningPreference,
    WorkoutPlanSlot,
    WorkoutProposal,
    WorkoutProposalMember,
    WorkoutTemplate,
    WorkoutTemplateShare,
)
from app.schemas.workouts import LogInput, PlanningSettingsInput, SlotUpdateInput, TemplateInput
from app.services import group_planning, planning
from app.services.billing import is_basic_access_active
from app.services.workout_media import canonical_photo, render_snapshot

MAX_WEEKLY_SLOTS = 100
MAX_WEEKLY_PROPOSALS = 100
RESET_PAGE_SIZE = 100
logger = structlog.get_logger()


def lock_user(db: Session, user: User) -> None:
    db.execute(select(User.id).where(User.id == user.id).with_for_update()).one()


def is_owner(db: Session, user: User, group: Household) -> bool:
    return (
        db.scalar(
            select(HouseholdMember.role).where(
                HouseholdMember.household_id == group.id, HouseholdMember.user_id == user.id
            )
        )
        == "owner"
    )


def scope(
    db: Session, user: User, household_id: str | None, *, owner: bool = False
) -> tuple[Household | None, date]:
    if household_id:
        group = group_planning.authorize(db, user, household_id, owner=owner)
    else:
        lock_user(db, user)
        group = None
    config = planning_settings(db, user, group)
    today = planning.now_utc().astimezone(ZoneInfo(config["time_zone"])).date()
    return group, today - timedelta(days=today.weekday())


def preference(
    db: Session, user: User, household_id: str | None
) -> WorkoutPlanningPreference | None:
    return db.scalar(
        select(WorkoutPlanningPreference)
        .where(
            WorkoutPlanningPreference.household_id == household_id
            if household_id
            else WorkoutPlanningPreference.user_id == user.id
        )
        .with_for_update()
        .execution_options(populate_existing=True)
    )


def planning_settings(db: Session, user: User, group: Household | None) -> dict[str, Any]:
    stored = preference(db, user, group.id if group else None)
    if stored:
        return {
            "mode": stored.mode,
            "reset_day": stored.reset_day,
            "notify": stored.notify,
            "time_zone": stored.time_zone,
            "time_zone_configured": True,
        }
    inherited = group_planning.settings(group) if group else planning.planning_settings(user)
    return {
        "mode": "manual",
        "reset_day": 0,
        "notify": True,
        "time_zone": inherited["time_zone"],
        "time_zone_configured": False,
    }


def save_settings(
    db: Session, user: User, household_id: str | None, payload: PlanningSettingsInput
) -> dict[str, Any]:
    group, _ = scope(db, user, household_id, owner=True)
    stored = preference(db, user, household_id)
    old = planning_settings(db, user, group)
    if stored and payload.initialize_only:
        return old
    if not stored:
        stored = WorkoutPlanningPreference(
            user_id=None if household_id else user.id, household_id=household_id
        )
        db.add(stored)
    for key, value in payload.model_dump(exclude={"initialize_only"}).items():
        setattr(stored, key, value)
    if any(old[key] != getattr(stored, key) for key in ("mode", "reset_day", "time_zone")):
        today = planning.now_utc().astimezone(ZoneInfo(stored.time_zone)).date()
        stored.cursor = today - timedelta(days=(today.weekday() - stored.reset_day) % 7)
    db.flush()
    return planning_settings(db, user, group)


def brand_photo() -> str:
    return f"{settings.public_api_url.rstrip('/')}/api/v1/brand/logo.png"


def serialize_template(
    template: WorkoutTemplate, *, shared: bool = False, discover_enabled: bool = True
) -> dict[str, Any]:
    result = {
        "id": template.id,
        "title": template.title,
        "category": template.category,
        "photo_url": template.photo_url or brand_photo(),
        "photo_reference": template.photo_url,
        "description": template.description,
        "exercises": deepcopy(template.exercises),
        "owner_id": template.owner_id,
        "shared": shared,
        "discover_enabled": discover_enabled,
    }
    result["revision"] = routine_revision(result)
    return result


def routine_revision(snapshot: dict[str, Any]) -> str:
    fields = {
        key: snapshot.get(key)
        for key in ("id", "title", "category", "description", "exercises", "photo_reference")
    }
    return hashlib.sha256(
        json.dumps(fields, sort_keys=True, separators=(",", ":")).encode()
    ).hexdigest()


def render_template(db: Session, user: User, template: WorkoutTemplate) -> dict[str, Any]:
    return render_snapshot(db, user, serialize_template(template))


def shared_snapshot(share: WorkoutTemplateShare) -> dict[str, Any]:
    return deepcopy(share.snapshot) | {"shared": True, "discover_enabled": share.discover_enabled}


def routine_snapshot(
    db: Session, template: WorkoutTemplate, household_id: str | None
) -> dict[str, Any]:
    if not household_id:
        return serialize_template(template)
    share = db.scalar(
        select(WorkoutTemplateShare).where(
            WorkoutTemplateShare.household_id == household_id,
            WorkoutTemplateShare.template_id == template.id,
        )
    )
    if not share:
        raise HTTPException(404, "Workout template not found in this library")
    return shared_snapshot(share)


def template_query(user: User, household_id: str | None) -> Select[tuple[WorkoutTemplate]]:
    query = select(WorkoutTemplate)
    if household_id:
        return query.join(WorkoutTemplateShare).where(
            WorkoutTemplateShare.household_id == household_id
        )
    return query.where(WorkoutTemplate.owner_id == user.id)


def templates(
    db: Session, user: User, household_id: str | None, discover: bool, limit: int, offset: int
) -> dict[str, Any]:
    if household_id:
        group_planning.authorize(db, user, household_id)
    query = template_query(user, household_id)
    if household_id and discover:
        query = query.where(WorkoutTemplateShare.discover_enabled.is_(True))
    total = db.scalar(select(func.count()).select_from(query.subquery())) or 0
    ordering = (
        (WorkoutTemplateShare.created_at, WorkoutTemplateShare.id)
        if household_id
        else (WorkoutTemplate.title, WorkoutTemplate.id)
    )
    rows = db.scalars(query.order_by(*ordering).limit(limit).offset(offset)).all()
    shares: dict[str, WorkoutTemplateShare] = (
        {
            share.template_id: share
            for share in db.scalars(
                select(WorkoutTemplateShare).where(
                    WorkoutTemplateShare.household_id == household_id,
                    WorkoutTemplateShare.template_id.in_([row.id for row in rows]),
                )
            )
        }
        if household_id
        else {}
    )
    return {
        "items": [
            render_snapshot(
                db,
                user,
                shared_snapshot(shares[row.id]) if household_id else serialize_template(row),
            )
            for row in rows
        ],
        "total": total,
    }


def save_template(
    db: Session, user: User, payload: TemplateInput, template_id: str | None = None
) -> WorkoutTemplate:
    lock_user(db, user)
    values = payload.model_dump(mode="json")
    values["photo_url"] = canonical_photo(
        db, user, None if values["photo_url"] == brand_photo() else values["photo_url"]
    )
    if template_id:
        template = db.scalar(
            select(WorkoutTemplate)
            .where(WorkoutTemplate.id == template_id, WorkoutTemplate.owner_id == user.id)
            .with_for_update()
            .execution_options(populate_existing=True)
        )
        if not template:
            raise HTTPException(404, "Workout template not found")
        for key, value in values.items():
            setattr(template, key, value)
    else:
        template = WorkoutTemplate(owner_id=user.id, **values)
        db.add(template)
    db.flush()
    return template


def share_templates(db: Session, user: User, household_id: str, template_ids: list[str]) -> None:
    group_planning.authorize(db, user, household_id)
    ids = set(template_ids)
    owned = {
        row.id: row
        for row in db.scalars(
            select(WorkoutTemplate)
            .where(WorkoutTemplate.id.in_(ids), WorkoutTemplate.owner_id == user.id)
            .with_for_update()
            .execution_options(populate_existing=True)
        )
    }
    if owned.keys() != ids:
        raise HTTPException(404, "Workout template not found")
    existing = {
        row.template_id: row
        for row in db.scalars(
            select(WorkoutTemplateShare)
            .where(
                WorkoutTemplateShare.household_id == household_id,
                WorkoutTemplateShare.template_id.in_(ids),
            )
            .with_for_update()
            .execution_options(populate_existing=True)
        )
    }
    for template_id in sorted(ids):
        snapshot = serialize_template(owned[template_id], shared=True, discover_enabled=False)
        if template_id not in existing:
            db.add(
                WorkoutTemplateShare(
                    household_id=household_id, template_id=template_id, snapshot=snapshot
                )
            )
        elif existing[template_id].snapshot != snapshot:
            existing[template_id].snapshot = snapshot
            existing[template_id].discover_enabled = False
    db.flush()


def discover_choices(
    db: Session, user: User, household_id: str, enable_ids: list[str], disable_ids: list[str]
) -> None:
    group_planning.authorize(db, user, household_id, owner=True)
    enable, disable = set(enable_ids), set(disable_ids)
    if enable & disable:
        raise HTTPException(422, "A template cannot be both enabled and disabled.")
    shares = {
        row.template_id: row
        for row in db.scalars(
            select(WorkoutTemplateShare)
            .where(
                WorkoutTemplateShare.household_id == household_id,
                WorkoutTemplateShare.template_id.in_(enable | disable),
            )
            .with_for_update()
            .execution_options(populate_existing=True)
        )
    }
    if shares.keys() != enable | disable:
        raise HTTPException(422, "Choose templates from this group's library.")
    for template_id, share in shares.items():
        share.discover_enabled = template_id in enable
    db.flush()


def require_template(
    db: Session,
    user: User,
    template_id: str,
    household_id: str | None,
    *,
    enabled: bool = False,
) -> WorkoutTemplate:
    query = template_query(user, household_id).where(WorkoutTemplate.id == template_id)
    template = db.scalar(query.with_for_update().execution_options(populate_existing=True))
    if not template:
        raise HTTPException(404, "Workout template not found in this library")
    if (
        household_id
        and enabled
        and not db.scalar(
            select(WorkoutTemplateShare.id).where(
                WorkoutTemplateShare.household_id == household_id,
                WorkoutTemplateShare.template_id == template_id,
                WorkoutTemplateShare.discover_enabled.is_(True),
            )
        )
    ):
        raise HTTPException(409, "This workout is not an enabled Discover choice.")
    return template


def plan_query(user: User, household_id: str | None, week: date) -> Select[tuple[WorkoutPlan]]:
    return select(WorkoutPlan).where(
        WorkoutPlan.household_id == household_id
        if household_id
        else WorkoutPlan.user_id == user.id,
        WorkoutPlan.week_start == week,
    )


def ensure_plan(db: Session, user: User, household_id: str | None, week: date) -> WorkoutPlan:
    stored = preference(db, user, household_id)
    today = planning.now_utc().astimezone(ZoneInfo(stored.time_zone)).date() if stored else None
    cycle = (
        today - timedelta(days=(today.weekday() - stored.reset_day) % 7)
        if today and stored
        else None
    )
    due = bool(
        stored and stored.mode == "automatic" and stored.cursor and cycle and stored.cursor < cycle
    )
    plan = db.scalar(plan_query(user, household_id, week).with_for_update())
    if not plan:
        previous = db.scalar(
            select(WorkoutPlan)
            .where(
                WorkoutPlan.household_id == household_id
                if household_id
                else WorkoutPlan.user_id == user.id,
                WorkoutPlan.week_start < week,
            )
            .order_by(WorkoutPlan.week_start.desc())
            .limit(1)
        )
        plan = WorkoutPlan(
            user_id=None if household_id else user.id, household_id=household_id, week_start=week
        )
        db.add(plan)
        db.flush()
        if previous and not due:
            eligible = template_query(user, household_id).with_only_columns(WorkoutTemplate.id)
            if household_id:
                eligible = eligible.where(WorkoutTemplateShare.discover_enabled.is_(True))
            allowed = set(db.scalars(eligible))
            old_slots = db.scalars(
                select(WorkoutPlanSlot)
                .where(WorkoutPlanSlot.plan_id == previous.id)
                .order_by(WorkoutPlanSlot.sort_order, WorkoutPlanSlot.id)
            ).all()
            for old in old_slots:
                if old.template_id not in allowed:
                    continue
                db.add(
                    WorkoutPlanSlot(
                        plan_id=plan.id,
                        template_id=old.template_id,
                        slot_date=week + (old.slot_date - previous.week_start)
                        if old.slot_date
                        else None,
                        sort_order=old.sort_order,
                        snapshot=deepcopy(old.snapshot),
                    )
                )
    elif due:
        clear_slots(db, plan)
    if stored and stored.mode == "automatic" and (due or stored.cursor is None):
        stored.cursor = cycle
    db.flush()
    return plan


def clear_slots(db: Session, plan: WorkoutPlan, slot_date: date | None = None) -> None:
    slots = db.scalars(
        select(WorkoutPlanSlot).where(WorkoutPlanSlot.plan_id == plan.id).with_for_update()
    ).all()
    ids = [slot.id for slot in slots if slot_date is None or slot.slot_date == slot_date]
    if not ids:
        return
    for proposal in db.scalars(
        select(WorkoutProposal).where(WorkoutProposal.planned_slot_id.in_(ids)).with_for_update()
    ):
        proposal.planned_slot_id = None
    for slot in slots:
        if slot.id in ids:
            db.delete(slot)
    db.flush()


def reset_plan(
    db: Session, user: User, household_id: str | None, slot_date: date | None
) -> dict[str, Any]:
    _, week = scope(db, user, household_id, owner=True)
    validate_date(week, slot_date)
    plan = ensure_plan(db, user, household_id, week)
    clear_slots(db, plan, slot_date)
    return serialize_plan(db, user, plan, read_only=False)


def serialize_slot(db: Session, user: User, slot: WorkoutPlanSlot) -> dict[str, Any]:
    return {
        "id": slot.id,
        "slot_date": slot.slot_date,
        "sort_order": slot.sort_order,
        "template_id": slot.template_id,
        "snapshot": render_snapshot(db, user, slot.snapshot),
    }


def serialize_plan(
    db: Session, user: User, plan: WorkoutPlan, *, read_only: bool
) -> dict[str, Any]:
    slots = db.scalars(
        select(WorkoutPlanSlot)
        .where(WorkoutPlanSlot.plan_id == plan.id)
        .order_by(WorkoutPlanSlot.sort_order, WorkoutPlanSlot.id)
    ).all()
    return {
        "id": plan.id,
        "week_start": plan.week_start,
        "read_only": read_only,
        "slots": [serialize_slot(db, user, slot) for slot in slots],
    }


def current_plan(db: Session, user: User, household_id: str | None) -> dict[str, Any]:
    _, week = scope(db, user, household_id)
    plan = ensure_plan(db, user, household_id, week)
    return serialize_plan(db, user, plan, read_only=False)


def process_due_resets(session_factory: Callable[[], Session] = SessionLocal) -> int:
    """Reconcile eligible automatic scopes in bounded pages and independent transactions."""
    processed = 0
    last_id = ""
    try:
        with session_factory() as scan:
            upper_id = scan.scalar(
                select(func.max(WorkoutPlanningPreference.id)).where(
                    WorkoutPlanningPreference.mode == "automatic"
                )
            )
        if not upper_id:
            return processed
        while last_id < upper_id:
            # Freeze the scan boundary and use keyset pages, never retain all preferences.
            with session_factory() as scan:
                ids = list(
                    scan.scalars(
                        select(WorkoutPlanningPreference.id)
                        .where(
                            WorkoutPlanningPreference.mode == "automatic",
                            WorkoutPlanningPreference.id > last_id,
                            WorkoutPlanningPreference.id <= upper_id,
                        )
                        .order_by(WorkoutPlanningPreference.id)
                        .limit(RESET_PAGE_SIZE)
                    )
                )
            if not ids:
                break
            last_id = ids[-1]
            for preference_id in ids:
                try:
                    with session_factory() as db, db.begin():
                        candidate = db.get(WorkoutPlanningPreference, preference_id)
                        if not candidate or candidate.mode != "automatic":
                            continue
                        household_id = candidate.household_id
                        user_id = candidate.user_id
                        if household_id:
                            owners = list(
                                db.scalars(
                                    select(HouseholdMember.user_id)
                                    .join(Household, Household.id == HouseholdMember.household_id)
                                    .where(
                                        HouseholdMember.household_id == household_id,
                                        HouseholdMember.role == "owner",
                                        Household.is_personal.is_(False),
                                    )
                                    .order_by(HouseholdMember.user_id)
                                    .limit(2)
                                )
                            )
                            if len(owners) != 1:
                                continue
                            user_id = owners[0]
                        user = db.scalar(
                            select(User)
                            .where(User.id == user_id)
                            .with_for_update()
                            .execution_options(populate_existing=True)
                        )
                        if not user or not user.is_active or not user.email_verified:
                            continue
                        if not is_basic_access_active(db, user):
                            continue
                        # Revalidate membership and settings only after acquiring scope locks.
                        _, week = scope(db, user, household_id, owner=True)
                        stored = preference(db, user, household_id)
                        if not stored or stored.id != preference_id or stored.mode != "automatic":
                            continue
                        today = planning.now_utc().astimezone(ZoneInfo(stored.time_zone)).date()
                        cycle = today - timedelta(days=(today.weekday() - stored.reset_day) % 7)
                        due = stored.cursor is None or stored.cursor < cycle
                        if not due and db.scalar(
                            plan_query(user, household_id, week).with_only_columns(WorkoutPlan.id)
                        ):
                            continue
                        ensure_plan(db, user, household_id, week)
                    processed += 1
                except Exception as exc:
                    logger.warning("workout_reset_failed", error_type=type(exc).__name__)
    except Exception as exc:
        logger.warning("workout_reset_scan_failed", error_type=type(exc).__name__)
    return processed


def history(db: Session, user: User, household_id: str | None, week: date) -> dict[str, Any]:
    _, current_week = scope(db, user, household_id)
    if week.weekday() != 0 or week >= current_week:
        raise HTTPException(422, "Choose a past week starting on Monday.")
    plan = db.scalar(plan_query(user, household_id, week))
    if not plan:
        raise HTTPException(404, "Workout history not found")
    return serialize_plan(db, user, plan, read_only=True)


def validate_date(week: date, slot_date: date | None) -> None:
    if slot_date is not None and not week <= slot_date < week + timedelta(days=7):
        raise HTTPException(422, "Choose a day in this week.")


def insert_slot(
    db: Session, plan: WorkoutPlan, template: WorkoutTemplate, slot_date: date | None
) -> WorkoutPlanSlot:
    validate_date(plan.week_start, slot_date)
    count, highest = db.execute(
        select(func.count(WorkoutPlanSlot.id), func.max(WorkoutPlanSlot.sort_order)).where(
            WorkoutPlanSlot.plan_id == plan.id
        )
    ).one()
    if count >= MAX_WEEKLY_SLOTS:
        raise HTTPException(422, "This workout week is full.")
    slot = WorkoutPlanSlot(
        plan_id=plan.id,
        template_id=template.id,
        slot_date=slot_date,
        sort_order=(highest if highest is not None else -1) + 1,
        snapshot=routine_snapshot(db, template, plan.household_id),
    )
    db.add(slot)
    db.flush()
    return slot


def add_slot(
    db: Session, user: User, household_id: str | None, template_id: str, slot_date: date | None
) -> WorkoutPlanSlot:
    _, week = scope(db, user, household_id, owner=True)
    template = require_template(db, user, template_id, household_id, enabled=True)
    validate_date(week, slot_date)
    return insert_slot(db, ensure_plan(db, user, household_id, week), template, slot_date)


def editable_slot(db: Session, user: User, slot_id: str) -> tuple[WorkoutPlanSlot, WorkoutPlan]:
    located = db.execute(
        select(WorkoutPlanSlot.plan_id, WorkoutPlan.user_id, WorkoutPlan.household_id)
        .join(WorkoutPlan, WorkoutPlanSlot.plan_id == WorkoutPlan.id)
        .where(WorkoutPlanSlot.id == slot_id)
    ).first()
    if not located or (not located.household_id and located.user_id != user.id):
        raise HTTPException(404, "Workout slot not found")
    _, week = scope(db, user, located.household_id, owner=True)
    plan = db.scalar(
        select(WorkoutPlan)
        .where(WorkoutPlan.id == located.plan_id)
        .with_for_update()
        .execution_options(populate_existing=True)
    )
    if not plan or plan.week_start != week:
        raise HTTPException(409, "Past workout plans are read-only.")
    ensure_plan(db, user, located.household_id, week)
    slot = db.scalar(
        select(WorkoutPlanSlot)
        .where(WorkoutPlanSlot.id == slot_id)
        .with_for_update()
        .execution_options(populate_existing=True)
    )
    if not slot:
        raise HTTPException(404, "Workout slot not found")
    return slot, plan


def update_slot(db: Session, user: User, slot_id: str, payload: SlotUpdateInput) -> WorkoutPlanSlot:
    slot, plan = editable_slot(db, user, slot_id)
    require_template(db, user, slot.template_id, plan.household_id, enabled=True)
    if "slot_date" in payload.model_fields_set:
        validate_date(plan.week_start, payload.slot_date)
        slot.slot_date = payload.slot_date
    if payload.sort_order is not None:
        slot.sort_order = payload.sort_order
    db.flush()
    return slot


def delete_slot(db: Session, user: User, slot_id: str) -> None:
    slot, _ = editable_slot(db, user, slot_id)
    for proposal in db.scalars(
        select(WorkoutProposal).where(WorkoutProposal.planned_slot_id == slot.id).with_for_update()
    ):
        proposal.planned_slot_id = None
    db.delete(slot)
    db.flush()


def reorder(
    db: Session, user: User, household_id: str | None, slot_ids: list[str]
) -> dict[str, Any]:
    _, week = scope(db, user, household_id, owner=True)
    plan = ensure_plan(db, user, household_id, week)
    slots = {
        slot.id: slot
        for slot in db.scalars(
            select(WorkoutPlanSlot).where(WorkoutPlanSlot.plan_id == plan.id).with_for_update()
        )
    }
    if len(slot_ids) != len(set(slot_ids)) or set(slot_ids) != slots.keys():
        raise HTTPException(409, "The workout plan changed. Refresh before reordering.")
    for order, slot_id in enumerate(slot_ids):
        slots[slot_id].sort_order = order
    db.flush()
    return serialize_plan(db, user, plan, read_only=False)


def account_export(db: Session, user: User) -> dict[str, Any]:
    def owned_snapshot(snapshot: dict[str, Any]) -> dict[str, Any]:
        return {
            key: deepcopy(snapshot.get(key))
            for key in ("id", "title", "category", "description", "exercises")
        }

    return {
        "templates": [
            owned_snapshot(serialize_template(row))
            for row in db.scalars(
                select(WorkoutTemplate).where(WorkoutTemplate.owner_id == user.id)
            )
        ],
        "performance_logs": [
            {
                "id": row.id,
                "performed_on": row.performed_on.isoformat(),
                "completed": row.completed,
                "notes": row.notes,
                "sets": row.sets,
                "exercise_details": row.exercise_details,
                "routine": owned_snapshot(row.snapshot),
            }
            for row in db.scalars(select(WorkoutLog).where(WorkoutLog.user_id == user.id))
        ],
        "personal_weeks": [
            {
                "week_start": plan.week_start.isoformat(),
                "slots": [
                    {
                        "slot_date": slot.slot_date.isoformat() if slot.slot_date else None,
                        "sort_order": slot.sort_order,
                        "routine": owned_snapshot(slot.snapshot),
                    }
                    for slot in db.scalars(
                        select(WorkoutPlanSlot).where(WorkoutPlanSlot.plan_id == plan.id)
                    )
                ],
            }
            for plan in db.scalars(select(WorkoutPlan).where(WorkoutPlan.user_id == user.id))
        ],
    }


def serialize_proposal(db: Session, user: User, proposal: WorkoutProposal) -> dict[str, Any]:
    count = (
        db.scalar(
            select(func.count())
            .select_from(WorkoutProposalMember)
            .where(WorkoutProposalMember.proposal_id == proposal.id)
        )
        or 0
    )
    return {
        "id": proposal.id,
        "household_id": proposal.household_id,
        "week_start": proposal.week_start,
        "template_id": proposal.template_id,
        "status": proposal.status,
        "snapshot": render_snapshot(db, user, proposal.snapshot),
        "planned_slot_id": proposal.planned_slot_id,
        "member_count": count,
    }


def propose(db: Session, user: User, household_id: str, template_id: str) -> WorkoutProposal:
    group, week = scope(db, user, household_id)
    assert group
    if is_owner(db, user, group):
        raise HTTPException(403, "The group owner can schedule workouts directly.")
    template = require_template(db, user, template_id, household_id, enabled=True)
    proposal = db.scalar(
        select(WorkoutProposal)
        .where(
            WorkoutProposal.household_id == household_id,
            WorkoutProposal.week_start == week,
            WorkoutProposal.template_id == template_id,
        )
        .with_for_update()
    )
    if not proposal:
        count = (
            db.scalar(
                select(func.count())
                .select_from(WorkoutProposal)
                .where(
                    WorkoutProposal.household_id == household_id, WorkoutProposal.week_start == week
                )
            )
            or 0
        )
        if count >= MAX_WEEKLY_PROPOSALS:
            raise HTTPException(422, "This workout week has too many proposals.")
        proposal = WorkoutProposal(
            household_id=household_id,
            week_start=week,
            template_id=template_id,
            snapshot=routine_snapshot(db, template, household_id),
        )
        db.add(proposal)
        db.flush()
    existing = db.scalar(
        select(WorkoutProposalMember.id).where(
            WorkoutProposalMember.proposal_id == proposal.id,
            WorkoutProposalMember.user_id == user.id,
        )
    )
    if proposal.status != "pending" and not existing:
        raise HTTPException(409, "This workout proposal has already been reviewed.")
    if not existing:
        db.add(WorkoutProposalMember(proposal_id=proposal.id, user_id=user.id))
        db.flush()
    return proposal


def proposals(
    db: Session, user: User, household_id: str, limit: int = 100, offset: int = 0
) -> dict[str, Any]:
    _, week = scope(db, user, household_id)
    query = select(WorkoutProposal).where(
        WorkoutProposal.household_id == household_id, WorkoutProposal.week_start == week
    )
    total = db.scalar(select(func.count()).select_from(query.subquery())) or 0
    rows = db.scalars(
        query.order_by(WorkoutProposal.created_at, WorkoutProposal.id).limit(limit).offset(offset)
    ).all()
    return {"items": [serialize_proposal(db, user, row) for row in rows], "total": total}


def decide(
    db: Session, user: User, proposal_id: str, action: str, slot_date: date | None
) -> WorkoutProposal:
    household_id = db.scalar(
        select(WorkoutProposal.household_id).where(WorkoutProposal.id == proposal_id)
    )
    if not household_id:
        raise HTTPException(404, "Workout proposal not found")
    _, week = scope(db, user, household_id, owner=True)
    proposal = db.scalar(
        select(WorkoutProposal)
        .where(WorkoutProposal.id == proposal_id)
        .with_for_update()
        .execution_options(populate_existing=True)
    )
    if not proposal:
        raise HTTPException(404, "Workout proposal not found")
    if proposal.week_start != week or proposal.status != "pending":
        raise HTTPException(409, "Only pending proposals in the current week can be reviewed.")
    if action == "approve":
        template = require_template(db, user, proposal.template_id, household_id, enabled=True)
        if proposal.snapshot != routine_snapshot(db, template, household_id):
            raise HTTPException(
                409, "The shared routine changed after this proposal was submitted."
            )
        validate_date(week, slot_date)
        slot = insert_slot(db, ensure_plan(db, user, household_id, week), template, slot_date)
        proposal.planned_slot_id = slot.id
        proposal.status = "approved"
    else:
        proposal.status = "rejected"
    db.flush()
    return proposal


def log_template(
    db: Session, user: User, template_id: str, household_id: str | None = None
) -> dict[str, Any]:
    if household_id:
        group_planning.authorize(db, user, household_id)
        template = require_template(db, user, template_id, household_id)
        return routine_snapshot(db, template, household_id)
    owner_id = db.scalar(select(WorkoutTemplate.owner_id).where(WorkoutTemplate.id == template_id))
    if owner_id == user.id:
        return serialize_template(require_template(db, user, template_id, None))
    if owner_id:
        household_id = db.scalar(
            select(WorkoutTemplateShare.household_id)
            .join(
                HouseholdMember, HouseholdMember.household_id == WorkoutTemplateShare.household_id
            )
            .join(Household, Household.id == WorkoutTemplateShare.household_id)
            .where(
                WorkoutTemplateShare.template_id == template_id,
                HouseholdMember.user_id == user.id,
                Household.is_personal.is_(False),
            )
            .order_by(WorkoutTemplateShare.household_id)
            .limit(1)
        )
        if household_id:
            # Match the group-before-template lock order used by scheduling and sharing.
            group_planning.authorize(db, user, household_id)
            template = require_template(db, user, template_id, household_id)
            return routine_snapshot(db, template, household_id)
    raise HTTPException(404, "Workout template not found")


def save_log(db: Session, user: User, request_uuid: str, payload: LogInput) -> WorkoutLog:
    lock_user(db, user)
    if payload.performed_on > planning.local_today(user):
        raise HTTPException(422, "A performance log cannot be in the future.")
    log = db.scalar(
        select(WorkoutLog)
        .where(
            WorkoutLog.user_id == user.id,
            WorkoutLog.request_uuid == request_uuid,
        )
        .with_for_update()
        .execution_options(populate_existing=True)
    )
    template_id = str(payload.template_id)
    if log:
        if log.template_id != template_id:
            raise HTTPException(409, "A log's routine cannot be changed. Use a new request UUID.")
        snapshot = log.snapshot
    else:
        if payload.plan_slot_id:
            slot = db.get(WorkoutPlanSlot, str(payload.plan_slot_id))
            plan = db.get(WorkoutPlan, slot.plan_id) if slot else None
            if not slot or not plan or slot.template_id != template_id:
                raise HTTPException(404, "Scheduled workout not found")
            if plan.household_id:
                group_planning.authorize(db, user, plan.household_id)
            elif plan.user_id != user.id:
                raise HTTPException(404, "Scheduled workout not found")
            snapshot = deepcopy(slot.snapshot)
        else:
            snapshot = log_template(
                db, user, template_id, str(payload.household_id) if payload.household_id else None
            )
    if payload.expected_revision and payload.expected_revision != routine_revision(snapshot):
        raise HTTPException(
            409, "This routine changed. Review the workout before saving the session."
        )
    if any(item.exercise_index >= len(snapshot["exercises"]) for item in payload.sets):
        raise HTTPException(422, "A set references an exercise outside the routine snapshot.")
    if any(item.exercise_index >= len(snapshot["exercises"]) for item in payload.exercise_details):
        raise HTTPException(422, "Exercise details are outside the routine snapshot.")
    values = payload.model_dump(
        mode="json",
        exclude={
            "template_id",
            "performed_on",
            "expected_revision",
            "plan_slot_id",
            "household_id",
        },
    )
    values["performed_on"] = payload.performed_on
    if not log:
        log = WorkoutLog(
            user_id=user.id,
            request_uuid=request_uuid,
            template_id=template_id,
            snapshot=deepcopy(snapshot),
            **values,
        )
        db.add(log)
    elif (
        log.performed_on != payload.performed_on
        or log.completed != payload.completed
        or log.notes != payload.notes
        or log.sets != values["sets"]
        or log.exercise_details != values["exercise_details"]
    ):
        for key, value in values.items():
            setattr(log, key, value)
    db.flush()
    return log


def serialize_log(db: Session, user: User, log: WorkoutLog) -> dict[str, Any]:
    return {
        "id": log.id,
        "request_uuid": log.request_uuid,
        "template_id": log.template_id,
        "performed_on": log.performed_on,
        "completed": log.completed,
        "notes": log.notes,
        "sets": deepcopy(log.sets),
        "exercise_details": deepcopy(log.exercise_details),
        "snapshot": render_snapshot(db, user, log.snapshot),
    }


def logs(db: Session, user: User, limit: int, offset: int) -> dict[str, Any]:
    rows = db.scalars(
        select(WorkoutLog)
        .where(WorkoutLog.user_id == user.id)
        .order_by(WorkoutLog.performed_on.desc(), WorkoutLog.id)
        .limit(limit)
        .offset(offset)
    ).all()
    return {"items": [serialize_log(db, user, row) for row in rows]}


def progress(db: Session, user: User) -> dict[str, Any]:
    completed = 0
    volume = 0.0
    duration = 0
    exercises: dict[str, dict[str, Any]] = {}
    rows = db.scalars(
        select(WorkoutLog)
        .where(WorkoutLog.user_id == user.id, WorkoutLog.completed.is_(True))
        .order_by(WorkoutLog.performed_on, WorkoutLog.id)
        .execution_options(yield_per=100)
    )
    for log in rows:
        completed += 1
        session_exercises: set[str] = set()
        for item in log.sets:
            name = log.snapshot["exercises"][item["exercise_index"]]["name"]
            key = name.casefold()
            aggregate = exercises.setdefault(
                key,
                {
                    "name": name,
                    "sessions_completed": 0,
                    "sets_completed": 0,
                    "total_reps": 0,
                    "total_volume_kg": 0.0,
                    "total_duration_seconds": 0,
                    "max_weight_kg": 0.0,
                    "last_performed_on": log.performed_on,
                },
            )
            reps = item.get("reps") or 0
            weight = item.get("weight_kg") or 0.0
            seconds = item.get("duration_seconds") or 0
            volume += reps * weight
            duration += seconds
            aggregate["sets_completed"] += 1
            aggregate["total_reps"] += reps
            aggregate["total_volume_kg"] += reps * weight
            aggregate["total_duration_seconds"] += seconds
            aggregate["max_weight_kg"] = max(aggregate["max_weight_kg"], weight)
            aggregate["last_performed_on"] = log.performed_on
            session_exercises.add(key)
        for key in session_exercises:
            exercises[key]["sessions_completed"] += 1
    for aggregate in exercises.values():
        aggregate["total_volume_kg"] = round(aggregate["total_volume_kg"], 6)
    return {
        "sessions_completed": completed,
        "total_volume_kg": round(volume, 6),
        "total_duration_seconds": duration,
        "exercises": [exercises[key] for key in sorted(exercises)],
    }
