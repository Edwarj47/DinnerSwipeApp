from __future__ import annotations

import importlib.util
from collections.abc import Iterator
from datetime import UTC, date, datetime, timedelta
from pathlib import Path
from types import SimpleNamespace
from typing import Any, cast
from uuid import uuid4

import pytest
from alembic.migration import MigrationContext
from alembic.operations import Operations
from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, event, func, inspect, select
from sqlalchemy.orm import Session, sessionmaker

from app.api.routes import workouts as routes
from app.core.config import settings
from app.core.security import create_access_token
from app.database.session import get_db
from app.models.base import Base
from app.models.entities import (
    GroceryList,
    GroceryListItem,
    Household,
    HouseholdMember,
    MealMacroConfirmation,
    User,
    UserProfile,
    UserSubscription,
    WeeklyPlan,
    WeeklyPlanSlot,
)
from app.models.workouts import (
    WorkoutLog,
    WorkoutPlan,
    WorkoutPlanningPreference,
    WorkoutPlanSlot,
    WorkoutProposal,
    WorkoutProposalMember,
    WorkoutTemplateShare,
)
from app.services import planning
from app.services import workouts as service

BASE = "/api/v1/workouts"
NOW = datetime(2026, 10, 14, 12, tzinfo=UTC)
WEEK = "2026-10-12"
TEMPLATE = {
    "title": "Upper session",
    "category": "upper",
    "description": "Private routine",
    "exercises": [
        {"name": "Bench press", "sets": 3, "reps": "8-10"},
        {"name": "Row", "sets": 3, "reps": "10"},
    ],
}


@pytest.fixture()
def workout_client(db_session: Session, monkeypatch: pytest.MonkeyPatch) -> Iterator[TestClient]:
    db_session.connection().exec_driver_sql("PRAGMA foreign_keys=ON")
    monkeypatch.setattr(routes, "settings", SimpleNamespace(workouts_enabled=True))
    monkeypatch.setattr(planning, "now_utc", lambda: NOW)
    test_app = FastAPI()
    test_app.include_router(routes.router, prefix="/api/v1")

    def override_db() -> Iterator[Session]:
        try:
            yield db_session
        except Exception:
            db_session.rollback()
            raise

    test_app.dependency_overrides[get_db] = override_db
    with TestClient(test_app) as client:
        yield client


def account(
    db: Session, name: str, *, tier: str | None = "basic_monthly", verified: bool = True
) -> tuple[User, dict[str, str]]:
    user = User(email=f"{name}@example.com", password_hash=str(uuid4()), email_verified=verified)
    db.add(user)
    db.flush()
    db.add(UserProfile(user_id=user.id))
    if tier:
        db.add(
            UserSubscription(user_id=user.id, plan_key=tier, status="active", source="waiver_code")
        )
    db.commit()
    return user, {"Authorization": f"Bearer {create_access_token(user.id)}"}


def group(db: Session, owner: User, member: User, name: str = "Training") -> Household:
    household = Household(name=name, is_personal=False)
    db.add(household)
    db.flush()
    db.add_all(
        [
            HouseholdMember(household_id=household.id, user_id=owner.id, role="owner"),
            HouseholdMember(household_id=household.id, user_id=member.id, role="member"),
        ]
    )
    db.commit()
    return household


def template(client: TestClient, headers: dict[str, str], **changes: Any) -> dict[str, Any]:
    result = client.post(f"{BASE}/templates", headers=headers, json=TEMPLATE | changes)
    assert result.status_code == 200, result.text
    return cast(dict[str, Any], result.json())


def share(
    client: TestClient, headers: dict[str, str], household: Household, routine: dict[str, Any]
) -> None:
    response = client.post(
        f"{BASE}/templates/share",
        headers=headers,
        json={"household_id": household.id, "template_ids": [routine["id"]]},
    )
    assert response.status_code == 200, response.text


def enable(
    client: TestClient, headers: dict[str, str], household: Household, routine: dict[str, Any]
) -> None:
    response = client.patch(
        f"{BASE}/discover-choices",
        headers=headers,
        json={"household_id": household.id, "enable_ids": [routine["id"]]},
    )
    assert response.status_code == 200, response.text


def test_disabled_default_and_all_routes_gated(
    workout_client: TestClient, db_session: Session, monkeypatch: pytest.MonkeyPatch
) -> None:
    assert getattr(type(settings)(), "workouts_enabled", False) is False
    _, headers = account(db_session, "disabled")
    monkeypatch.setattr(routes, "settings", SimpleNamespace())
    assert workout_client.get(f"{BASE}/status").status_code == 401
    status = workout_client.get(f"{BASE}/status", headers=headers)
    assert status.json() == {"enabled": False}
    assert status.headers["Cache-Control"] == "no-store"
    assert workout_client.get(f"{BASE}/templates", headers=headers).status_code == 404
    monkeypatch.setattr(routes, "settings", SimpleNamespace(workouts_enabled=False))
    endpoints = [
        ("get", "/templates", None),
        ("get", "/plans/current", None),
        ("get", "/logs", None),
        ("get", "/progress", None),
        ("post", "/templates", TEMPLATE),
    ]
    for method, path, body in endpoints:
        kwargs = {"json": body} if body is not None else {}
        assert (
            getattr(workout_client, method)(f"{BASE}{path}", headers=headers, **kwargs).status_code
            == 404
        )
    assert db_session.scalar(select(func.count()).select_from(WorkoutPlan)) == 0


@pytest.mark.parametrize(
    "tier,verified,expected",
    [
        (None, True, 402),
        ("basic_monthly", False, 403),
        ("basic_monthly", True, 200),
        ("premium_macros_monthly", True, 200),
    ],
)
def test_verified_paid_gate(
    workout_client: TestClient,
    db_session: Session,
    tier: str | None,
    verified: bool,
    expected: int,
) -> None:
    _, headers = account(db_session, "gate", tier=tier, verified=verified)
    status = workout_client.get(f"{BASE}/status", headers=headers)
    assert status.status_code == (402 if tier is None else 200)
    if tier:
        assert status.json() == {"enabled": True}
        assert status.headers["Cache-Control"] == "no-store"
    assert workout_client.get(f"{BASE}/templates").status_code == 401
    assert workout_client.get(f"{BASE}/templates", headers=headers).status_code == expected


def test_private_templates_strict_edits_and_cross_user_slots(
    workout_client: TestClient, db_session: Session
) -> None:
    owner, headers = account(db_session, "owner")
    _, stranger = account(db_session, "stranger")
    routine = template(workout_client, headers)
    assert routine["owner_id"] == owner.id
    assert workout_client.get(f"{BASE}/templates", headers=stranger).json() == {
        "items": [],
        "total": 0,
    }
    assert (
        workout_client.put(
            f"{BASE}/templates/{routine['id']}", headers=stranger, json=TEMPLATE
        ).status_code
        == 404
    )
    for body in [
        TEMPLATE | {"owner_id": owner.id},
        TEMPLATE | {"household_id": str(uuid4())},
        TEMPLATE | {"title": " "},
        TEMPLATE | {"exercises": [{"name": ""}]},
        TEMPLATE | {"exercises": [{"name": "Squat", "sets": -1}]},
        TEMPLATE | {"photo_url": "javascript:alert(1)"},
    ]:
        assert (
            workout_client.post(f"{BASE}/templates", headers=headers, json=body).status_code == 422
        )
    slot = workout_client.post(
        f"{BASE}/plans/slots",
        headers=headers,
        json={"template_id": routine["id"], "slot_date": WEEK},
    ).json()
    assert (
        workout_client.post(
            f"{BASE}/plans/slots", headers=stranger, json={"template_id": routine["id"]}
        ).status_code
        == 404
    )
    assert (
        workout_client.patch(
            f"{BASE}/plans/slots/{slot['id']}", headers=stranger, json={"sort_order": 2}
        ).status_code
        == 404
    )
    assert (
        workout_client.delete(f"{BASE}/plans/slots/{slot['id']}", headers=stranger).status_code
        == 404
    )
    assert workout_client.get(f"{BASE}/plans/current", headers=stranger).json()["slots"] == []


def test_group_curation_proposals_and_approval(
    workout_client: TestClient, db_session: Session
) -> None:
    owner, headers = account(db_session, "owner")
    member, member_headers = account(db_session, "member")
    _, stranger = account(db_session, "stranger")
    household = group(db_session, owner, member)
    routine = template(workout_client, member_headers)
    share(workout_client, member_headers, household, routine)
    share(workout_client, member_headers, household, routine)
    assert db_session.scalar(select(func.count()).select_from(WorkoutTemplateShare)) == 1
    library = f"{BASE}/templates?household_id={household.id}"
    assert workout_client.get(library, headers=headers).json()["items"][0]["shared"]
    assert (
        workout_client.get(f"{library}&discover=true", headers=member_headers).json()["items"] == []
    )
    payload = {"household_id": household.id, "template_id": routine["id"]}
    assert (
        workout_client.post(f"{BASE}/proposals", headers=member_headers, json=payload).status_code
        == 409
    )
    assert (
        workout_client.post(f"{BASE}/plans/slots", headers=headers, json=payload).status_code == 409
    )
    assert (
        workout_client.patch(
            f"{BASE}/discover-choices",
            headers=member_headers,
            json={"household_id": household.id, "enable_ids": [routine["id"]]},
        ).status_code
        == 403
    )
    enable(workout_client, headers, household, routine)
    assert (
        workout_client.get(f"{library}&discover=true", headers=member_headers).json()["total"] == 1
    )
    assert (
        workout_client.put(
            f"{BASE}/templates/{routine['id']}", headers=headers, json=TEMPLATE
        ).status_code
        == 404
    )
    assert (
        workout_client.post(f"{BASE}/plans/slots", headers=member_headers, json=payload).status_code
        == 403
    )
    first = workout_client.post(f"{BASE}/proposals", headers=member_headers, json=payload)
    assert first.status_code == 200, first.text
    proposal = first.json()
    assert (
        workout_client.post(f"{BASE}/proposals", headers=member_headers, json=payload).json()["id"]
        == proposal["id"]
    )
    assert db_session.scalar(select(func.count()).select_from(WorkoutProposalMember)) == 1
    decision = f"{BASE}/proposals/{proposal['id']}/decision"
    assert (
        workout_client.post(
            decision, headers=member_headers, json={"action": "approve"}
        ).status_code
        == 403
    )
    assert (
        workout_client.post(decision, headers=stranger, json={"action": "approve"}).status_code
        == 404
    )
    assert workout_client.get(library, headers=stranger).status_code == 404
    assert (
        workout_client.get(
            f"{BASE}/proposals?household_id={household.id}", headers=stranger
        ).status_code
        == 404
    )
    approved = workout_client.post(
        decision, headers=headers, json={"action": "approve", "slot_date": WEEK}
    )
    assert approved.status_code == 200, approved.text
    assert approved.json()["status"] == "approved"
    assert (
        workout_client.post(decision, headers=headers, json={"action": "approve"}).status_code
        == 409
    )
    plan = workout_client.get(
        f"{BASE}/plans/current?household_id={household.id}", headers=member_headers
    ).json()
    assert len(plan["slots"]) == 1
    assert workout_client.get(f"{BASE}/plans/current", headers=headers).json()["slots"] == []
    assert (
        workout_client.patch(
            f"{BASE}/plans/slots/{plan['slots'][0]['id']}",
            headers=member_headers,
            json={"slot_date": WEEK},
        ).status_code
        == 403
    )
    assert (
        workout_client.delete(
            f"{BASE}/plans/slots/{plan['slots'][0]['id']}", headers=member_headers
        ).status_code
        == 403
    )


def test_cross_group_share_choice_and_scheduling_rejected(
    workout_client: TestClient, db_session: Session
) -> None:
    owner, headers = account(db_session, "owner")
    member, member_headers = account(db_session, "member")
    outsider, outsider_headers = account(db_session, "outsider")
    first, second = group(db_session, owner, member), group(db_session, outsider, member, "Other")
    routine = template(workout_client, headers)
    share(workout_client, headers, first, routine)
    enable(workout_client, headers, first, routine)
    assert (
        workout_client.post(
            f"{BASE}/templates/share",
            headers=member_headers,
            json={"household_id": second.id, "template_ids": [routine["id"]]},
        ).status_code
        == 404
    )
    assert (
        workout_client.post(
            f"{BASE}/plans/slots",
            headers=outsider_headers,
            json={"household_id": second.id, "template_id": routine["id"]},
        ).status_code
        == 404
    )
    assert (
        workout_client.post(
            f"{BASE}/proposals",
            headers=member_headers,
            json={"household_id": second.id, "template_id": routine["id"]},
        ).status_code
        == 404
    )
    assert (
        workout_client.patch(
            f"{BASE}/discover-choices",
            headers=outsider_headers,
            json={"household_id": second.id, "enable_ids": [routine["id"]]},
        ).status_code
        == 422
    )


@pytest.mark.parametrize("shared", [False, True])
def test_snapshots_past_immutability_manual_carryover_without_meal_changes(
    workout_client: TestClient, db_session: Session, monkeypatch: pytest.MonkeyPatch, shared: bool
) -> None:
    owner, headers = account(db_session, "owner")
    member, member_headers = account(db_session, "member")
    household = group(db_session, owner, member) if shared else None
    meal = WeeklyPlan(
        user_id=None if household else owner.id,
        household_id=household.id if household else None,
        week_start=date.fromisoformat(WEEK),
        meal_target=7,
    )
    db_session.add(meal)
    db_session.flush()
    meal_slot = WeeklyPlanSlot(
        weekly_plan_id=meal.id, slot_type="flexible", servings=7, is_locked=True
    )
    groceries = GroceryList(
        user_id=None if household else owner.id,
        household_id=household.id if household else None,
        weekly_plan_id=meal.id,
    )
    db_session.add_all([meal_slot, groceries])
    db_session.flush()
    grocery_item = GroceryListItem(
        grocery_list_id=groceries.id,
        normalized_name="sentinel",
        display_name="Sentinel",
        quantity=3,
        is_checked=True,
    )
    db_session.add(grocery_item)
    db_session.commit()
    routine = template(workout_client, headers)
    extra = {"household_id": household.id} if household else {}
    query = f"?household_id={household.id}" if household else ""
    if household:
        share(workout_client, headers, household, routine)
        enable(workout_client, headers, household, routine)
    slot = workout_client.post(
        f"{BASE}/plans/slots",
        headers=headers,
        json={"template_id": routine["id"], "slot_date": WEEK, **extra},
    ).json()
    assert (
        workout_client.put(
            f"{BASE}/templates/{routine['id']}",
            headers=headers,
            json=TEMPLATE
            | {"title": "Changed", "exercises": [{"name": "New exercise", "sets": 1}]},
        ).status_code
        == 200
    )
    assert (
        workout_client.get(f"{BASE}/plans/current{query}", headers=headers).json()["slots"][0][
            "snapshot"
        ]["title"]
        == "Upper session"
    )
    meal_counts = [
        db_session.scalar(select(func.count()).select_from(model))
        for model in (WeeklyPlan, GroceryList, MealMacroConfirmation)
    ]
    monkeypatch.setattr(planning, "now_utc", lambda: NOW + timedelta(days=7))
    history_query = f"week_start={WEEK}" + (f"&household_id={household.id}" if household else "")
    past = workout_client.get(
        f"{BASE}/plans/history?{history_query}", headers=member_headers if household else headers
    )
    assert past.status_code == 200, past.text
    assert past.json()["read_only"] is True
    assert past.json()["slots"][0]["snapshot"]["exercises"][0]["name"] == "Bench press"
    assert (
        workout_client.patch(
            f"{BASE}/plans/slots/{slot['id']}", headers=headers, json={"sort_order": 9}
        ).status_code
        == 409
    )
    assert (
        workout_client.delete(f"{BASE}/plans/slots/{slot['id']}", headers=headers).status_code
        == 409
    )
    before = db_session.scalar(select(func.count()).select_from(WorkoutPlan))
    missing_query = "week_start=2026-09-28" + (f"&household_id={household.id}" if household else "")
    assert (
        workout_client.get(f"{BASE}/plans/history?{missing_query}", headers=headers).status_code
        == 404
    )
    assert db_session.scalar(select(func.count()).select_from(WorkoutPlan)) == before
    advanced = workout_client.get(f"{BASE}/plans/current{query}", headers=headers).json()
    assert len(advanced["slots"]) == 1
    assert advanced["slots"][0]["id"] != slot["id"]
    assert advanced["slots"][0]["slot_date"] == "2026-10-19"
    assert advanced["slots"][0]["snapshot"] == slot["snapshot"]
    assert meal_counts == [
        db_session.scalar(select(func.count()).select_from(model))
        for model in (WeeklyPlan, GroceryList, MealMacroConfirmation)
    ]
    db_session.refresh(meal_slot)
    db_session.refresh(grocery_item)
    assert meal_slot.servings == 7 and meal_slot.is_locked
    assert grocery_item.quantity == 3 and grocery_item.is_checked


@pytest.mark.parametrize("completed", [True, False])
def test_notes_only_sessions_save_without_sets_and_round_trip(
    workout_client: TestClient, db_session: Session, completed: bool
) -> None:
    _, headers = account(db_session, "runner")
    routine = template(
        workout_client, headers, title="Morning run", category="cardio", exercises=[{"name": "Run"}]
    )
    request_id = str(uuid4())
    body = {
        "template_id": routine["id"],
        "performed_on": "2026-10-14",
        "completed": completed,
        "notes": "Easy pace",
        "sets": [],
        "exercise_details": [{"exercise_index": 0, "completed": True, "notes": "3.15 miles"}],
    }
    response = workout_client.put(f"{BASE}/logs/{request_id}", headers=headers, json=body)
    assert response.status_code == 200, response.text
    saved = response.json()
    assert saved["sets"] == [] and saved["completed"] is completed
    assert saved["exercise_details"] == body["exercise_details"]
    assert workout_client.get(f"{BASE}/logs", headers=headers).json()["items"] == [saved]
    retry = workout_client.put(f"{BASE}/logs/{request_id}", headers=headers, json=body)
    assert retry.json() == saved
    assert db_session.scalar(select(func.count()).select_from(WorkoutLog)) == 1
    progress = workout_client.get(f"{BASE}/progress", headers=headers).json()
    assert progress["sessions_completed"] == int(completed)
    assert progress["total_volume_kg"] == 0 and progress["total_duration_seconds"] == 0
    assert progress["exercises"] == []


def test_private_logs_idempotency_historic_corrections_and_progress(
    workout_client: TestClient, db_session: Session
) -> None:
    owner, headers = account(db_session, "owner")
    member, member_headers = account(db_session, "member")
    household = group(db_session, owner, member)
    routine = template(workout_client, headers)
    share(workout_client, headers, household, routine)
    request_id = str(uuid4())
    body = {
        "template_id": routine["id"],
        "performed_on": "2026-10-01",
        "completed": True,
        "notes": "Private note",
        "sets": [
            {"exercise_index": 0, "set_number": 1, "reps": 10, "weight_kg": 50},
            {"exercise_index": 1, "set_number": 1, "duration_seconds": 120},
        ],
    }
    first = workout_client.put(f"{BASE}/logs/{request_id}", headers=member_headers, json=body)
    assert first.status_code == 200, first.text
    assert (
        workout_client.put(f"{BASE}/logs/{request_id}", headers=member_headers, json=body).json()
        == first.json()
    )
    assert db_session.scalar(select(func.count()).select_from(WorkoutLog)) == 1
    assert (
        workout_client.get(f"{BASE}/logs?household_id={household.id}", headers=headers).json()[
            "items"
        ]
        == []
    )
    assert (
        workout_client.get(f"{BASE}/progress?household_id={household.id}", headers=headers).json()[
            "sessions_completed"
        ]
        == 0
    )
    progress = workout_client.get(f"{BASE}/progress", headers=member_headers).json()
    assert progress["sessions_completed"] == 1 and progress["total_volume_kg"] == 500
    assert progress["total_duration_seconds"] == 120
    assert (
        workout_client.put(
            f"{BASE}/templates/{routine['id']}",
            headers=headers,
            json=TEMPLATE | {"title": "Changed", "exercises": [{"name": "Different exercise"}]},
        ).status_code
        == 200
    )
    corrected = body | {
        "sets": [{"exercise_index": 1, "set_number": 1, "reps": 5, "weight_kg": 20}]
    }
    response = workout_client.put(
        f"{BASE}/logs/{request_id}", headers=member_headers, json=corrected
    )
    assert response.status_code == 200, response.text
    assert response.json()["snapshot"]["title"] == "Upper session"
    assert response.json()["snapshot"]["exercises"][1]["name"] == "Row"
    assert (
        workout_client.get(f"{BASE}/progress", headers=member_headers).json()["total_volume_kg"]
        == 100
    )
    # The same request UUID belongs independently to each account.
    assert (
        workout_client.put(
            f"{BASE}/logs/{request_id}", headers=headers, json=body | {"sets": []}
        ).status_code
        == 200
    )
    assert db_session.scalar(select(func.count()).select_from(WorkoutLog)) == 2
    other = template(workout_client, member_headers, title="Other")
    assert (
        workout_client.put(
            f"{BASE}/logs/{request_id}",
            headers=member_headers,
            json=corrected | {"template_id": other["id"]},
        ).status_code
        == 409
    )


@pytest.mark.parametrize(
    "changes",
    [
        {"performed_on": "2026-10-15"},
        {"completed": "true"},
        {"weight_lb": 100},
        {"sets": [{"exercise_index": 2, "set_number": 1, "reps": 5}]},
        {"sets": [{"exercise_index": 0, "set_number": 1, "reps": -1}]},
        {"sets": [{"exercise_index": 0, "set_number": 1, "reps": 5, "weight_kg": -1}]},
        {"sets": [{"exercise_index": 0, "set_number": 1, "reps": 5, "weight_kg": "NaN"}]},
        {"sets": [{"exercise_index": 0, "set_number": 1, "duration_seconds": 0}]},
        {"sets": [{"exercise_index": 0, "set_number": 1, "reps": 5}] * 2},
        {"sets": [{"exercise_index": 0, "set_number": 1, "reps": 5}] * 201},
    ],
)
def test_log_validation(
    workout_client: TestClient, db_session: Session, changes: dict[str, Any]
) -> None:
    _, headers = account(db_session, "validation")
    routine = template(workout_client, headers)
    body = {"template_id": routine["id"], "performed_on": WEEK, "completed": True, "sets": []}
    assert (
        workout_client.put(
            f"{BASE}/logs/{uuid4()}", headers=headers, json=body | changes
        ).status_code
        == 422
    )
    assert db_session.scalar(select(func.count()).select_from(WorkoutLog)) == 0


def test_personal_and_group_timezones(
    workout_client: TestClient, db_session: Session, monkeypatch: pytest.MonkeyPatch
) -> None:
    owner, headers = account(db_session, "owner")
    member, _ = account(db_session, "member")
    household = group(db_session, owner, member)
    owner.profile.notification_preferences = {
        "weekly_planning": {"time_zone": "America/Los_Angeles"}
    }
    household.planning_settings = {"time_zone": "Pacific/Auckland"}
    db_session.commit()
    monkeypatch.setattr(planning, "now_utc", lambda: datetime(2026, 10, 19, 2, tzinfo=UTC))
    assert workout_client.get(f"{BASE}/plans/current", headers=headers).json()["week_start"] == WEEK
    assert (
        workout_client.get(
            f"{BASE}/plans/current?household_id={household.id}", headers=headers
        ).json()["week_start"]
        == "2026-10-19"
    )


def test_current_slot_validation_limits_and_disabled_choice(
    workout_client: TestClient, db_session: Session, monkeypatch: pytest.MonkeyPatch
) -> None:
    owner, headers = account(db_session, "owner")
    member, _ = account(db_session, "member")
    household = group(db_session, owner, member)
    routine = template(workout_client, headers)
    share(workout_client, headers, household, routine)
    enable(workout_client, headers, household, routine)
    body = {"household_id": household.id, "template_id": routine["id"]}
    assert (
        workout_client.post(
            f"{BASE}/plans/slots", headers=headers, json=body | {"slot_date": "2026-10-19"}
        ).status_code
        == 422
    )
    slot = workout_client.post(f"{BASE}/plans/slots", headers=headers, json=body).json()
    path = f"{BASE}/plans/slots/{slot['id']}"
    for patch in [{}, {"sort_order": None}, {"sort_order": -1}, {"slot_date": "2026-10-19"}]:
        assert workout_client.patch(path, headers=headers, json=patch).status_code == 422
    assert (
        workout_client.patch(
            path, headers=headers, json={"slot_date": WEEK, "sort_order": 3}
        ).json()["sort_order"]
        == 3
    )
    assert (
        workout_client.patch(path, headers=headers, json={"slot_date": None}).json()["slot_date"]
        is None
    )
    monkeypatch.setattr(service, "MAX_WEEKLY_SLOTS", 1)
    assert workout_client.post(f"{BASE}/plans/slots", headers=headers, json=body).status_code == 422
    assert (
        workout_client.patch(
            f"{BASE}/discover-choices",
            headers=headers,
            json={
                "household_id": household.id,
                "enable_ids": [routine["id"]],
                "disable_ids": [routine["id"]],
            },
        ).status_code
        == 422
    )
    assert (
        workout_client.patch(
            f"{BASE}/discover-choices",
            headers=headers,
            json={"household_id": household.id, "disable_ids": [routine["id"]]},
        ).status_code
        == 200
    )
    assert workout_client.patch(path, headers=headers, json={"sort_order": 2}).status_code == 409
    # A disabled choice can still be removed from the current week.
    assert workout_client.delete(path, headers=headers).status_code == 200
    assert db_session.scalar(select(func.count()).select_from(WorkoutPlanSlot)) == 0


def test_stale_disabled_rejected_proposals_and_removed_members(
    workout_client: TestClient, db_session: Session, monkeypatch: pytest.MonkeyPatch
) -> None:
    owner, headers = account(db_session, "owner")
    member, member_headers = account(db_session, "member")
    household = group(db_session, owner, member)
    routine = template(workout_client, headers)
    share(workout_client, headers, household, routine)
    enable(workout_client, headers, household, routine)
    body = {"household_id": household.id, "template_id": routine["id"]}
    proposal = workout_client.post(f"{BASE}/proposals", headers=member_headers, json=body).json()
    decision = f"{BASE}/proposals/{proposal['id']}/decision"
    workout_client.patch(
        f"{BASE}/discover-choices",
        headers=headers,
        json={"household_id": household.id, "disable_ids": [routine["id"]]},
    )
    assert (
        workout_client.post(decision, headers=headers, json={"action": "approve"}).status_code
        == 409
    )
    assert (
        workout_client.post(decision, headers=headers, json={"action": "reject"}).json()["status"]
        == "rejected"
    )
    enable(workout_client, headers, household, routine)
    assert (
        workout_client.post(f"{BASE}/proposals", headers=member_headers, json=body).json()["id"]
        == proposal["id"]
    )
    monkeypatch.setattr(planning, "now_utc", lambda: NOW + timedelta(days=7))
    new_proposal = workout_client.post(
        f"{BASE}/proposals", headers=member_headers, json=body
    ).json()
    assert new_proposal["id"] != proposal["id"]
    assert (
        workout_client.post(decision, headers=headers, json={"action": "approve"}).status_code
        == 409
    )
    pending = db_session.get(WorkoutProposal, new_proposal["id"])
    assert pending and pending.status == "pending"
    membership = db_session.scalar(
        select(HouseholdMember).where(
            HouseholdMember.household_id == household.id, HouseholdMember.user_id == member.id
        )
    )
    assert membership
    db_session.delete(membership)
    db_session.commit()
    assert (
        workout_client.post(f"{BASE}/proposals", headers=member_headers, json=body).status_code
        == 404
    )
    assert (
        workout_client.get(
            f"{BASE}/plans/current?household_id={household.id}", headers=member_headers
        ).status_code
        == 404
    )


def test_logs_private_template_access_and_correction_after_leaving_group(
    workout_client: TestClient, db_session: Session
) -> None:
    owner, headers = account(db_session, "owner")
    member, member_headers = account(db_session, "member")
    _, stranger = account(db_session, "stranger")
    household = group(db_session, owner, member)
    routine = template(workout_client, headers)
    body = {
        "template_id": routine["id"],
        "performed_on": WEEK,
        "completed": True,
        "sets": [{"exercise_index": 0, "set_number": 1, "reps": 10, "weight_kg": 25}],
    }
    request_id = uuid4()
    assert (
        workout_client.put(
            f"{BASE}/logs/{request_id}", headers=member_headers, json=body
        ).status_code
        == 404
    )
    share(workout_client, headers, household, routine)
    first = workout_client.put(f"{BASE}/logs/{request_id}", headers=member_headers, json=body)
    assert first.status_code == 200, first.text
    assert (
        workout_client.put(f"{BASE}/logs/{request_id}", headers=stranger, json=body).status_code
        == 404
    )
    membership = db_session.scalar(
        select(HouseholdMember).where(
            HouseholdMember.household_id == household.id, HouseholdMember.user_id == member.id
        )
    )
    assert membership
    db_session.delete(membership)
    db_session.commit()
    assert (
        workout_client.put(f"{BASE}/logs/{uuid4()}", headers=member_headers, json=body).status_code
        == 404
    )
    corrected = workout_client.put(
        f"{BASE}/logs/{request_id}", headers=member_headers, json=body | {"completed": False}
    )
    assert corrected.status_code == 200 and corrected.json()["snapshot"] == first.json()["snapshot"]
    assert (
        workout_client.get(f"{BASE}/progress", headers=member_headers).json()["sessions_completed"]
        == 0
    )
    assert len(workout_client.get(f"{BASE}/logs", headers=member_headers).json()["items"]) == 1


@pytest.mark.parametrize("shared", [False, True])
def test_workout_reset_settings_are_separate_and_reset_once(
    workout_client: TestClient, db_session: Session, monkeypatch: pytest.MonkeyPatch, shared: bool
) -> None:
    owner, headers = account(db_session, "owner")
    member, member_headers = account(db_session, "member")
    owner.profile.notification_preferences = {
        "weekly_planning": {"mode": "automatic", "reset_day": 1, "time_zone": "UTC"},
        "weekly_planning_cursor": "2026-10-01",
    }
    household = group(db_session, owner, member) if shared else None
    if household:
        household.planning_settings = {
            "mode": "automatic",
            "reset_day": 1,
            "time_zone": "UTC",
            "cursor": "2026-10-01",
        }
    db_session.commit()
    original_personal = dict(owner.profile.notification_preferences)
    original_group = dict(household.planning_settings) if household else None
    query = f"?household_id={household.id}" if household else ""
    body = {"mode": "automatic", "reset_day": 4, "notify": False, "time_zone": "UTC"}
    defaults = workout_client.get(f"{BASE}/planning-settings{query}", headers=headers).json()
    assert defaults["mode"] == "manual" and defaults["reset_day"] == 0
    if household:
        assert (
            workout_client.put(
                f"{BASE}/planning-settings{query}", headers=member_headers, json=body
            ).status_code
            == 403
        )
        assert (
            workout_client.post(
                f"{BASE}/plans/current/reset{query}", headers=member_headers, json={}
            ).status_code
            == 403
        )
    saved = workout_client.put(f"{BASE}/planning-settings{query}", headers=headers, json=body)
    assert saved.status_code == 200, saved.text
    assert saved.json()["notify"] is False
    routine = template(workout_client, headers)
    extra = {"household_id": household.id} if household else {}
    if household:
        share(workout_client, headers, household, routine)
        enable(workout_client, headers, household, routine)
    slot = workout_client.post(
        f"{BASE}/plans/slots", headers=headers, json={"template_id": routine["id"], **extra}
    )
    assert slot.status_code == 200, slot.text
    assert (
        len(workout_client.get(f"{BASE}/plans/current{query}", headers=headers).json()["slots"])
        == 1
    )
    monkeypatch.setattr(planning, "now_utc", lambda: NOW + timedelta(days=2))
    assert workout_client.get(f"{BASE}/plans/current{query}", headers=headers).json()["slots"] == []
    replacement = workout_client.post(
        f"{BASE}/plans/slots", headers=headers, json={"template_id": routine["id"], **extra}
    )
    assert replacement.status_code == 200, replacement.text
    assert (
        len(workout_client.get(f"{BASE}/plans/current{query}", headers=headers).json()["slots"])
        == 1
    )
    stored = db_session.scalar(select(WorkoutPlanningPreference))
    assert stored and stored.cursor == date(2026, 10, 16)
    # Workout initialization cannot overwrite an explicitly configured workout preference.
    initialized = workout_client.put(
        f"{BASE}/planning-settings{query}",
        headers=headers,
        json=body | {"mode": "manual", "initialize_only": True},
    )
    assert initialized.json()["mode"] == "automatic"
    cleared = workout_client.post(f"{BASE}/plans/current/reset{query}", headers=headers, json={})
    assert cleared.status_code == 200 and cleared.json()["slots"] == []
    db_session.refresh(owner.profile)
    assert owner.profile.notification_preferences == original_personal
    if household:
        db_session.refresh(household)
        assert household.planning_settings == original_group


def test_photo_fallback_and_bounded_pagination(
    workout_client: TestClient, db_session: Session
) -> None:
    _, headers = account(db_session, "owner")
    first = template(workout_client, headers, title="A")
    second = template(workout_client, headers, title="B", photo_url=service.brand_photo())
    assert first["photo_url"] == service.brand_photo()
    assert second["photo_url"] == service.brand_photo()
    listed = workout_client.get(f"{BASE}/templates?limit=1&offset=1", headers=headers).json()
    assert listed["total"] == 2 and [item["id"] for item in listed["items"]] == [second["id"]]
    for path in ["templates", "logs"]:
        assert workout_client.get(f"{BASE}/{path}?limit=101", headers=headers).status_code == 422
    for source in [
        "/home/codexvps/private.jpg",
        "file:///tmp/photo.jpg",
        "https://example.com/media/uploads/private.jpg",
        "https://example.com/api/v1/media/recipes/workout-id?token=private",
        "https://example.com/api/v1/media/objects/private-id",
    ]:
        assert (
            workout_client.post(
                f"{BASE}/templates", headers=headers, json=TEMPLATE | {"photo_url": source}
            ).status_code
            == 422
        )


@pytest.mark.parametrize("shared", [False, True])
def test_automatic_reset_due_does_not_roll_and_keeps_past_snapshots(
    workout_client: TestClient, db_session: Session, monkeypatch: pytest.MonkeyPatch, shared: bool
) -> None:
    owner, headers = account(db_session, "owner")
    member, _ = account(db_session, "member")
    household = group(db_session, owner, member) if shared else None
    query = f"?household_id={household.id}" if household else ""
    extra = {"household_id": household.id} if household else {}
    config = {"mode": "automatic", "reset_day": 0, "notify": True, "time_zone": "UTC"}
    assert (
        workout_client.put(
            f"{BASE}/planning-settings{query}", headers=headers, json=config
        ).status_code
        == 200
    )
    routine = template(workout_client, headers)
    if household:
        share(workout_client, headers, household, routine)
        enable(workout_client, headers, household, routine)
    created = workout_client.post(
        f"{BASE}/plans/slots",
        headers=headers,
        json={"template_id": routine["id"], "slot_date": WEEK, **extra},
    )
    assert created.status_code == 200, created.text
    slot = created.json()
    monkeypatch.setattr(planning, "now_utc", lambda: NOW + timedelta(days=7))
    current = workout_client.get(f"{BASE}/plans/current{query}", headers=headers)
    assert current.status_code == 200 and current.json()["slots"] == []
    history_query = f"week_start={WEEK}" + (f"&household_id={household.id}" if household else "")
    past = workout_client.get(f"{BASE}/plans/history?{history_query}", headers=headers).json()
    assert past["read_only"] and past["slots"][0]["snapshot"] == slot["snapshot"]


def test_shared_snapshots_do_not_expose_later_private_edits(
    workout_client: TestClient, db_session: Session
) -> None:
    owner, headers = account(db_session, "owner")
    member, member_headers = account(db_session, "member")
    household = group(db_session, owner, member)
    routine = template(workout_client, headers)
    share(workout_client, headers, household, routine)
    enable(workout_client, headers, household, routine)
    body = {"household_id": household.id, "template_id": routine["id"]}
    proposal = workout_client.post(f"{BASE}/proposals", headers=member_headers, json=body).json()
    first = workout_client.post(f"{BASE}/plans/slots", headers=headers, json=body).json()
    private = TEMPLATE | {"title": "Private revision", "exercises": [{"name": "Private exercise"}]}
    assert (
        workout_client.put(
            f"{BASE}/templates/{routine['id']}", headers=headers, json=private
        ).status_code
        == 200
    )
    library = workout_client.get(
        f"{BASE}/templates?household_id={household.id}", headers=member_headers
    )
    assert library.status_code == 200 and library.headers["Cache-Control"] == "no-store"
    assert library.json()["items"][0]["title"] == "Upper session"
    scheduled = workout_client.post(f"{BASE}/plans/slots", headers=headers, json=body).json()
    assert scheduled["snapshot"] == first["snapshot"]
    log_body = {
        "template_id": routine["id"],
        "performed_on": WEEK,
        "completed": True,
        "sets": [{"exercise_index": 1, "set_number": 1, "reps": 10}],
    }
    logged = workout_client.put(f"{BASE}/logs/{uuid4()}", headers=member_headers, json=log_body)
    assert logged.status_code == 200 and logged.headers["Cache-Control"] == "no-store"
    assert logged.json()["snapshot"]["exercises"][1]["name"] == "Row"
    assert (
        workout_client.get(f"{BASE}/progress", headers=member_headers).headers["Cache-Control"]
        == "no-store"
    )
    # Refreshing a share is explicit and invalidates the previous curator approval.
    share(workout_client, headers, household, routine)
    assert (
        workout_client.get(
            f"{BASE}/templates?household_id={household.id}&discover=true", headers=member_headers
        ).json()["items"]
        == []
    )
    assert workout_client.post(f"{BASE}/plans/slots", headers=headers, json=body).status_code == 409
    enable(workout_client, headers, household, routine)
    latest = workout_client.post(f"{BASE}/plans/slots", headers=headers, json=body).json()
    assert latest["snapshot"]["title"] == "Private revision"
    plan = workout_client.get(f"{BASE}/plans/current?household_id={household.id}", headers=headers)
    assert plan.headers["Cache-Control"] == "no-store"
    assert plan.json()["slots"][0]["snapshot"] == first["snapshot"]
    assert (
        workout_client.post(
            f"{BASE}/proposals/{proposal['id']}/decision",
            headers=headers,
            json={"action": "approve"},
        ).status_code
        == 409
    )


def automatic_week(
    client: TestClient,
    db: Session,
    *,
    name: str = "worker",
    shared: bool = False,
    reset_day: int = 0,
) -> tuple[User, User, Household | None, WorkoutPlanningPreference, dict[str, Any]]:
    owner, headers = account(db, f"{name}-owner")
    member, _ = account(db, f"{name}-member", tier="premium_macros_monthly")
    household = group(db, owner, member, name) if shared else None
    query = f"?household_id={household.id}" if household else ""
    response = client.put(
        f"{BASE}/planning-settings{query}",
        headers=headers,
        json={
            "mode": "automatic",
            "reset_day": reset_day,
            "notify": True,
            "time_zone": "UTC",
        },
    )
    assert response.status_code == 200, response.text
    routine = template(client, headers)
    if household:
        share(client, headers, household, routine)
        enable(client, headers, household, routine)
    slot_response = client.post(
        f"{BASE}/plans/slots",
        headers=headers,
        json={
            "template_id": routine["id"],
            "slot_date": WEEK,
            **({"household_id": household.id} if household else {}),
        },
    )
    assert slot_response.status_code == 200, slot_response.text
    stored = db.scalar(
        select(WorkoutPlanningPreference).where(
            WorkoutPlanningPreference.household_id == household.id
            if household
            else WorkoutPlanningPreference.user_id == owner.id
        )
    )
    assert stored
    db.commit()
    return owner, member, household, stored, cast(dict[str, Any], slot_response.json())


@pytest.mark.parametrize("shared", [False, True])
def test_worker_resets_closed_app_once_and_preserves_history(
    workout_client: TestClient, db_session: Session, monkeypatch: pytest.MonkeyPatch, shared: bool
) -> None:
    owner, _, household, stored, old_slot = automatic_week(
        workout_client, db_session, shared=shared
    )
    original_meal_settings = dict(owner.profile.notification_preferences or {})
    original_group_settings = dict(household.planning_settings) if household else None
    db_session.commit()
    factory = sessionmaker(bind=db_session.get_bind(), autoflush=False)
    monkeypatch.setattr(planning, "now_utc", lambda: NOW + timedelta(days=7))
    assert service.process_due_resets(factory) == 1
    assert service.process_due_resets(factory) == 0
    db_session.expire_all()
    current = db_session.scalar(
        service.plan_query(owner, household.id if household else None, date(2026, 10, 19))
    )
    assert current
    assert (
        list(
            db_session.scalars(select(WorkoutPlanSlot).where(WorkoutPlanSlot.plan_id == current.id))
        )
        == []
    )
    original = db_session.get(WorkoutPlanSlot, old_slot["id"])
    assert original and original.snapshot == old_slot["snapshot"]
    assert stored.cursor == date(2026, 10, 19)
    assert owner.profile.notification_preferences == original_meal_settings
    if household:
        assert household.planning_settings == original_group_settings
    assert db_session.scalar(select(func.count()).select_from(WorkoutLog)) == 0


@pytest.mark.parametrize("shared", [False, True])
def test_worker_same_week_reset_leaves_manual_workouts_unchanged(
    workout_client: TestClient, db_session: Session, monkeypatch: pytest.MonkeyPatch, shared: bool
) -> None:
    _, _, _, stored, old_slot = automatic_week(
        workout_client, db_session, shared=shared, reset_day=4
    )
    manual, _, _, manual_settings, manual_slot = automatic_week(
        workout_client, db_session, name="manual"
    )
    manual_settings.mode = "manual"
    manual_cursor = manual_settings.cursor
    db_session.commit()
    monkeypatch.setattr(planning, "now_utc", lambda: NOW + timedelta(days=2))
    factory = sessionmaker(bind=db_session.get_bind(), autoflush=False)
    assert service.process_due_resets(factory) == 1
    assert service.process_due_resets(factory) == 0
    db_session.expire_all()
    assert db_session.get(WorkoutPlanSlot, old_slot["id"]) is None
    untouched = db_session.get(WorkoutPlanSlot, manual_slot["id"])
    assert untouched and untouched.snapshot == manual_slot["snapshot"]
    assert manual_settings.cursor == manual_cursor
    assert stored.cursor == date(2026, 10, 16)
    assert (
        db_session.scalar(
            select(func.count()).select_from(WorkoutPlan).where(WorkoutPlan.user_id == manual.id)
        )
        == 1
    )


@pytest.mark.parametrize(
    "shared,invalid",
    [
        (False, "inactive"),
        (False, "unverified"),
        (False, "unpaid"),
        (False, "expired"),
        (True, "inactive"),
        (True, "unverified"),
        (True, "unpaid"),
        (True, "no_owner"),
        (True, "ambiguous_owner"),
        (True, "personal_group"),
    ],
)
def test_worker_revalidates_access_and_current_group_ownership(
    workout_client: TestClient,
    db_session: Session,
    monkeypatch: pytest.MonkeyPatch,
    shared: bool,
    invalid: str,
) -> None:
    owner, member, household, stored, old_slot = automatic_week(
        workout_client, db_session, shared=shared
    )
    original_cursor = stored.cursor
    if invalid == "inactive":
        owner.is_active = False
    elif invalid == "unverified":
        owner.email_verified = False
    elif invalid in {"unpaid", "expired"}:
        subscription = db_session.scalar(
            select(UserSubscription).where(UserSubscription.user_id == owner.id)
        )
        assert subscription
        if invalid == "expired":
            subscription.current_period_end = datetime(2000, 1, 1)
        else:
            subscription.status = "inactive"
    else:
        assert household
        owner_membership = db_session.scalar(
            select(HouseholdMember).where(
                HouseholdMember.household_id == household.id, HouseholdMember.user_id == owner.id
            )
        )
        member_membership = db_session.scalar(
            select(HouseholdMember).where(
                HouseholdMember.household_id == household.id, HouseholdMember.user_id == member.id
            )
        )
        assert owner_membership and member_membership
        if invalid == "no_owner":
            db_session.delete(owner_membership)
        elif invalid == "ambiguous_owner":
            member_membership.role = "owner"
        else:
            household.is_personal = True
    db_session.commit()
    monkeypatch.setattr(planning, "now_utc", lambda: NOW + timedelta(days=7))
    factory = sessionmaker(bind=db_session.get_bind(), autoflush=False)
    assert service.process_due_resets(factory) == 0
    db_session.expire_all()
    assert stored.cursor == original_cursor
    assert db_session.get(WorkoutPlanSlot, old_slot["id"])
    assert db_session.scalar(select(func.count()).select_from(WorkoutPlan)) == 1


def test_worker_uses_new_paid_owner_after_transfer(
    workout_client: TestClient, db_session: Session, monkeypatch: pytest.MonkeyPatch
) -> None:
    owner, member, household, _, _ = automatic_week(workout_client, db_session, shared=True)
    assert household
    for membership in db_session.scalars(
        select(HouseholdMember).where(HouseholdMember.household_id == household.id)
    ):
        membership.role = "owner" if membership.user_id == member.id else "member"
    owner.is_active = False
    db_session.commit()
    monkeypatch.setattr(planning, "now_utc", lambda: NOW + timedelta(days=7))
    factory = sessionmaker(bind=db_session.get_bind(), autoflush=False)
    assert service.process_due_resets(factory) == 1
    db_session.expire_all()
    assert db_session.scalar(service.plan_query(member, household.id, date(2026, 10, 19)))


def test_worker_missing_cursor_is_initialized_without_erasing_workouts(
    workout_client: TestClient, db_session: Session
) -> None:
    _, _, _, stored, old_slot = automatic_week(workout_client, db_session)
    stored.cursor = None
    db_session.commit()
    factory = sessionmaker(bind=db_session.get_bind(), autoflush=False)
    assert service.process_due_resets(factory) == 1
    assert service.process_due_resets(factory) == 0
    db_session.expire_all()
    assert stored.cursor == date.fromisoformat(WEEK)
    assert db_session.get(WorkoutPlanSlot, old_slot["id"])


def test_worker_keyset_pages_isolate_failures_and_log_no_private_contents(
    workout_client: TestClient, db_session: Session, monkeypatch: pytest.MonkeyPatch
) -> None:
    preferences = []
    for index in range(3):
        _, _, _, stored, _ = automatic_week(workout_client, db_session, name=f"page-{index}")
        stored.id = f"00000000-0000-0000-0000-{index + 1:012d}"
        db_session.commit()
        preferences.append(stored)
    original_cursor = preferences[0].cursor
    factory = sessionmaker(bind=db_session.get_bind(), autoflush=False)
    original_ensure = service.ensure_plan
    failures: list[tuple[str, dict[str, str]]] = []
    pages: list[str] = []

    def broken_once(db: Session, user: User, household_id: str | None, week: date) -> WorkoutPlan:
        plan = original_ensure(db, user, household_id, week)
        stored = service.preference(db, user, household_id)
        assert stored
        if stored.id == preferences[0].id:
            raise RuntimeError("Private routine and account contents must not enter logs")
        return plan

    def record_warning(name: str, **metadata: str) -> None:
        failures.append((name, metadata))

    def record_queries(
        connection: Any,
        cursor: Any,
        statement: str,
        parameters: Any,
        context: Any,
        executemany: bool,
    ) -> None:
        if "ORDER BY workout_planning_preferences.id" in statement:
            pages.append(statement)

    monkeypatch.setattr(service, "RESET_PAGE_SIZE", 1)
    monkeypatch.setattr(service, "ensure_plan", broken_once)
    monkeypatch.setattr(service, "logger", SimpleNamespace(warning=record_warning))
    monkeypatch.setattr(planning, "now_utc", lambda: NOW + timedelta(days=7))
    bind = db_session.get_bind()
    event.listen(bind, "before_cursor_execute", record_queries)
    try:
        assert service.process_due_resets(factory) == 2
    finally:
        event.remove(bind, "before_cursor_execute", record_queries)
    db_session.expire_all()
    assert len(pages) == 3 and all("LIMIT" in statement for statement in pages)
    assert preferences[0].cursor == original_cursor
    assert preferences[1].cursor == date(2026, 10, 19)
    assert preferences[2].cursor == date(2026, 10, 19)
    assert db_session.scalar(select(func.count()).select_from(WorkoutPlan)) == 5
    assert failures == [("workout_reset_failed", {"error_type": "RuntimeError"})]


@pytest.mark.parametrize("shared", [False, True])
def test_worker_uses_workout_timezone_for_cycle_and_current_week(
    workout_client: TestClient, db_session: Session, monkeypatch: pytest.MonkeyPatch, shared: bool
) -> None:
    owner, _, household, stored, old_slot = automatic_week(
        workout_client, db_session, shared=shared
    )
    stored.time_zone = "America/Los_Angeles"
    db_session.commit()
    factory = sessionmaker(bind=db_session.get_bind(), autoflush=False)
    monkeypatch.setattr(planning, "now_utc", lambda: datetime(2026, 10, 19, 2, tzinfo=UTC))
    assert service.process_due_resets(factory) == 0
    db_session.expire_all()
    assert db_session.get(WorkoutPlanSlot, old_slot["id"])
    db_session.commit()
    monkeypatch.setattr(planning, "now_utc", lambda: datetime(2026, 10, 19, 8, tzinfo=UTC))
    assert service.process_due_resets(factory) == 1
    db_session.expire_all()
    assert stored.cursor == date(2026, 10, 19)
    assert db_session.scalar(
        service.plan_query(owner, household.id if household else None, date(2026, 10, 19))
    )


def test_worker_carryover_does_not_refresh_revoked_member_private_template(
    workout_client: TestClient, db_session: Session, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(planning, "now_utc", lambda: NOW + timedelta(days=2))
    owner, member, household, _, old_slot = automatic_week(
        workout_client, db_session, shared=True, reset_day=4
    )
    assert household
    original_membership = db_session.scalar(
        select(HouseholdMember).where(
            HouseholdMember.household_id == household.id, HouseholdMember.user_id == owner.id
        )
    )
    new_owner = db_session.scalar(
        select(HouseholdMember).where(
            HouseholdMember.household_id == household.id, HouseholdMember.user_id == member.id
        )
    )
    assert original_membership and new_owner
    new_owner.role = "owner"
    db_session.delete(original_membership)
    db_session.commit()
    headers = {"Authorization": f"Bearer {create_access_token(owner.id)}"}
    edited = workout_client.put(
        f"{BASE}/templates/{old_slot['template_id']}",
        headers=headers,
        json=TEMPLATE
        | {
            "title": "Never share this private revision",
            "exercises": [{"name": "Private exercise"}],
        },
    )
    assert edited.status_code == 200, edited.text
    factory = sessionmaker(bind=db_session.get_bind(), autoflush=False)
    monkeypatch.setattr(planning, "now_utc", lambda: NOW + timedelta(days=5))
    assert service.process_due_resets(factory) == 1
    db_session.expire_all()
    current = db_session.scalar(service.plan_query(member, household.id, date(2026, 10, 19)))
    assert current
    slots = list(
        db_session.scalars(select(WorkoutPlanSlot).where(WorkoutPlanSlot.plan_id == current.id))
    )
    assert len(slots) == 1 and slots[0].snapshot == old_slot["snapshot"]
    assert slots[0].slot_date == date(2026, 10, 19)


def test_worker_empty_and_failed_scan_are_private_and_return_zero(
    workout_client: TestClient, db_session: Session, monkeypatch: pytest.MonkeyPatch
) -> None:
    factory = sessionmaker(bind=db_session.get_bind(), autoflush=False)
    assert service.process_due_resets(factory) == 0
    failures: list[tuple[str, dict[str, str]]] = []

    def broken_factory() -> Session:
        raise RuntimeError("Private connection information")

    def record_warning(name: str, **metadata: str) -> None:
        failures.append((name, metadata))

    monkeypatch.setattr(service, "logger", SimpleNamespace(warning=record_warning))
    assert service.process_due_resets(broken_factory) == 0
    assert failures == [("workout_reset_scan_failed", {"error_type": "RuntimeError"})]


def test_additive_migration_matches_metadata_and_downgrade() -> None:
    path = Path(__file__).resolve().parents[2] / "alembic/versions/c7e40b9d2a61_workouts.py"
    spec = importlib.util.spec_from_file_location("workout_migration", path)
    assert spec and spec.loader
    migration = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(migration)
    assert migration.down_revision == "f431d986a201"
    engine = create_engine("sqlite:///:memory:")
    try:
        with engine.begin() as connection:
            connection.exec_driver_sql("CREATE TABLE users (id VARCHAR(36) PRIMARY KEY)")
            connection.exec_driver_sql("CREATE TABLE households (id VARCHAR(36) PRIMARY KEY)")
            context = MigrationContext.configure(connection)
            with Operations.context(context):
                migration.upgrade()
                tables = inspect(connection).get_table_names()
                for name, table in Base.metadata.tables.items():
                    if not name.startswith("workout_"):
                        continue
                    assert name in tables
                    assert {column["name"] for column in inspect(connection).get_columns(name)} == {
                        column.name for column in table.columns
                    }
                    assert {index["name"] for index in inspect(connection).get_indexes(name)} == {
                        index.name for index in table.indexes
                    }
                migration.downgrade()
                assert inspect(connection).get_table_names() == ["households", "users"]
    finally:
        engine.dispose()
