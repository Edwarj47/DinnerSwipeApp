from __future__ import annotations

import importlib.util
from collections.abc import Callable
from copy import deepcopy
from datetime import UTC, date, datetime
from pathlib import Path
from typing import Any
from uuid import uuid4

import httpx
import pytest
from alembic.migration import MigrationContext
from alembic.operations import Operations
from fastapi.testclient import TestClient
from sqlalchemy import JSON, Column, Integer, MetaData, String, Table, create_engine, inspect
from sqlalchemy.orm import Session

from app.core.security import create_access_token
from app.models.entities import (
    Household,
    HouseholdDiscoverChoice,
    HouseholdMember,
    Recipe,
    User,
    UserProfile,
    UserSubscription,
    WeeklyPlan,
    WeeklyPlanSlot,
)
from app.services import planning

CATEGORIES = ["breakfast", "lunch", "dinner", "snack", "beverage", "dessert", "sauce", "other"]
PAST_WEEK = date(2026, 10, 5)
CURRENT_WEEK = date(2026, 10, 12)


@pytest.fixture(autouse=True)
def isolated_clock_and_providers(monkeypatch: pytest.MonkeyPatch) -> list[datetime]:
    clock = [datetime(2026, 10, 14, 12, tzinfo=UTC)]
    monkeypatch.setattr(planning, "now_utc", lambda: clock[0])

    def no_provider(*args: Any, **kwargs: Any) -> Any:
        raise AssertionError("Regression tests must not call an external HTTP provider")

    monkeypatch.setattr(httpx.HTTPTransport, "handle_request", no_provider)
    monkeypatch.setattr(httpx.AsyncHTTPTransport, "handle_async_request", no_provider)
    return clock


@pytest.fixture()
def make_account(db_session: Session) -> Callable[[str], tuple[User, dict[str, str]]]:
    def make(email: str) -> tuple[User, dict[str, str]]:
        user = User(email=email, password_hash=uuid4().hex, email_verified=True)
        user.profile = UserProfile(notification_preferences={})
        db_session.add(user)
        db_session.flush()
        db_session.add(
            UserSubscription(
                user_id=user.id, plan_key="basic_monthly", status="active", source="waiver_code"
            )
        )
        db_session.commit()
        return user, {"Authorization": f"Bearer {create_access_token(user.id)}"}

    return make


@pytest.fixture()
def owner(
    make_account: Callable[[str], tuple[User, dict[str, str]]],
) -> tuple[User, dict[str, str]]:
    return make_account("discovery-owner@example.com")


@pytest.fixture()
def shared_group(
    db_session: Session,
    owner: tuple[User, dict[str, str]],
    make_account: Callable[[str], tuple[User, dict[str, str]]],
) -> tuple[Household, User, dict[str, str]]:
    member, headers = make_account("history-member@example.com")
    group = Household(name="Regression kitchen", is_personal=False)
    db_session.add(group)
    db_session.flush()
    db_session.add_all(
        [
            HouseholdMember(household_id=group.id, user_id=owner[0].id, role="owner"),
            HouseholdMember(household_id=group.id, user_id=member.id, role="member"),
        ]
    )
    db_session.commit()
    return group, member, headers


def recipe_fixture(db: Session, user: User, meal_type: str = "dinner", **values: Any) -> Recipe:
    recipe = Recipe(
        owner_user_id=user.id,
        name=f"Fixture {meal_type}",
        content_hash=uuid4().hex,
        meal_type=meal_type,
        image_status="missing",
        **values,
    )
    db.add(recipe)
    db.commit()
    return recipe


def seed_history(
    db: Session, user: User, clock: list[datetime], household_id: str | None = None
) -> tuple[WeeklyPlan, WeeklyPlanSlot, Recipe]:
    clock[0] = datetime(2026, 10, 7, 12, tzinfo=UTC)
    recipe = recipe_fixture(db, user, prep_minutes=10, cook_minutes=20, difficulty="medium")
    plan = WeeklyPlan(
        user_id=None if household_id else user.id,
        household_id=household_id,
        week_start=PAST_WEEK,
        meal_target=3,
    )
    db.add(plan)
    db.commit()
    slot = WeeklyPlanSlot(
        weekly_plan_id=plan.id,
        recipe_id=recipe.id,
        slot_date=PAST_WEEK,
        servings=6,
        is_locked=True,
        sort_order=2,
    )
    db.add(slot)
    db.commit()
    assert slot.history_snapshot is not None
    clock[0] = datetime(2026, 10, 14, 12, tzinfo=UTC)
    return plan, slot, recipe


def history_url(household_id: str | None = None, week: date = PAST_WEEK) -> str:
    scope = f"/households/{household_id}" if household_id else ""
    return f"/api/v1{scope}/weekly-plans/history?week_start={week}"


def database_state(db: Session) -> dict[str, Any]:
    return {
        "plans": [(p.id, p.week_start, p.meal_target) for p in db.query(WeeklyPlan).all()],
        "slots": [
            (s.id, s.recipe_id, s.slot_date, s.servings, s.is_locked, deepcopy(s.history_snapshot))
            for s in db.query(WeeklyPlanSlot).all()
        ],
        "profiles": [(p.id, deepcopy(p.notification_preferences)) for p in db.query(UserProfile)],
        "groups": [(g.id, deepcopy(g.planning_settings)) for g in db.query(Household)],
    }


def test_discover_defaults_and_patch_persist_without_replacing_other_preferences(
    client: TestClient, db_session: Session, owner: tuple[User, dict[str, str]]
) -> None:
    user, headers = owner
    user.profile.notification_preferences = {
        "email": True,
        "experience_preferences": {"mode": "nutrition"},
    }
    db_session.commit()
    assert client.get("/api/v1/profile", headers=headers).json()["discover_preferences"] == {
        "categories": CATEGORIES
    }
    response = client.patch(
        "/api/v1/profile/discover", headers=headers, json={"categories": ["other", "dinner"]}
    )
    assert response.status_code == 200, response.text
    db_session.expire_all()
    profile = client.get("/api/v1/profile", headers=headers).json()
    assert profile["discover_preferences"] == {"categories": ["dinner", "other"]}
    assert profile["notification_preferences"]["email"] is True
    assert profile["notification_preferences"]["experience_preferences"] == {"mode": "nutrition"}


@pytest.mark.parametrize("selected", [[], ["dinner", "other"]])
@pytest.mark.parametrize(
    "notifications", [None, {}, {"discover_filters": {"categories": ["breakfast"]}}]
)
def test_legacy_profile_put_cannot_clear_or_overwrite_discover_filters(
    client: TestClient,
    owner: tuple[User, dict[str, str]],
    notifications: dict[str, Any] | None,
    selected: list[str],
) -> None:
    headers = owner[1]
    assert (
        client.patch(
            "/api/v1/profile/discover", headers=headers, json={"categories": selected}
        ).status_code
        == 200
    )
    response = client.put(
        "/api/v1/profile",
        headers=headers,
        json={
            "household_size": 4,
            **({"notification_preferences": notifications} if notifications is not None else {}),
        },
    )
    assert response.status_code == 200, response.text
    assert response.json()["household_size"] == 4
    assert response.json()["discover_preferences"] == {"categories": selected}
    assert client.get("/api/v1/profile", headers=headers).json()["discover_preferences"] == {
        "categories": selected
    }


def test_legacy_profile_put_cannot_inject_discover_preferences(
    client: TestClient, owner: tuple[User, dict[str, str]]
) -> None:
    response = client.put(
        "/api/v1/profile",
        headers=owner[1],
        json={"notification_preferences": {"discover_filters": {"categories": []}}},
    )
    assert response.status_code == 200
    assert response.json()["discover_preferences"] == {"categories": CATEGORIES}
    assert "discover_filters" not in response.json()["notification_preferences"]


@pytest.mark.parametrize(
    "payload",
    [
        {"categories": ["dinner", "dinner"]},
        {"categories": ["drinks"]},
        {"categories": ["unknown"]},
        {"categories": ["DINNER"]},
        {"categories": "dinner"},
        {"categories": None},
        {"categories": [], "extra": True},
    ],
)
def test_invalid_discover_patch_is_rejected_without_changing_preferences(
    client: TestClient, owner: tuple[User, dict[str, str]], payload: dict[str, Any]
) -> None:
    response = client.patch("/api/v1/profile/discover", headers=owner[1], json=payload)
    assert response.status_code == 422
    assert client.get("/api/v1/profile", headers=owner[1]).json()["discover_preferences"] == {
        "categories": CATEGORIES
    }


def test_discover_preferences_require_authentication_and_are_account_scoped(
    client: TestClient,
    owner: tuple[User, dict[str, str]],
    make_account: Callable[[str], tuple[User, dict[str, str]]],
) -> None:
    _, other_headers = make_account("other-discover@example.com")
    assert client.patch("/api/v1/profile/discover", json={"categories": []}).status_code == 401
    assert (
        client.patch(
            "/api/v1/profile/discover", headers=owner[1], json={"categories": []}
        ).status_code
        == 200
    )
    assert client.get("/api/v1/profile", headers=other_headers).json()["discover_preferences"] == {
        "categories": CATEGORIES
    }


@pytest.mark.parametrize(
    ("category", "meal_type"),
    [
        ("breakfast", " Breakfast "),
        ("lunch", "lunch"),
        ("dinner", ""),
        ("snack", "snacks"),
        ("beverage", " Beverages "),
        ("beverage", "drink"),
        ("beverage", "DRINKS"),
        ("dessert", "desserts"),
        ("sauce", "sauces"),
        ("other", "side"),
        ("other", "unknown legacy category"),
        ("other", "other"),
    ],
)
def test_discover_filters_known_categories_aliases_and_other_without_filtering_library(
    client: TestClient,
    db_session: Session,
    owner: tuple[User, dict[str, str]],
    category: str,
    meal_type: str,
) -> None:
    wanted = recipe_fixture(db_session, owner[0], meal_type)
    excluded = recipe_fixture(
        db_session, owner[0], "breakfast" if category != "breakfast" else "dinner"
    )
    assert (
        client.patch(
            "/api/v1/profile/discover", headers=owner[1], json={"categories": [category]}
        ).status_code
        == 200
    )
    response = client.get("/api/v1/recipes?discover=true", headers=owner[1])
    assert response.status_code == 200, response.text
    assert {r["id"] for r in response.json()} == {wanted.id}
    library = client.get("/api/v1/recipes?collection=library", headers=owner[1])
    assert {r["id"] for r in library.json()} == {wanted.id, excluded.id}


def test_empty_categories_hide_discover_but_not_personal_library(
    client: TestClient, db_session: Session, owner: tuple[User, dict[str, str]]
) -> None:
    recipe = recipe_fixture(db_session, owner[0])
    client.patch("/api/v1/profile/discover", headers=owner[1], json={"categories": []})
    assert client.get("/api/v1/recipes?discover=true", headers=owner[1]).json() == []
    assert [r["id"] for r in client.get("/api/v1/recipes", headers=owner[1]).json()] == [recipe.id]


def test_group_discover_filters_are_personal_and_preserve_curated_choices_and_library(
    client: TestClient,
    db_session: Session,
    owner: tuple[User, dict[str, str]],
    shared_group: tuple[Household, User, dict[str, str]],
) -> None:
    group, _, member_headers = shared_group
    dinner = recipe_fixture(db_session, owner[0], household_id=group.id)
    drink = recipe_fixture(db_session, owner[0], "drinks", household_id=group.id)
    not_curated = recipe_fixture(db_session, owner[0], "beverage", household_id=group.id)
    base = f"/api/v1/households/{group.id}"
    assert (
        client.patch(
            f"{base}/discover-choices", headers=owner[1], json={"enable_ids": [dinner.id, drink.id]}
        ).status_code
        == 200
    )
    client.patch("/api/v1/profile/discover", headers=owner[1], json={"categories": ["beverage"]})
    filtered = client.get(f"{base}/library?discover=true", headers=owner[1]).json()
    assert [item["recipe"]["id"] for item in filtered["items"]] == [drink.id]
    assert filtered["total"] == 1 and filtered["enabled_count"] == 2
    assert {
        item["recipe"]["id"]
        for item in client.get(f"{base}/library?discover=true", headers=member_headers).json()[
            "items"
        ]
    } == {dinner.id, drink.id}
    client.patch("/api/v1/profile/discover", headers=owner[1], json={"categories": []})
    assert client.get(f"{base}/library?discover=true", headers=owner[1]).json()["items"] == []
    library = client.get(f"{base}/library", headers=owner[1]).json()
    assert {item["recipe"]["id"] for item in library["items"]} == {
        dinner.id,
        drink.id,
        not_curated.id,
    }
    assert {item["recipe"]["id"] for item in library["items"] if item["enabled"]} == {
        dinner.id,
        drink.id,
    }
    assert db_session.query(HouseholdDiscoverChoice).filter_by(household_id=group.id).count() == 2
    client.patch("/api/v1/profile/discover", headers=owner[1], json={"categories": CATEGORIES})
    assert {
        item["recipe"]["id"]
        for item in client.get(f"{base}/library?discover=true", headers=owner[1]).json()["items"]
    } == {dinner.id, drink.id}


@pytest.mark.parametrize("group_scope", [False, True])
@pytest.mark.parametrize("delete_recipe", [False, True])
def test_history_snapshot_survives_recipe_rename_and_deletion(
    client: TestClient,
    db_session: Session,
    owner: tuple[User, dict[str, str]],
    shared_group: tuple[Household, User, dict[str, str]],
    isolated_clock_and_providers: list[datetime],
    group_scope: bool,
    delete_recipe: bool,
) -> None:
    group_id = shared_group[0].id if group_scope else None
    plan, slot, recipe = seed_history(db_session, owner[0], isolated_clock_and_providers, group_id)
    original = deepcopy(slot.history_snapshot)
    assert original is not None
    owner[0].profile.notification_preferences = {
        planning.SETTINGS_KEY: {"mode": "automatic", "reset_day": 0, "time_zone": "UTC"},
        planning.CURSOR_KEY: "2026-09-28",
    }
    shared_group[0].planning_settings = {
        "mode": "automatic",
        "reset_day": 0,
        "time_zone": "UTC",
        "cursor": "2026-09-28",
    }
    recipe.name = "Renamed after planning"
    recipe.prep_minutes = 1
    recipe.cook_minutes = 2
    recipe.difficulty = "easy"
    # Simulate FK cleanup during permanent recipe deletion, without retaining the recipe row.
    if delete_recipe:
        slot.recipe_id = None
        db_session.delete(recipe)
    db_session.commit()
    db_session.expire_all()
    before = database_state(db_session)
    response = client.get(history_url(group_id), headers=owner[1])
    assert response.status_code == 200, response.text
    result = response.json()
    assert result["id"] == plan.id and result["read_only"] is True
    saved = result["slots"][0]
    assert {
        key: saved[key]
        for key in ("recipe_id", "recipe_name", "recipe_total_minutes", "recipe_difficulty")
    } == {
        key: original[key]
        for key in ("recipe_id", "recipe_name", "recipe_total_minutes", "recipe_difficulty")
    }
    assert saved["slot_date"] == str(PAST_WEEK)
    assert saved["servings"] == 6 and saved["sort_order"] == 2 and saved["is_locked"] is True
    assert database_state(db_session) == before


@pytest.mark.parametrize("group_scope", [False, True])
def test_current_slot_assignment_captures_snapshot_before_flush(
    client: TestClient,
    db_session: Session,
    owner: tuple[User, dict[str, str]],
    shared_group: tuple[Household, User, dict[str, str]],
    group_scope: bool,
) -> None:
    group_id = shared_group[0].id if group_scope else None
    recipe = recipe_fixture(
        db_session, owner[0], prep_minutes=5, cook_minutes=15, household_id=group_id
    )
    scope = f"/households/{group_id}" if group_id else ""
    response = client.post(
        f"/api/v1{scope}/weekly-plans/current/slots",
        headers=owner[1],
        json={"recipe_id": recipe.id},
    )
    assert response.status_code == 200, response.text
    slot = db_session.query(WeeklyPlanSlot).filter_by(recipe_id=recipe.id).one()
    assert slot.history_snapshot == {
        "recipe_id": recipe.id,
        "recipe_name": recipe.name,
        "recipe_total_minutes": 20,
        "recipe_difficulty": "easy",
        "meal_type": "dinner",
    }


@pytest.mark.parametrize("group_scope", [False, True])
def test_empty_history_creates_no_plans_slots_or_rollover(
    client: TestClient,
    db_session: Session,
    owner: tuple[User, dict[str, str]],
    shared_group: tuple[Household, User, dict[str, str]],
    group_scope: bool,
) -> None:
    owner[0].profile.notification_preferences = {
        planning.SETTINGS_KEY: {"mode": "automatic", "reset_day": 0, "time_zone": "UTC"},
        planning.CURSOR_KEY: "2026-09-28",
    }
    shared_group[0].planning_settings = {
        "mode": "automatic",
        "reset_day": 0,
        "time_zone": "UTC",
        "cursor": "2026-09-28",
    }
    db_session.commit()
    before = database_state(db_session)
    group_id = shared_group[0].id if group_scope else None
    for _ in range(2):
        response = client.get(history_url(group_id), headers=owner[1])
        assert response.status_code == 200, response.text
        assert response.json() == {
            "id": None,
            "household_id": group_id,
            "week_start": str(PAST_WEEK),
            "meal_target": 0,
            "read_only": True,
            "slots": [],
        }
        assert database_state(db_session) == before
        assert not db_session.new and not db_session.dirty


@pytest.mark.parametrize("group_scope", [False, True])
@pytest.mark.parametrize("week", [CURRENT_WEEK, date(2026, 10, 19), date(2026, 10, 6)])
def test_history_rejects_current_future_and_non_monday_dates_without_writes(
    client: TestClient,
    db_session: Session,
    owner: tuple[User, dict[str, str]],
    shared_group: tuple[Household, User, dict[str, str]],
    group_scope: bool,
    week: date,
) -> None:
    before = database_state(db_session)
    response = client.get(
        history_url(shared_group[0].id if group_scope else None, week), headers=owner[1]
    )
    assert response.status_code == 422
    assert database_state(db_session) == before


def test_history_owner_isolation_and_group_member_authorization(
    client: TestClient,
    db_session: Session,
    owner: tuple[User, dict[str, str]],
    shared_group: tuple[Household, User, dict[str, str]],
    make_account: Callable[[str], tuple[User, dict[str, str]]],
    isolated_clock_and_providers: list[datetime],
) -> None:
    personal, _, _ = seed_history(db_session, owner[0], isolated_clock_and_providers)
    shared, _, _ = seed_history(
        db_session, owner[0], isolated_clock_and_providers, shared_group[0].id
    )
    _, outsider = make_account("history-outsider@example.com")
    before = database_state(db_session)
    assert client.get(history_url(), headers=owner[1]).json()["id"] == personal.id
    assert client.get(history_url(), headers=outsider).json()["id"] is None
    assert (
        client.get(history_url(shared_group[0].id), headers=shared_group[2]).json()["id"]
        == shared.id
    )
    assert client.get(history_url(shared_group[0].id), headers=outsider).status_code == 404
    assert client.get(history_url()).status_code == 401
    assert client.get(history_url(shared_group[0].id)).status_code == 401
    membership = (
        db_session.query(HouseholdMember)
        .filter_by(household_id=shared_group[0].id, user_id=shared_group[1].id)
        .one()
    )
    db_session.delete(membership)
    db_session.commit()
    assert client.get(history_url(shared_group[0].id), headers=shared_group[2]).status_code == 404
    assert database_state(db_session) == before


@pytest.mark.parametrize("group_scope", [False, True])
@pytest.mark.parametrize("method", ["PUT", "DELETE"])
def test_past_slot_cannot_be_mutated_through_current_week_routes(
    client: TestClient,
    db_session: Session,
    owner: tuple[User, dict[str, str]],
    shared_group: tuple[Household, User, dict[str, str]],
    isolated_clock_and_providers: list[datetime],
    group_scope: bool,
    method: str,
) -> None:
    group_id = shared_group[0].id if group_scope else None
    _, slot, _ = seed_history(db_session, owner[0], isolated_clock_and_providers, group_id)
    original = (slot.recipe_id, slot.slot_date, slot.servings, deepcopy(slot.history_snapshot))
    scope = f"/households/{group_id}" if group_id else ""
    path = f"/api/v1{scope}/weekly-plans/current/slots/{slot.id}"
    response = client.request(
        method, path, headers=owner[1], json={"servings": 9} if method == "PUT" else None
    )
    assert response.status_code == 404, response.text
    if group_id:
        response = client.request(
            method,
            path,
            headers=shared_group[2],
            json={"servings": 9} if method == "PUT" else None,
        )
        assert response.status_code == 403
    db_session.refresh(slot)
    assert (slot.recipe_id, slot.slot_date, slot.servings, slot.history_snapshot) == original


def test_history_migration_is_additive_and_backfills_existing_slot_metadata(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    migration = (
        Path(__file__).resolve().parents[2] / "alembic/versions/f431d986a201_weekly_history.py"
    )
    spec = importlib.util.spec_from_file_location("history_migration", migration)
    assert spec and spec.loader
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    metadata = MetaData()
    recipes = Table(
        "recipes",
        metadata,
        Column("id", String, primary_key=True),
        Column("name", String),
        Column("total_minutes", Integer),
        Column("prep_minutes", Integer),
        Column("cook_minutes", Integer),
        Column("difficulty", String),
        Column("meal_type", String),
    )
    slots = Table(
        "weekly_plan_slots",
        metadata,
        Column("id", String, primary_key=True),
        Column("recipe_id", String),
    )
    engine = create_engine("sqlite:///:memory:")
    try:
        with engine.begin() as connection:
            metadata.create_all(connection)
            connection.execute(
                recipes.insert(),
                {
                    "id": "legacy-recipe",
                    "name": "Legacy soup",
                    "total_minutes": 99,
                    "prep_minutes": 5,
                    "cook_minutes": 20,
                    "difficulty": "easy",
                    "meal_type": "dinner",
                },
            )
            connection.execute(
                slots.insert(),
                [
                    {"id": "legacy-slot", "recipe_id": "legacy-recipe"},
                    {"id": "empty-slot", "recipe_id": None},
                ],
            )
            monkeypatch.setattr(module, "op", Operations(MigrationContext.configure(connection)))
            module.upgrade()
            upgraded = Table("weekly_plan_slots", MetaData(), autoload_with=connection)
            snapshot = (
                connection.execute(upgraded.select().where(upgraded.c.id == "legacy-slot"))
                .mappings()
                .one()["history_snapshot"]
            )
            assert snapshot == {
                "recipe_id": "legacy-recipe",
                "recipe_name": "Legacy soup",
                "recipe_total_minutes": 25,
                "recipe_difficulty": "easy",
                "meal_type": "dinner",
                "backfilled": True,
            }
            assert isinstance(upgraded.c.history_snapshot.type, JSON)
            assert len(connection.execute(upgraded.select()).all()) == 2
            assert (
                connection.execute(upgraded.select().where(upgraded.c.id == "empty-slot"))
                .mappings()
                .one()["history_snapshot"]
                is None
            )
            module.downgrade()
            assert "history_snapshot" not in {
                column["name"] for column in inspect(connection).get_columns("weekly_plan_slots")
            }
            assert len(connection.execute(slots.select()).all()) == 2
            assert connection.execute(recipes.select()).mappings().one()["name"] == "Legacy soup"
    finally:
        engine.dispose()
