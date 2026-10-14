"""Workout concurrency checks on an explicitly disposable PostgreSQL database."""

import os
from concurrent.futures import ThreadPoolExecutor
from datetime import date
from uuid import uuid4

import pytest
from alembic.config import Config
from fastapi import HTTPException
from sqlalchemy import create_engine, func, select
from sqlalchemy.engine import make_url
from sqlalchemy.orm import sessionmaker

from alembic import command
from app.core.config import settings
from app.models.entities import (
    Household,
    HouseholdMember,
    MealMacroConfirmation,
    User,
    UserProfile,
    WeeklyPlan,
)
from app.models.workouts import WorkoutLog, WorkoutPlanSlot, WorkoutProposal, WorkoutProposalMember
from app.schemas.workouts import ExerciseInput, LogInput, TemplateInput
from app.services import workouts


@pytest.mark.skipif(
    not os.environ.get("WORKOUT_TEST_DATABASE_URL"), reason="Disposable PostgreSQL only"
)
def test_postgres_private_logs_and_group_proposals_are_atomic(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    url = os.environ["WORKOUT_TEST_DATABASE_URL"]
    parsed = make_url(url)
    assert parsed.host == "127.0.0.1" and parsed.port == 15413 and parsed.database == "workout_test"
    monkeypatch.setattr(settings, "database_url", url)
    command.upgrade(Config("alembic.ini"), "head")
    engine = create_engine(url)
    sessions = sessionmaker(engine, expire_on_commit=False)
    try:
        with sessions() as db:
            owner = User(email=f"{uuid4()}@example.com", password_hash=str(uuid4()))
            member = User(email=f"{uuid4()}@example.com", password_hash=str(uuid4()))
            household = Household(name="Disposable workout group", is_personal=False)
            db.add_all([owner, member, household])
            db.flush()
            db.add_all(
                [
                    UserProfile(user_id=owner.id),
                    UserProfile(user_id=member.id),
                    HouseholdMember(household_id=household.id, user_id=owner.id, role="owner"),
                    HouseholdMember(household_id=household.id, user_id=member.id, role="member"),
                ]
            )
            db.commit()
            routine = workouts.save_template(
                db,
                owner,
                TemplateInput(title="Concurrent bench", exercises=[ExerciseInput(name="Bench")]),
            )
            workouts.share_templates(db, owner, household.id, [routine.id])
            workouts.discover_choices(db, owner, household.id, [routine.id], [])
            revision = workouts.routine_snapshot(db, routine, household.id)["revision"]
            owner_id, member_id = owner.id, member.id
            household_id, template_id = household.id, routine.id
            db.commit()
        request_id = str(uuid4())
        payload = LogInput.model_validate(
            {
                "template_id": template_id,
                "household_id": household_id,
                "expected_revision": revision,
                "performed_on": str(date.today()),
                "completed": True,
                "sets": [{"exercise_index": 0, "set_number": 1, "reps": 8, "weight_kg": 40}],
            }
        )

        def save(_: int) -> str:
            with sessions() as db:
                user = db.get(User, member_id)
                assert user
                result = workouts.save_log(db, user, request_id, payload)
                db.commit()
                return result.id

        with ThreadPoolExecutor(max_workers=5) as workers:
            saved = list(workers.map(save, range(5)))
        assert len(set(saved)) == 1

        def propose(_: int) -> str:
            with sessions() as db:
                user = db.get(User, member_id)
                assert user
                result = workouts.propose(db, user, household_id, template_id)
                db.commit()
                return result.id

        with ThreadPoolExecutor(max_workers=5) as workers:
            proposed = list(workers.map(propose, range(5)))
        assert len(set(proposed)) == 1

        def approve(_: int) -> int:
            with sessions() as db:
                user = db.get(User, owner_id)
                assert user
                try:
                    workouts.decide(db, user, proposed[0], "approve", None)
                    db.commit()
                    return 200
                except HTTPException as error:
                    return error.status_code

        with ThreadPoolExecutor(max_workers=4) as workers:
            approved = list(workers.map(approve, range(4)))
        assert sorted(approved) == [200, 409, 409, 409]
        with sessions() as db:
            for model in (WorkoutLog, WorkoutProposal, WorkoutProposalMember, WorkoutPlanSlot):
                assert db.scalar(select(func.count()).select_from(model)) == 1
            stored = db.scalar(select(WorkoutLog))
            assert stored and stored.user_id == member_id
            assert stored.snapshot["revision"] == revision
            assert db.scalar(select(func.count()).select_from(MealMacroConfirmation)) == 0
            assert db.scalar(select(func.count()).select_from(WeeklyPlan)) == 0
    finally:
        engine.dispose()
