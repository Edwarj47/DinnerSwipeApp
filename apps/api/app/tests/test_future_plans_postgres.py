"""Future-plan creation races against an explicitly disposable PostgreSQL instance."""

import os
import threading
from concurrent.futures import ThreadPoolExecutor
from datetime import date
from uuid import uuid4

import pytest
from alembic.config import Config
from sqlalchemy import create_engine, func, select
from sqlalchemy.engine import make_url
from sqlalchemy.orm import sessionmaker

from alembic import command
from app.core.config import settings
from app.models.entities import (
    Household,
    HouseholdMember,
    HouseholdRecipe,
    Recipe,
    User,
    UserProfile,
    WeeklyPlan,
    WeeklyPlanSlot,
)
from app.schemas.common import WeeklySlotCreate
from app.services.planning import preplanned_weeks
from app.tests.test_weekly_planning import freeze


@pytest.mark.skipif(
    not os.environ.get("SECURITY_TEST_DATABASE_URL"), reason="Disposable PostgreSQL only"
)
@pytest.mark.parametrize("group_plan", [False, True])
def test_concurrent_future_additions_share_one_plan_and_keep_every_meal(
    monkeypatch: pytest.MonkeyPatch, group_plan: bool
) -> None:
    from app.api.routes.group_planning import add_meal
    from app.api.routes.plans import add_slot

    url = os.environ["SECURITY_TEST_DATABASE_URL"]
    parsed = make_url(url)
    assert (
        parsed.host == "127.0.0.1" and parsed.port == 15413 and parsed.database == "security_test"
    )
    monkeypatch.setattr(settings, "database_url", url)
    command.upgrade(Config("alembic.ini"), "head")
    engine = create_engine(url)
    sessions = sessionmaker(engine, autoflush=False)
    try:
        with sessions() as db:
            user = User(email=f"{uuid4()}@example.com", password_hash=str(uuid4()))
            group = Household(name="Future plan concurrency", is_personal=False)
            db.add_all([user, group])
            db.flush()
            user.profile = UserProfile(user_id=user.id, household_size=2, weekly_meal_target=2)
            recipe = Recipe(
                owner_user_id=user.id,
                name="Concurrent planned meal",
                servings=2,
                content_hash=str(uuid4()),
                validation_status="approved",
            )
            db.add(recipe)
            db.flush()
            db.add_all(
                [
                    HouseholdMember(user_id=user.id, household_id=group.id, role="owner"),
                    HouseholdRecipe(household_id=group.id, recipe_id=recipe.id),
                ]
            )
            db.commit()
            user_id, group_id, recipe_id = user.id, group.id, recipe.id
        barrier = threading.Barrier(4)
        week = date(2026, 11, 9)

        def add(_: int) -> str:
            with sessions() as db:
                user = db.get(User, user_id)
                assert user
                barrier.wait(timeout=10)
                payload = WeeklySlotCreate(recipe_id=recipe_id, slot_date=week, servings=2)
                result = (
                    add_meal(group_id, payload, db, user, week_start=week)
                    if group_plan
                    else add_slot(payload, db, user, week_start=week)
                )
                return str(result["id"])

        with freeze("2026-11-08T18:00:00+00:00"):
            with ThreadPoolExecutor(max_workers=4) as workers:
                plan_ids = list(workers.map(add, range(4)))
        assert len(set(plan_ids)) == 1
        with sessions() as db:
            scope = (
                WeeklyPlan.household_id == group_id if group_plan else WeeklyPlan.user_id == user_id
            )
            assert db.scalar(select(func.count()).select_from(WeeklyPlan).where(scope)) == 1
            slots = list(
                db.scalars(
                    select(WeeklyPlanSlot).where(WeeklyPlanSlot.weekly_plan_id == plan_ids[0])
                )
            )
            assert len(slots) == 4
            assert all(slot.recipe_id == recipe_id and slot.slot_date == week for slot in slots)
            assert len({slot.sort_order for slot in slots}) == 4
            owner = db.get(User, user_id)
            household = db.get(Household, group_id)
            assert owner and household
            values = (
                household.planning_settings
                if group_plan
                else owner.profile.notification_preferences
            )
            assert preplanned_weeks(values or {}) == [week.isoformat()]
    finally:
        engine.dispose()
