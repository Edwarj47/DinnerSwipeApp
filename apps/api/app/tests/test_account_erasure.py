from datetime import date, datetime, timedelta
from pathlib import Path
from typing import Any
from unittest.mock import Mock

import pytest
from fastapi import HTTPException
from fastapi.testclient import TestClient
from sqlalchemy import select, update
from sqlalchemy.orm import Session

from app.core.config import settings
from app.database.session import reject_revoked_account_writes
from app.models.account_erasure import AccountErasure, DetachedBillingReference, ErasureMediaTask
from app.models.entities import (
    AuditEvent,
    Favorite,
    Household,
    HouseholdMember,
    HouseholdRecipe,
    MealMacroConfirmation,
    Recipe,
    RefreshToken,
    User,
    UserSubscription,
    WeeklyPlan,
    WeeklyPlanSlot,
)
from app.models.security import MediaObject
from app.models.workouts import WorkoutLog, WorkoutTemplate
from app.services.account_erasure import process_erasure, process_pending_erasures
from app.services.media_storage import LocalMediaStorageAdapter
from app.services.private_media import object_url

PASSWORD = "change-me-123"


@pytest.fixture(autouse=True)
def isolated_media(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(settings, "image_storage_path", str(tmp_path))
    monkeypatch.setattr(settings, "media_storage_backend", "local")
    monkeypatch.setattr(settings, "account_erasure_enabled", True)


def account(client: TestClient, db: Session, email: str) -> tuple[User, dict[str, str]]:
    response = client.post(
        "/api/v1/auth/register",
        json={
            "email": email,
            "password": PASSWORD,
            "terms_accepted": True,
            "privacy_accepted": True,
        },
    )
    assert response.status_code == 200
    user = db.scalars(select(User).where(User.email == email)).one()
    user.email_verified = True
    db.add(
        UserSubscription(
            user_id=user.id,
            plan_key="basic_monthly",
            status="active",
            source="waiver_code",
            metadata_json={"fixture": "basic_access"},
        )
    )
    db.commit()
    return user, {"Authorization": "Bearer " + response.json()["access_token"]}


def recipe(db: Session, user: User, name: str = "Private test recipe") -> Recipe:
    row = Recipe(owner_user_id=user.id, name=name, content_hash=name, servings=1)
    db.add(row)
    db.commit()
    return row


def erase(client: TestClient, headers: dict[str, str], **changes: object) -> Any:
    return client.post(
        "/api/v1/auth/account/erase",
        headers=headers,
        json={"current_password": PASSWORD, "confirmation": "DELETE", **changes},
    )


def test_disposable_account_is_erased_and_other_account_and_tokens_are_isolated(
    client: TestClient, db_session: Session, auth_headers: dict[str, str]
) -> None:
    owner = db_session.scalars(select(User).where(User.email == "owner@example.com")).one()
    owner_id = owner.id
    other, other_headers = account(client, db_session, "erasure-survivor@example.com")
    private = recipe(db_session, owner)
    survivor = recipe(db_session, other, "Surviving recipe")
    private_id, survivor_id, other_id = private.id, survivor.id, other.id
    db_session.add_all(
        [
            Favorite(user_id=owner_id, recipe_id=private.id),
            MealMacroConfirmation(
                user_id=owner_id,
                meal_date=date.today(),
                entry_name="Private meal",
                notes="Private health note",
            ),
            AuditEvent(user_id=owner_id, event_type="private", payload={"email": owner.email}),
        ]
    )
    db_session.commit()
    result = erase(client, auth_headers)
    assert result.status_code == 200
    assert result.json()["status"] == "complete"
    db_session.expire_all()
    assert db_session.get(User, owner_id) is None
    assert db_session.get(Recipe, private_id) is None
    assert db_session.get(Recipe, survivor_id) is not None
    surviving_user = db_session.get(User, other_id)
    assert surviving_user is not None and surviving_user.is_active
    assert db_session.query(RefreshToken).filter_by(user_id=owner_id).count() == 0
    assert db_session.query(MealMacroConfirmation).filter_by(user_id=owner_id).count() == 0
    assert client.get("/api/v1/auth/status", headers=auth_headers).status_code == 401
    assert client.get("/api/v1/auth/status", headers=other_headers).status_code == 200
    assert (
        client.post(
            "/api/v1/auth/login", json={"email": "owner@example.com", "password": PASSWORD}
        ).status_code
        == 401
    )
    receipt = db_session.get(AccountErasure, result.json()["receipt_id"])
    assert receipt is not None
    assert receipt.user_id is None and receipt.completed_at is not None
    assert "owner@example.com" not in str(receipt.report)
    assert process_erasure(db_session, receipt.id)["status"] == "complete"


def test_password_confirmation_and_account_binding_fail_before_erasure(
    client: TestClient, db_session: Session, auth_headers: dict[str, str]
) -> None:
    assert (
        erase(client, auth_headers, **{"current_password": "incorrect-password"}).status_code == 401
    )
    assert erase(client, auth_headers, confirmation="delete").status_code == 422
    assert erase(client, {**auth_headers, "X-Dinner-Account": "another-account"}).status_code == 409
    assert db_session.query(AccountErasure).count() == 0
    assert db_session.query(User).filter_by(email="owner@example.com").one().is_active


def test_failed_database_erasure_is_durable_and_not_retried_before_due(
    client: Any, db_session: Any, auth_headers: Any, monkeypatch: Any
) -> None:
    from app.services import account_erasure as service

    original = service._erase_database
    failure = Mock(side_effect=RuntimeError("synthetic private failure not exposed"))
    monkeypatch.setattr(service, "_erase_database", failure)
    result = erase(client, auth_headers)
    assert result.status_code == 200 and result.json()["status"] == "pending"
    job = db_session.get(AccountErasure, result.json()["receipt_id"])
    assert job.attempts == 1 and job.next_attempt_at > datetime.utcnow()
    assert job.last_error_code == "database_cleanup_failed"
    assert not db_session.get(User, job.user_id).is_active
    assert process_pending_erasures(db_session) == 0
    assert failure.call_count == 1
    job.next_attempt_at = datetime.utcnow() - timedelta(seconds=1)
    db_session.commit()
    monkeypatch.setattr(service, "_erase_database", original)
    assert process_pending_erasures(db_session) == 1
    assert job.status == "complete" and job.last_error_code is None


def test_erased_account_cannot_create_late_non_fk_nutrition_usage(
    client: Any, db_session: Any, auth_headers: Any
) -> None:
    from sqlalchemy.orm import sessionmaker

    from app.models.nutrition import NutritionCall, NutritionProviderState
    from app.services.nutrition_budget import NutritionBudget, NutritionError

    owner_id = db_session.scalar(select(User.id))
    db_session.add(NutritionProviderState(provider="fatsecret"))
    db_session.commit()
    assert erase(client, auth_headers).json()["status"] == "complete"
    budget = NutritionBudget(sessionmaker(bind=db_session.get_bind()), settings)
    with pytest.raises(NutritionError, match="account_unavailable"):
        budget.reserve("foods.search", user_id=owner_id)
    assert db_session.query(NutritionCall).count() == 0


def test_non_personal_owner_must_transfer_but_other_members_are_not_blocked(
    client: TestClient, db_session: Session, auth_headers: dict[str, str]
) -> None:
    owner = db_session.query(User).filter_by(email="owner@example.com").one()
    group = Household(name="Shared test group", is_personal=False)
    db_session.add(group)
    db_session.flush()
    db_session.add(HouseholdMember(household_id=group.id, user_id=owner.id, role="owner"))
    db_session.commit()
    preflight = client.get("/api/v1/auth/account/deletion", headers=auth_headers)
    assert preflight.json()["ownership_transfers"] == [{"id": group.id, "name": group.name}]
    assert preflight.headers["cache-control"] == "no-store"
    assert erase(client, auth_headers).status_code == 409
    assert db_session.query(AccountErasure).count() == 0
    assert owner.is_active


def test_shared_originals_are_deleted_and_independent_records_survive(
    client: TestClient, db_session: Session, auth_headers: dict[str, str]
) -> None:
    owner = db_session.query(User).filter_by(email="owner@example.com").one()
    owner_id = owner.id
    other, other_headers = account(client, db_session, "shared-survivor@example.com")
    _, stranger_headers = account(client, db_session, "erasure-stranger@example.com")
    shared = recipe(db_session, owner, "Deliberately shared meal")
    shared_id = shared.id
    copy_id = recipe(db_session, other, "Independent saved copy").id
    entry = MealMacroConfirmation(
        user_id=other.id,
        recipe_id=shared_id,
        meal_date=date.today(),
        entry_name="My lunch",
        calories=400,
        protein_g=30,
        notes="Independent personal note",
    )
    db_session.add(entry)
    group = Household(name="Other owner's group", is_personal=False)
    db_session.add(group)
    db_session.flush()
    db_session.add_all(
        [
            HouseholdMember(household_id=group.id, user_id=owner_id, role="member"),
            HouseholdMember(household_id=group.id, user_id=other.id, role="owner"),
            HouseholdRecipe(household_id=group.id, recipe_id=shared_id),
        ]
    )
    plan = WeeklyPlan(household_id=group.id, week_start=date(2026, 11, 16))
    db_session.add(plan)
    db_session.flush()
    slot = WeeklyPlanSlot(
        weekly_plan_id=plan.id,
        recipe_id=shared_id,
        history_snapshot={"name": shared.name, "owner_user_id": owner_id},
    )
    unrelated = AuditEvent(
        user_id=other.id,
        event_type="unchanged",
        payload={"owner_id": other.id, "email": other.email},
    )
    db_session.add_all([slot, unrelated])
    other.profile.household_id = group.id
    db_session.commit()
    db_session.execute(
        update(WeeklyPlanSlot)
        .where(WeeklyPlanSlot.id == slot.id)
        .values(history_snapshot={"name": shared.name, "owner_user_id": owner_id})
    )
    db_session.commit()
    result = erase(client, auth_headers)
    assert result.json()["status"] == "complete"
    db_session.expire_all()
    assert db_session.get(Recipe, shared_id) is None
    assert db_session.get(Recipe, copy_id) is not None
    assert db_session.get(User, owner_id) is None
    kept_slot = db_session.get(WeeklyPlanSlot, slot.id)
    assert kept_slot is not None and kept_slot.recipe_id is None
    assert kept_slot.history_snapshot is not None and kept_slot.history_snapshot["source_deleted"]
    kept_entry = db_session.get(MealMacroConfirmation, entry.id)
    assert kept_entry is not None
    assert kept_entry.recipe_id is None
    assert (kept_entry.calories, kept_entry.protein_g, kept_entry.notes) == (
        400,
        30,
        "Independent personal note",
    )
    kept_audit = db_session.get(AuditEvent, unrelated.id)
    assert kept_audit is not None and kept_audit.payload == {
        "owner_id": other.id,
        "email": other.email,
    }
    assert db_session.query(HouseholdRecipe).filter_by(recipe_id=shared_id).count() == 0
    assert client.get(f"/api/v1/recipes/{shared_id}", headers=other_headers).status_code == 404
    assert client.get(f"/api/v1/recipes/{shared_id}", headers=stranger_headers).status_code == 404


def test_independent_workout_performance_survives_template_erasure(
    client: TestClient, db_session: Session, auth_headers: dict[str, str]
) -> None:
    owner = db_session.query(User).filter_by(email="owner@example.com").one()
    other, _ = account(client, db_session, "workout-survivor@example.com")
    template = WorkoutTemplate(
        owner_id=owner.id,
        title="Original routine",
        category="cardio",
        description="Original authored instructions",
        exercises=[{"name": "Run"}],
    )
    db_session.add(template)
    db_session.flush()
    template_id = template.id
    log = WorkoutLog(
        user_id=other.id,
        request_uuid="00000000-0000-4000-8000-000000000099",
        template_id=template_id,
        performed_on=date.today(),
        completed=True,
        notes="My own run note",
        sets=[{"exercise_index": 0, "set_number": 1, "duration_seconds": 600}],
        snapshot={
            "id": template_id,
            "title": template.title,
            "category": "cardio",
            "description": template.description,
            "owner_id": owner.id,
            "exercises": [{"name": "Run", "instructions": "Original private copy"}],
        },
    )
    db_session.add(log)
    db_session.commit()
    log_id = log.id
    assert erase(client, auth_headers).json()["status"] == "complete"
    db_session.expire_all()
    assert db_session.get(WorkoutTemplate, template_id) is None
    kept = db_session.get(WorkoutLog, log_id)
    assert kept is not None
    assert kept.template_id is None and kept.completed
    assert kept.notes == "My own run note" and kept.sets[0]["duration_seconds"] == 600
    assert kept.snapshot["exercises"] == [{"name": "Run"}]
    assert "description" not in kept.snapshot and "Original routine" not in str(kept.snapshot)


def test_media_retry_revokes_access_then_finishes_without_recreating_account(
    client: TestClient,
    db_session: Session,
    auth_headers: dict[str, str],
    monkeypatch: pytest.MonkeyPatch,
    tmp_path: Path,
) -> None:
    owner = db_session.query(User).filter_by(email="owner@example.com").one()
    owner_id = owner.id
    storage = LocalMediaStorageAdapter(tmp_path, "http://testserver")
    stored = storage.save_recipe_image(
        user_id=owner_id, data=b"private fixture", suffix=".jpg", content_type="image/jpeg"
    )
    media = MediaObject(
        owner_user_id=owner_id,
        storage_key=stored.key,
        backend="local",
        content_type="image/jpeg",
        size_bytes=15,
    )
    db_session.add(media)
    db_session.commit()
    photo = recipe(db_session, owner)
    photo.photo_url = object_url(media.id)
    db_session.commit()
    fail = Mock(wraps=storage)
    fail.delete.side_effect = OSError("synthetic storage outage")
    monkeypatch.setattr("app.services.account_erasure.get_media_storage", lambda: fail)
    result = erase(client, auth_headers).json()
    assert result["status"] == "cleanup_pending"
    db_session.expire_all()
    assert db_session.get(User, owner_id) is None
    assert db_session.query(ErasureMediaTask).count() == 1
    marked = db_session.get(MediaObject, media.id)
    assert marked is not None and marked.deleted_at is not None
    assert (tmp_path / stored.key).exists()
    monkeypatch.setattr("app.services.account_erasure.get_media_storage", lambda: storage)
    assert process_erasure(db_session, result["receipt_id"])["status"] == "complete"
    assert not (tmp_path / stored.key).exists()
    assert db_session.query(ErasureMediaTask).count() == 0


def test_paid_subscription_requires_warning_and_is_not_silently_canceled(
    client: TestClient, db_session: Session, auth_headers: dict[str, str]
) -> None:
    owner = db_session.query(User).filter_by(email="owner@example.com").one()
    subscription = db_session.query(UserSubscription).filter_by(user_id=owner.id).one()
    subscription.source = "stripe"
    subscription.stripe_subscription_id = "sub_synthetic_erasure"
    subscription.stripe_customer_id = "cus_synthetic_erasure"
    db_session.commit()
    assert erase(client, auth_headers).status_code == 409
    result = erase(client, auth_headers, billing_acknowledged=True)
    assert result.json()["status"] == "complete"
    assert db_session.query(UserSubscription).count() == 0
    reference = db_session.query(DetachedBillingReference).one()
    assert reference.subscription_id == "sub_synthetic_erasure"
    assert reference.status == "active"


def test_feature_defaults_to_off_and_preserves_legacy_request_path(
    client: TestClient,
    db_session: Session,
    auth_headers: dict[str, str],
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(settings, "account_erasure_enabled", False)
    assert not client.get("/api/v1/auth/account/deletion", headers=auth_headers).json()["enabled"]
    assert erase(client, auth_headers).status_code == 503
    assert (
        client.post(
            "/api/v1/auth/account/delete-request",
            headers=auth_headers,
            json={"current_password": PASSWORD, "confirmation": "DELETE"},
        ).status_code
        == 200
    )
    assert db_session.query(AccountErasure).count() == 0


def test_revoked_inflight_writer_cannot_commit(
    db_session: Session, auth_headers: dict[str, str]
) -> None:
    owner = db_session.query(User).filter_by(email="owner@example.com").one()
    db_session.info["authenticated_actor"] = (owner.id, owner.session_version)
    owner.is_active = False
    db_session.flush()
    try:
        with pytest.raises(HTTPException, match="Account access was revoked"):
            reject_revoked_account_writes(db_session)
    finally:
        db_session.info.pop("authenticated_actor", None)
        db_session.rollback()
