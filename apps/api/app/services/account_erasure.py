"""Account erasure is atomic for database data; private-file cleanup is retryable."""

from __future__ import annotations

from collections.abc import Iterator
from contextlib import contextmanager
from datetime import datetime, timedelta
from hashlib import sha256
from itertools import batched
from pathlib import Path
from typing import Any

import structlog
from fastapi import HTTPException
from sqlalchemy import delete, func, select, tuple_, update
from sqlalchemy.orm import Session

from app.core.config import settings
from app.core.security import verify_password
from app.models.account_erasure import AccountErasure, DetachedBillingReference, ErasureMediaTask
from app.models.base import Base
from app.models.entities import (
    AuditEvent,
    Household,
    HouseholdMember,
    MealMacroConfirmation,
    Recipe,
    User,
    UserSubscription,
    ValidationResult,
    uuid_str,
)
from app.models.native_billing import NativeBillingAccount, NativePurchase
from app.models.nutrition import NutritionCall
from app.models.security import MediaObject
from app.models.workouts import WorkoutLog, WorkoutPlanSlot, WorkoutTemplate
from app.services.media_maintenance import referenced
from app.services.media_storage import get_media_storage
from app.services.private_media import LOCAL_KEY

CUSTODIAN_ID = "00000000-0000-4000-8000-000000000001"
RECEIPT_TABLES = {"account_erasures", "account_erasure_media_tasks", "detached_billing_references"}
logger = structlog.get_logger()


@contextmanager
def erasure_transaction(db: Session) -> Iterator[None]:
    previous = db.info.get("account_erasure_write")
    db.info["account_erasure_write"] = True
    try:
        yield
    finally:
        if previous is None:
            db.info.pop("account_erasure_write", None)
        else:
            db.info["account_erasure_write"] = previous


def _groups(db: Session, user_id: str, *, lock: bool = False) -> list[tuple[Household, str]]:
    ids = list(
        db.scalars(select(HouseholdMember.household_id).where(HouseholdMember.user_id == user_id))
    )
    query = select(Household).where(Household.id.in_(ids)).order_by(Household.id)
    if lock:
        query = query.with_for_update().execution_options(populate_existing=True)
    groups = list(db.scalars(query))
    result = []
    for group in groups:
        role = db.scalar(
            select(HouseholdMember.role).where(
                HouseholdMember.household_id == group.id, HouseholdMember.user_id == user_id
            )
        )
        if role:
            result.append((group, role))
    return result


def deletion_preflight(db: Session, user: User) -> dict[str, Any]:
    groups = _groups(db, user.id)
    owned = [
        {"id": group.id, "name": group.name}
        for group, role in groups
        if not group.is_personal and role == "owner"
    ]
    subscription = db.scalar(select(UserSubscription).where(UserSubscription.user_id == user.id))
    billing = bool(
        subscription
        and subscription.source == "stripe"
        and (subscription.stripe_subscription_id or subscription.stripe_customer_id)
    )
    providers = ["stripe"] if billing else []
    native_providers = db.scalars(
        select(NativePurchase.provider)
        .join(NativeBillingAccount)
        .where(
            NativeBillingAccount.user_id == user.id,
            NativePurchase.superseded.is_(False),
        )
        .distinct()
    )
    providers.extend(provider for provider in native_providers if provider not in providers)
    personal_ids = [group.id for group, _ in groups if group.is_personal]
    personal_conflict = bool(
        db.scalar(
            select(HouseholdMember.id)
            .where(
                HouseholdMember.household_id.in_(personal_ids), HouseholdMember.user_id != user.id
            )
            .limit(1)
        )
    )
    return {
        "enabled": settings.account_erasure_enabled,
        "can_delete": settings.account_erasure_enabled and not owned and not personal_conflict,
        "ownership_transfers": owned,
        "billing_acknowledgement_required": bool(providers),
        "billing_provider": providers[0] if providers else None,
        "billing_providers": providers,
        "shared_content_retained": False,
        "independent_records_preserved": True,
        "backup_retention_finalized": False,
        "personal_space_requires_review": personal_conflict,
    }


def _custodian(db: Session) -> User:
    user = db.get(User, CUSTODIAN_ID)
    if user is None:
        user = User(
            id=CUSTODIAN_ID,
            email=f"retained-{uuid_str()}@accounts.invalid",
            password_hash="!",  # noqa: S106 - deliberately unusable; inactive system custodian.
            is_active=False,
            email_verified=False,
        )
        db.add(user)
        db.flush()
    if user.is_active or user.password_hash != "!":
        raise RuntimeError("Retained-content custodian is not safe")
    return user


def _detach_independent_history(db: Session, user_id: str) -> tuple[set[str], set[str]]:
    recipes = set(db.scalars(select(Recipe.id).where(Recipe.owner_user_id == user_id)))
    workouts = set(
        db.scalars(select(WorkoutTemplate.id).where(WorkoutTemplate.owner_id == user_id))
    )
    for ids in batched(recipes, 500):
        db.execute(
            update(MealMacroConfirmation)
            .where(
                MealMacroConfirmation.user_id != user_id, MealMacroConfirmation.recipe_id.in_(ids)
            )
            .values(recipe_id=None)
        )
        slots = Base.metadata.tables["weekly_plan_slots"]
        db.execute(
            update(slots)
            .where(slots.c.recipe_id.in_(ids))
            .values(
                recipe_id=None,
                history_snapshot={
                    "recipe_id": None,
                    "recipe_name": "Deleted recipe",
                    "source_deleted": True,
                },
            )
        )
    for ids in batched(workouts, 500):
        for slot in db.scalars(select(WorkoutPlanSlot).where(WorkoutPlanSlot.template_id.in_(ids))):
            slot.template_id = None
            slot.snapshot = {
                "id": slot.id,
                "title": "Deleted workout",
                "category": slot.snapshot.get("category", "full_body"),
                "exercises": [],
                "owner_id": "",
                "source_deleted": True,
            }
        for log in db.scalars(
            select(WorkoutLog).where(WorkoutLog.template_id.in_(ids), WorkoutLog.user_id != user_id)
        ):
            log.template_id = None
            # Keep personal performance labels, not the original author's instructions or photo.
            log.snapshot = {
                "id": log.request_uuid,
                "title": "Workout session",
                "category": log.snapshot.get("category", "full_body"),
                "exercises": [
                    {"name": item.get("name", "Exercise")}
                    for item in log.snapshot.get("exercises", [])
                ],
                "owner_id": log.user_id,
                "source_deleted": True,
            }
    db.flush()
    return recipes, workouts


def _deletion_closure(db: Session, user_id: str, personal: set[str]) -> dict[str, set[str]]:
    """Follow actual composite FK constraints, never heuristic name/string matching."""
    selected: dict[str, set[str]] = {"users": {user_id}, "households": set(personal)}
    changed = True
    while changed:
        changed = False
        for child in Base.metadata.sorted_tables:
            if child.name in RECEIPT_TABLES:
                continue
            for constraint in child.foreign_key_constraints:
                parent = next(iter(constraint.elements)).column.table
                ids = selected.get(parent.name)
                if not ids:
                    continue
                if len(parent.primary_key.columns) != 1 or len(child.primary_key.columns) != 1:
                    raise RuntimeError("Unreviewed composite primary key in erasure graph")
                parent_pk = next(iter(parent.primary_key.columns))
                child_pk = next(iter(child.primary_key.columns))
                elements = list(constraint.elements)
                found: set[str] = set()
                for batch in batched(ids, 500):
                    values = [
                        tuple(row)
                        for row in db.execute(
                            select(*(item.column for item in elements)).where(parent_pk.in_(batch))
                        )
                        if all(value is not None for value in row)
                    ]
                    if values:
                        condition = tuple_(*(item.parent for item in elements)).in_(values)
                        found.update(
                            str(value) for value in db.scalars(select(child_pk).where(condition))
                        )
                before = len(selected.setdefault(child.name, set()))
                selected[child.name].update(str(value) for value in found)
                changed |= len(selected[child.name]) != before
        if sum(map(len, selected.values())) > 100_000:
            raise RuntimeError("Erasure graph exceeds the reviewed transaction budget")
    # Unknown sharing relationships must abort, not delete another person's data.
    for name, ids in selected.items():
        table = Base.metadata.tables[name]
        pk = next(iter(table.primary_key.columns))
        user_columns = {fk.parent for fk in table.foreign_keys if fk.column.table.name == "users"}
        reference_only = {
            "favorites",
            "hidden_recipes",
            "meal_swipes",
            "household_votes",
            "weekly_plan_votes",
            "meal_proposal_members",
            "workout_proposal_members",
            "nutrition_calculations",
        }
        for column in user_columns:
            if name in reference_only:
                continue
            for batch in batched(ids, 500):
                if db.scalar(
                    select(pk).where(pk.in_(batch), column.is_not(None), column != user_id).limit(1)
                ):
                    raise RuntimeError(f"Cross-account reference prevents unsafe erasure: {name}")
    return selected


def _scrub(value: Any, user_id: str, email: str) -> Any:
    if isinstance(value, dict):
        return {
            key: _scrub(item, user_id, email)
            for key, item in value.items()
            if not (
                key in {"owner_user_id", "owner_id", "user_id", "email", "created_by"}
                and isinstance(item, str)
                and item in {user_id, email}
            )
        }
    if isinstance(value, list):
        return [_scrub(item, user_id, email) for item in value]
    if isinstance(value, str) and value in {user_id, email}:
        return "[deleted]"
    return value


def _erase_database(db: Session, job: AccountErasure) -> None:
    user = db.scalar(
        select(User)
        .where(User.id == job.user_id)
        .with_for_update()
        .execution_options(populate_existing=True)
    )
    if user is None:
        raise RuntimeError("Erasure account disappeared without a committed receipt")
    groups = _groups(db, user.id, lock=True)
    if any(role == "owner" and not group.is_personal for group, role in groups):
        raise RuntimeError("Group ownership changed after confirmation")
    personal = {group.id for group, _ in groups if group.is_personal}
    if db.scalar(
        select(HouseholdMember.id)
        .where(HouseholdMember.household_id.in_(personal), HouseholdMember.user_id != user.id)
        .limit(1)
    ):
        raise RuntimeError("Personal space has another member; refusing collateral deletion")
    db.execute(
        select(Recipe.id)
        .where(Recipe.owner_user_id == user.id)
        .order_by(Recipe.id)
        .with_for_update()
    ).all()
    db.execute(
        select(WorkoutTemplate.id)
        .where(WorkoutTemplate.owner_id == user.id)
        .order_by(WorkoutTemplate.id)
        .with_for_update()
    ).all()
    authored_recipes, authored_workouts = _detach_independent_history(db, user.id)
    subscription = db.scalar(select(UserSubscription).where(UserSubscription.user_id == user.id))
    if subscription and (subscription.stripe_subscription_id or subscription.stripe_customer_id):
        db.add(
            DetachedBillingReference(
                erasure_id=job.id,
                provider="stripe",
                subscription_id=subscription.stripe_subscription_id,
                customer_id=subscription.stripe_customer_id,
                status=subscription.status,
            )
        )
    # Native billing retains minimal chain ownership, never a claimable deleted account.
    native_account = db.scalar(
        select(NativeBillingAccount)
        .where(NativeBillingAccount.user_id == user.id)
        .with_for_update()
    )
    if native_account:
        db.execute(
            update(NativePurchase)
            .where(NativePurchase.account_id == native_account.id)
            .values(
                valid_until=None,
                ack_pending=False,
                reference_encrypted="",
                state="account_deleted",
                superseded=True,
            )
        )
        native_account.user_id = None
        native_account.deleted_at = datetime.utcnow()
    imports = Base.metadata.tables["import_files"]
    batches = Base.metadata.tables["import_batches"]
    if db.scalar(
        select(imports.c.id)
        .join(batches, imports.c.import_batch_id == batches.c.id)
        .where(batches.c.user_id == user.id, imports.c.stored_path != "discarded_after_parse")
        .limit(1)
    ):
        raise RuntimeError("Legacy import file requires a reviewed storage cleanup")
    if settings.media_storage_backend == "local":
        root = Path(settings.image_storage_path).resolve()
        directory = root / "uploads" / user.id
        if directory.is_symlink():
            raise RuntimeError("Unsafe legacy media directory")
        if directory.exists():
            for path in directory.iterdir():
                key = path.relative_to(root).as_posix()
                if path.is_symlink() or not path.is_file() or not LOCAL_KEY.fullmatch(key):
                    raise RuntimeError("Unreviewed legacy media object")
                if not db.scalar(select(MediaObject.id).where(MediaObject.storage_key == key)):
                    db.add(
                        MediaObject(
                            owner_user_id=user.id,
                            storage_key=key,
                            backend="local",
                            content_type="image/jpeg",
                            size_bytes=path.stat().st_size,
                            managed=False,
                        )
                    )
    db.flush()
    # Move only still-referenced media to restricted custody; mark all others unreadable.
    # Private recipe/job rows are removed before testing remaining references below.
    owned_media = list(
        db.scalars(
            select(MediaObject).where(MediaObject.owner_user_id == user.id).with_for_update()
        )
    )
    custodian = _custodian(db) if owned_media else None
    for media in owned_media:
        assert custodian is not None
        media.owner_user_id = custodian.id
    db.flush()
    selected = _deletion_closure(db, user.id, personal)
    all_ids = {value for ids in selected.values() for value in ids}
    for validation_ids in batched(all_ids, 500):
        db.execute(delete(ValidationResult).where(ValidationResult.entity_id.in_(validation_ids)))
    db.execute(update(NutritionCall).where(NutritionCall.user_id == user.id).values(user_id=None))
    for table in reversed(Base.metadata.sorted_tables):
        ids = selected.get(table.name)
        if ids:
            pk = next(iter(table.primary_key.columns))
            for batch in batched(ids, 500):
                db.execute(delete(table).where(pk.in_(batch)))
    db.execute(update(AuditEvent).where(AuditEvent.entity_id == user.id).values(entity_id=None))
    # Remove deleted identifiers, without altering other actors' shared metadata.
    for name, columns in {
        "audit_events": ["payload"],
        "weekly_plan_slots": ["history_snapshot"],
        "workout_plan_slots": ["snapshot"],
        "workout_proposals": ["snapshot"],
        "workout_template_shares": ["snapshot"],
        "recipe_sources": ["provenance"],
    }.items():
        table = Base.metadata.tables[name]
        for row in db.execute(select(table.c.id, *(table.c[column] for column in columns))):
            values = {
                column: _scrub(row[index + 1], user.id, user.email)
                for index, column in enumerate(columns)
            }
            changed = {
                column: value
                for index, (column, value) in enumerate(values.items())
                if value != row[index + 1]
            }
            if changed:
                db.execute(update(table).where(table.c.id == row[0]).values(**changed))
    db.flush()
    for media in owned_media:
        if not referenced(db, media):
            media.deleted_at = datetime.utcnow()
            db.add(
                ErasureMediaTask(
                    erasure_id=job.id,
                    kind="media",
                    object_id=media.id,
                    storage_key=media.storage_key,
                    backend=media.backend,
                )
            )
    job.report = {
        "database_erased": True,
        "authored_recipes_erased": len(authored_recipes),
        "authored_workouts_erased": len(authored_workouts),
        "deleted_rows": sum(map(len, selected.values())),
        "subscription_canceled": False,
    }
    job.user_id = None
    job.status = "cleanup_pending"
    db.commit()


def _retry_delay(attempts: int) -> timedelta:
    return timedelta(seconds=min(21600, 30 * 2 ** min(attempts, 10)))


def process_erasure(db: Session, job_id: str) -> dict[str, Any]:
    try:
        return _process_erasure(db, job_id)
    except Exception:
        db.rollback()
        with erasure_transaction(db):
            job = db.scalar(
                select(AccountErasure)
                .where(AccountErasure.id == job_id)
                .with_for_update()
                .execution_options(populate_existing=True)
            )
            if job and job.status != "complete":
                job.attempts += 1
                job.last_error_code = (
                    "database_cleanup_failed" if job.user_id else "media_cleanup_failed"
                )
                job.next_attempt_at = datetime.utcnow() + _retry_delay(job.attempts)
                db.commit()
        raise


def _process_erasure(db: Session, job_id: str) -> dict[str, Any]:
    with erasure_transaction(db):
        job = db.scalar(
            select(AccountErasure)
            .where(AccountErasure.id == job_id)
            .with_for_update()
            .execution_options(populate_existing=True)
        )
        if not job:
            raise RuntimeError("Unknown erasure receipt")
        if job.status == "complete":
            return {"status": "complete", "receipt_id": job.id}
        job.attempts += 1
        job.last_error_code = None
        if job.user_id:
            _erase_database(db, job)
        tasks = list(
            db.scalars(
                select(ErasureMediaTask)
                .where(ErasureMediaTask.erasure_id == job.id)
                .with_for_update()
            )
        )
        storage = get_media_storage()
        for task in tasks:
            if task.backend != storage.backend:
                continue
            try:
                storage.delete(task.storage_key)
            except (OSError, ValueError):
                continue
            if task.object_id:
                db.execute(
                    delete(MediaObject).where(
                        MediaObject.id == task.object_id, MediaObject.deleted_at.is_not(None)
                    )
                )
            db.delete(task)
        db.flush()
        remaining = db.scalar(
            select(func.count())
            .select_from(ErasureMediaTask)
            .where(ErasureMediaTask.erasure_id == job.id)
        )
        if not remaining:
            job.status = "complete"
            job.completed_at = datetime.utcnow()
        else:
            job.last_error_code = "media_cleanup_pending"
            job.next_attempt_at = datetime.utcnow() + _retry_delay(job.attempts)
        db.commit()
        return {"status": job.status, "receipt_id": job.id}


def confirm_erasure(
    db: Session, user: User, password: str, billing_acknowledged: bool
) -> dict[str, Any]:
    if not settings.account_erasure_enabled:
        raise HTTPException(
            503, "Account erasure is not enabled. The existing request path remains available."
        )
    with erasure_transaction(db):
        loaded = db.scalar(
            select(User)
            .where(User.id == user.id)
            .with_for_update()
            .execution_options(populate_existing=True)
        )
        if (
            not loaded
            or not loaded.is_active
            or not verify_password(password, loaded.password_hash)
        ):
            raise HTTPException(401, "Current password is incorrect or the account is unavailable.")
        user = loaded
        _groups(db, user.id, lock=True)
        preflight = deletion_preflight(db, user)
        if preflight["ownership_transfers"]:
            raise HTTPException(
                409, "Transfer ownership of your non-personal groups before deleting your account."
            )
        if preflight["personal_space_requires_review"]:
            raise HTTPException(
                409, "Your Personal space has another member and requires review before erasure."
            )
        if preflight["billing_acknowledgement_required"] and not billing_acknowledged:
            raise HTTPException(
                409, "Acknowledge that account deletion does not cancel your subscription."
            )
        job = AccountErasure(user_id=user.id, subject_hash=sha256(user.id.encode()).hexdigest())
        db.add(job)
        user.is_active = False
        user.session_version += 1
        db.commit()
        job_id = job.id
    try:
        return process_erasure(db, job_id)
    except Exception as exc:
        db.rollback()
        logger.warning(
            "account_erasure_retry_required", receipt_id=job_id, error_type=type(exc).__name__
        )
        # Account access remains revoked; a worker retries the durable receipt.
        return {"status": "pending", "receipt_id": job_id}


def process_pending_erasures(db: Session) -> int:
    if not settings.account_erasure_enabled:
        return 0
    ids = list(
        db.scalars(
            select(AccountErasure.id)
            .where(
                AccountErasure.status != "complete",
                AccountErasure.next_attempt_at <= datetime.utcnow(),
            )
            .order_by(AccountErasure.next_attempt_at, AccountErasure.id)
            .limit(20)
        )
    )
    for job_id in ids:
        try:
            process_erasure(db, job_id)
        except Exception as exc:
            db.rollback()
            logger.warning(
                "account_erasure_retry_required", receipt_id=job_id, error_type=type(exc).__name__
            )
    return len(ids)
