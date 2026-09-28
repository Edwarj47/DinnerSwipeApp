from datetime import datetime, time, timedelta

from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from app.api.deps import get_current_user
from app.main import app
from app.models.entities import MealSwipe, User, UserSubscription
from app.services.recipes import current_week_start


def recipe(client: TestClient, headers: dict[str, str], name: str = "Pasta") -> str:
    result = client.post(
        "/api/v1/recipes",
        headers=headers,
        json={
            "name": name,
            "photo_url": "https://example.com/meal.jpg",
            "servings": 4,
            "ingredients": [{"original_text": "1 lb pasta"}],
            "instructions": [{"step_number": 1, "text": "Boil pasta"}],
        },
    )
    assert result.status_code == 200
    return str(result.json()["id"])


def choose(
    client: TestClient, headers: dict[str, str], recipe_id: str, action: str, key: str
) -> str:
    result = client.post(
        "/api/v1/recipes/swipes",
        headers=headers,
        json={
            "recipe_id": recipe_id,
            "action": action,
            "session_id": "test",
            "request_id": key,
        },
    )
    assert result.status_code == 200, result.text
    return str(result.json()["swipe_id"])


def test_weekly_picks_boundaries_dedup_search_and_hide(
    client: TestClient,
    auth_headers: dict[str, str],
    db_session: Session,
) -> None:
    first = recipe(client, auth_headers)
    old = recipe(client, auth_headers, "Old favorite")
    future = recipe(client, auth_headers, "Future pick")
    skipped = recipe(client, auth_headers, "Skipped")
    choose(client, auth_headers, first, "favorite", "one")
    choose(client, auth_headers, first, "favorite", "two")
    old_id = choose(client, auth_headers, old, "favorite", "old")
    future_id = choose(client, auth_headers, future, "favorite", "future")
    choose(client, auth_headers, skipped, "skip", "skip")
    start = datetime.combine(current_week_start(), time.min)
    old_event = db_session.get(MealSwipe, old_id)
    future_event = db_session.get(MealSwipe, future_id)
    assert old_event and future_event
    old_event.created_at = start - timedelta(microseconds=1)
    future_event.created_at = start + timedelta(days=7)
    db_session.commit()
    url = "/api/v1/recipes?weekly_picks=true&apply_preferences=false"
    assert [r["id"] for r in client.get(url, headers=auth_headers).json()] == [first]
    assert client.get(url + "&q=no-match", headers=auth_headers).json() == []
    assert client.get(url + "&offset=1&limit=1", headers=auth_headers).json() == []
    assert len(client.get("/api/v1/recipes", headers=auth_headers).json()) == 4
    choose(client, auth_headers, first, "hide", "hide")
    assert client.get(url, headers=auth_headers).json() == []
    totals = client.get("/api/v1/recipes/swipes/summary", headers=auth_headers).json()
    assert sum(row["selections"] for row in totals["counts"]) == 4


def test_retry_and_undo_target_exact_slot_preserve_counts_and_export(
    client: TestClient,
    auth_headers: dict[str, str],
    db_session: Session,
) -> None:
    item = recipe(client, auth_headers)
    event_id = choose(client, auth_headers, item, "add", "plan-one")
    assert choose(client, auth_headers, item, "add", "plan-one") == event_id
    first_event = db_session.get(MealSwipe, event_id)
    assert first_event
    first_slot = first_event.planned_slot_id
    second_event = choose(client, auth_headers, item, "add", "plan-two")
    second = db_session.get(MealSwipe, second_event)
    assert second
    second_slot = second.planned_slot_id
    assert first_slot != second_slot
    for _ in range(2):
        assert (
            client.post("/api/v1/recipes/swipes/plan-one/undo", headers=auth_headers).status_code
            == 200
        )
    plan = client.get("/api/v1/weekly-plans/current", headers=auth_headers).json()
    slots = {s["id"]: s for s in plan["slots"]}
    assert slots[first_slot]["recipe_id"] is None
    assert slots[second_slot]["recipe_id"] == item
    result = client.get("/api/v1/recipes/swipes/summary", headers=auth_headers).json()
    assert result["counts"] == [{"recipe_id": item, "action": "add", "selections": 2, "undone": 1}]
    assert (
        client.post("/api/v1/weekly-plans/current/reset", headers=auth_headers, json={}).status_code
        == 200
    )
    assert client.get("/api/v1/recipes?weekly_picks=true", headers=auth_headers).json() == []
    exported = client.get("/api/v1/auth/account/export", headers=auth_headers).json()[
        "meal_choices"
    ]
    assert len(exported) == 2 and all(choice["undone_at"] for choice in exported)


def test_swipe_access_and_history_are_account_scoped(
    client: TestClient,
    auth_headers: dict[str, str],
    db_session: Session,
) -> None:
    item = recipe(client, auth_headers)
    choose(client, auth_headers, item, "favorite", "owner-choice")
    owner = db_session.query(User).filter_by(email="owner@example.com").one()
    # A separate account cannot inspect or count another person's choices.
    other = User(email="other@example.com", password_hash=owner.password_hash, email_verified=True)
    db_session.add(other)
    db_session.flush()
    db_session.add(
        UserSubscription(
            user_id=other.id, plan_key="basic_monthly", status="active", source="waiver_code"
        )
    )
    db_session.commit()
    app.dependency_overrides[get_current_user] = lambda: other
    try:
        assert client.get("/api/v1/recipes?weekly_picks=true", headers=auth_headers).json() == []
        assert (
            client.get("/api/v1/recipes/swipes/summary", headers=auth_headers).json()["counts"]
            == []
        )
        assert (
            client.post(
                "/api/v1/recipes/swipes/owner-choice/undo", headers=auth_headers
            ).status_code
            == 404
        )
        result = client.post(
            "/api/v1/recipes/swipes",
            headers=auth_headers,
            json={
                "recipe_id": item,
                "action": "add",
                "session_id": "other",
            },
        )
        assert result.status_code == 404
        assert db_session.query(MealSwipe).filter_by(user_id=owner.id).count() == 1
        assert db_session.query(MealSwipe).filter_by(user_id=other.id).count() == 0
    finally:
        app.dependency_overrides.pop(get_current_user)
