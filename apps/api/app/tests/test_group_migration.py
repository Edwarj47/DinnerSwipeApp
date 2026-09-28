from __future__ import annotations

import importlib.util
from datetime import date
from pathlib import Path

import pytest
from alembic.migration import MigrationContext
from alembic.operations import Operations
from sqlalchemy import create_engine, text
from sqlalchemy.orm import Session

from app.models.base import Base
from app.models.entities import (
    Household,
    HouseholdMember,
    Recipe,
    User,
    WeeklyPlan,
    WeeklyPlanVote,
)


def test_migration_preserves_legacy_votes_and_adds_private_kitchens(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    engine = create_engine(f"sqlite:///{tmp_path / 'migration.db'}")
    Base.metadata.create_all(engine)
    with Session(engine) as db:
        fixture_hash = "not-a-real-password-hash"
        owner = User(email="migration@example.com", password_hash=fixture_hash)
        guest = User(email="guest@example.com", password_hash=fixture_hash)
        household = Household(name="Family", invite_code="FIXTURE1")
        db.add_all([owner, guest, household])
        db.flush()
        db.add_all(
            [
                HouseholdMember(household_id=household.id, user_id=owner.id, role="owner"),
                HouseholdMember(household_id=household.id, user_id=guest.id, role="member"),
            ]
        )
        recipe = Recipe(
            name="Dinner", owner_user_id=owner.id, household_id=household.id, content_hash="fixture"
        )
        plan = WeeklyPlan(user_id=owner.id, week_start=date(2026, 9, 21))
        db.add_all([recipe, plan])
        db.flush()
        vote = WeeklyPlanVote(
            weekly_plan_id=plan.id, user_id=guest.id, recipe_id=recipe.id, vote="yes"
        )
        db.add(vote)
        db.commit()
        household_id = household.id
    migration_path = (
        Path(__file__).parents[2] / "alembic/versions/ca92e654710b_multiple_households.py"
    )
    spec = importlib.util.spec_from_file_location("group_migration", migration_path)
    assert spec and spec.loader
    revision = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(revision)
    with engine.begin() as connection:
        connection.execute(text("DROP TABLE household_votes"))
        connection.execute(text("DROP TABLE household_recipes"))
        connection.execute(text("ALTER TABLE households DROP COLUMN is_personal"))
        monkeypatch.setattr(revision, "op", Operations(MigrationContext.configure(connection)))
        revision.upgrade()
        row = connection.execute(text("SELECT household_id, vote FROM household_votes")).one()
        assert row == (household_id, "yes")
        assert (
            connection.scalar(text("SELECT count(*) FROM households WHERE is_personal = true")) == 2
        )
        assert connection.scalar(text("SELECT count(*) FROM weekly_plan_votes")) == 1
        assert connection.scalar(text("SELECT count(*) FROM household_members")) == 4
        revision.downgrade()
        assert connection.scalar(text("SELECT count(*) FROM weekly_plan_votes")) == 1
    engine.dispose()
