from collections.abc import Callable
from datetime import UTC, datetime, timedelta
from typing import Any
from uuid import uuid4

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models.entities import (
    MealMacroConfirmation,
    MealProposalMember,
    User,
    UserSubscription,
)
from app.services import planning


def setup_group(
    client: TestClient,
    db_session: Session,
    auth_headers: dict[str, str],
    grant_basic_access: Callable[[str], UserSubscription],
) -> tuple[str, dict[str, str], dict[str, Any]]:
    group = client.post(
        "/api/v1/households", headers=auth_headers, json={"name": "Shared week"}
    ).json()
    register = client.post(
        "/api/v1/auth/register",
        json={
            "email": "member@example.com",
            "password": "change-me-123",
            "terms_accepted": True,
            "privacy_accepted": True,
        },
    )
    member = {"Authorization": f"Bearer {register.json()['access_token']}"}
    grant_basic_access("member@example.com")
    user = db_session.scalar(select(User).where(User.email == "member@example.com"))
    assert user
    user.email_verified = True
    db_session.commit()
    assert (
        client.post(
            "/api/v1/households/join", headers=member, json={"invite_code": group["invite_code"]}
        ).status_code
        == 200
    )
    recipe = client.post(
        "/api/v1/recipes",
        headers=auth_headers,
        json={
            "name": "Shared lentils",
            "servings": 2,
            "ingredients": [
                {
                    "original_text": "2 red onions",
                    "normalized_name": "red onion",
                    "quantity": 2,
                    "unit": "each",
                }
            ],
            "instructions": [],
            "accept_placeholder_photo": True,
            "nutrition": {"calories": 150, "protein_g": 10},
        },
    ).json()
    return f"/api/v1/households/{group['id']}", member, recipe


def test_curated_deck_proposal_approval_and_personal_isolation(
    client: TestClient,
    db_session: Session,
    auth_headers: dict[str, str],
    grant_basic_access: Callable[[str], UserSubscription],
) -> None:
    base, member, recipe = setup_group(client, db_session, auth_headers, grant_basic_access)
    assert client.get(f"{base}/library?discover=true", headers=member).json()["items"] == []
    assert (
        client.patch(
            f"{base}/discover-choices", headers=member, json={"enable_ids": [recipe["id"]]}
        ).status_code
        == 403
    )
    assert (
        client.patch(
            f"{base}/discover-choices", headers=auth_headers, json={"enable_ids": [recipe["id"]]}
        ).status_code
        == 200
    )
    swipe = {
        "household_id": base.split("/")[-1],
        "recipe_id": recipe["id"],
        "action": "add",
        "session_id": "fixture",
        "request_id": "member-proposal",
    }
    assert client.post("/api/v1/recipes/swipes", headers=member, json=swipe).status_code == 200
    assert client.post("/api/v1/recipes/swipes", headers=member, json=swipe).status_code == 200
    assert len(db_session.scalars(select(MealProposalMember)).all()) == 1
    assert client.get(f"{base}/weekly-plans/current", headers=member).json()["slots"] == []
    proposal = client.get(f"{base}/proposals", headers=member).json()["items"][0]
    assert (
        client.post(
            f"{base}/proposals/{proposal['id']}/vote", headers=member, json={"vote": "yes"}
        ).status_code
        == 200
    )
    assert (
        client.post(
            f"{base}/proposals/{proposal['id']}/decision",
            headers=member,
            json={"action": "approve"},
        ).status_code
        == 403
    )
    assert (
        client.post(
            f"{base}/proposals/{proposal['id']}/decision",
            headers=auth_headers,
            json={"action": "approve", "servings": 4},
        ).status_code
        == 200
    )
    assert (
        client.post(
            f"{base}/proposals/{proposal['id']}/decision",
            headers=auth_headers,
            json={"action": "approve"},
        ).status_code
        == 409
    )
    shared = client.get(f"{base}/weekly-plans/current", headers=member).json()
    assert len(shared["slots"]) == 1 and shared["slots"][0]["servings"] == 4
    assert not any(
        slot["recipe_id"]
        for slot in client.get("/api/v1/weekly-plans/current", headers=auth_headers).json()["slots"]
    )
    assert (
        client.post("/api/v1/recipes/swipes/member-proposal/undo", headers=member).status_code
        == 409
    )
    assert (
        client.get(f"{base}/grocery-lists/current", headers=member).json()["items"][0]["quantity"]
        == 4
    )
    assert (
        client.post(f"{base}/weekly-plans/current/reset", headers=member, json={}).status_code
        == 403
    )
    assert (
        client.patch(
            f"{base}/discover-choices", headers=auth_headers, json={"disable_ids": [recipe["id"]]}
        ).status_code
        == 200
    )
    assert len(client.get(f"{base}/weekly-plans/current", headers=member).json()["slots"]) == 1
    assert (
        client.post(
            "/api/v1/recipes/swipes", headers=member, json=swipe | {"request_id": "stale-card"}
        ).status_code
        == 409
    )


def test_extra_requests_shared_pantry_and_macro_portions(
    client: TestClient,
    db_session: Session,
    auth_headers: dict[str, str],
    grant_basic_access: Callable[[str], UserSubscription],
) -> None:
    base, member, recipe = setup_group(client, db_session, auth_headers, grant_basic_access)
    proposal = client.post(
        f"{base}/proposals", headers=member, json={"recipe_id": recipe["id"]}
    ).json()
    assert client.get(f"{base}/proposals", headers=member).json()["items"][0]["extra_request"]
    assert (
        client.post(
            f"{base}/proposals/{proposal['id']}/decision",
            headers=auth_headers,
            json={"action": "approve", "servings": 6},
        ).status_code
        == 200
    )
    slot = client.get(f"{base}/weekly-plans/current", headers=member).json()["slots"][0]
    # Private pantry stock never covers a group's requirements.
    client.post(
        "/api/v1/grocery-lists/pantry",
        headers=member,
        json={
            "normalized_name": "red onion",
            "coverage_mode": "quantity",
            "quantity": 100,
            "unit": "each",
        },
    )
    groceries = client.get(f"{base}/grocery-lists/current", headers=member).json()
    item = groceries["items"][0]
    assert item["quantity"] == 6
    assert (
        client.post(
            f"{base}/grocery-lists/items/{item['id']}/pantry",
            headers=member,
            json={"coverage_mode": "quantity", "quantity": 2, "unit": "each"},
        ).status_code
        == 200
    )
    assert (
        client.get(f"{base}/grocery-lists/current", headers=auth_headers).json()["items"][0][
            "quantity"
        ]
        == 4
    )
    sub = db_session.scalar(
        select(UserSubscription).join(User).where(User.email == "member@example.com")
    )
    assert sub
    sub.plan_key = "premium_macros_monthly"
    db_session.commit()
    result = client.post(
        "/api/v1/macros/confirmations",
        headers=member,
        json={
            "weekly_plan_slot_id": slot["id"],
            "recipe_id": recipe["id"],
            "status": "ate",
            "servings_consumed": 1,
        },
    )
    assert result.status_code == 200, result.text
    assert result.json()["calories"] == 150
    assert len(db_session.scalars(select(MealMacroConfirmation)).all()) == 1


def test_group_week_rollover_and_cross_group_permissions(
    client: TestClient,
    db_session: Session,
    auth_headers: dict[str, str],
    grant_basic_access: Callable[[str], UserSubscription],
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    base, member, recipe = setup_group(client, db_session, auth_headers, grant_basic_access)
    first = client.get(f"{base}/weekly-plans/current", headers=member).json()
    day = first["week_start"]
    add = client.post(
        f"{base}/weekly-plans/current/slots",
        headers=auth_headers,
        json={"recipe_id": recipe["id"], "slot_date": day, "servings": 3},
    )
    assert add.status_code == 200
    now = datetime.now(UTC) + timedelta(days=7)
    monkeypatch.setattr(planning, "now_utc", lambda: now)
    next_week = client.get(f"{base}/weekly-plans/current", headers=member).json()
    assert next_week["week_start"] != first["week_start"]
    assert next_week["slots"][0]["servings"] == 3
    sub = db_session.scalar(
        select(UserSubscription).join(User).where(User.email == "member@example.com")
    )
    assert sub
    sub.plan_key = "premium_macros_monthly"
    db_session.commit()
    other = client.post("/api/v1/households", headers=member, json={"name": "Other"}).json()
    other_base = f"/api/v1/households/{other['id']}"
    assert client.get(f"{other_base}/library", headers=auth_headers).status_code == 404
    assert client.get(f"{other_base}/library", headers=member).json()["items"] == []
    assert (
        client.put(
            f"{other_base}/weekly-plans/current/slots/{next_week['slots'][0]['id']}",
            headers=member,
            json={"servings": 5},
        ).status_code
        == 404
    )


def test_shared_grocery_offline_receipts_revalidate_membership(
    client: TestClient,
    db_session: Session,
    auth_headers: dict[str, str],
    grant_basic_access: Callable[[str], UserSubscription],
) -> None:
    base, member, recipe = setup_group(client, db_session, auth_headers, grant_basic_access)
    client.post(
        f"{base}/weekly-plans/current/slots", headers=auth_headers, json={"recipe_id": recipe["id"]}
    )
    item = client.get(f"{base}/grocery-lists/current", headers=member).json()["items"][0]
    payload = {
        "operation_id": str(uuid4()),
        "kind": "grocery_update",
        "household_id": base.split("/")[-1],
        "target_id": item["id"],
        "revision": item["revision"],
        "values": {"is_checked": True},
    }
    assert client.post("/api/v1/offline/sync", headers=member, json=payload).status_code == 200
    assert client.post("/api/v1/offline/sync", headers=member, json=payload).status_code == 200
    client.post(f"{base}/grocery-lists/current/regenerate", headers=auth_headers)
    assert (
        client.get(f"{base}/grocery-lists/current", headers=member).json()["items"][0]["id"]
        == item["id"]
    )
    assert client.post(f"{base}/leave", headers=member).status_code == 200
    assert client.post("/api/v1/offline/sync", headers=member, json=payload).status_code == 404


def test_proposals_withdraw_individually_and_ownership_transfer_preserves_group_plan(
    client: TestClient,
    db_session: Session,
    auth_headers: dict[str, str],
    grant_basic_access: Callable[[str], UserSubscription],
) -> None:
    base, member, recipe = setup_group(client, db_session, auth_headers, grant_basic_access)
    client.patch(
        f"{base}/discover-choices", headers=auth_headers, json={"enable_ids": [recipe["id"]]}
    )
    assert (
        client.post(
            "/api/v1/recipes/swipes",
            headers=member,
            json={
                "household_id": base.split("/")[-1],
                "recipe_id": recipe["id"],
                "action": "add",
                "session_id": "member",
                "request_id": "withdraw-one",
            },
        ).status_code
        == 200
    )
    proposal = client.post(
        f"{base}/proposals", headers=auth_headers, json={"recipe_id": recipe["id"]}
    ).json()
    assert client.get(f"{base}/proposals", headers=member).json()["items"][0]["proposer_count"] == 2
    assert (
        client.post("/api/v1/recipes/swipes/withdraw-one/undo", headers=member).status_code == 200
    )
    remaining = client.get(f"{base}/proposals", headers=auth_headers).json()["items"][0]
    assert remaining["proposer_count"] == 1 and remaining["is_proposer"]
    assert (
        client.delete(
            f"{base}/proposals/{proposal['id']}/participation", headers=auth_headers
        ).status_code
        == 200
    )
    assert client.get(f"{base}/proposals", headers=member).json()["items"] == []
    assert (
        client.post(
            f"{base}/proposals/{proposal['id']}/decision",
            headers=auth_headers,
            json={"action": "approve"},
        ).status_code
        == 409
    )
    client.post(f"{base}/proposals", headers=member, json={"recipe_id": recipe["id"]})
    # Direct owner planning also resolves the pending proposal, without an extra meal.
    planned = client.post(
        f"{base}/weekly-plans/current/slots",
        headers=auth_headers,
        json={"recipe_id": recipe["id"], "servings": 3},
    ).json()
    assert (
        client.get(f"{base}/proposals", headers=member).json()["items"][0]["status"] == "approved"
    )
    user = db_session.scalar(select(User).where(User.email == "member@example.com"))
    assert user
    assert (
        client.post(
            f"{base}/transfer-owner", headers=auth_headers, json={"user_id": user.id}
        ).status_code
        == 200
    )
    assert (
        client.post(
            f"{base}/weekly-plans/current/slots",
            headers=auth_headers,
            json={"recipe_id": recipe["id"]},
        ).status_code
        == 403
    )
    assert (
        client.patch(
            f"{base}/discover-choices", headers=auth_headers, json={"disable_ids": [recipe["id"]]}
        ).status_code
        == 403
    )
    shared = client.get(f"{base}/weekly-plans/current", headers=member).json()
    assert shared["id"] == planned["id"] and len(shared["slots"]) == 1
    assert (
        client.put(
            f"{base}/weekly-plans/current/slots/{shared['slots'][0]['id']}",
            headers=member,
            json={"servings": 4},
        ).status_code
        == 200
    )


def test_group_reset_and_reminders_are_independent_from_personal_settings(
    client: TestClient,
    db_session: Session,
    auth_headers: dict[str, str],
    grant_basic_access: Callable[[str], UserSubscription],
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    now = datetime(2026, 10, 5, 16, tzinfo=UTC)
    monkeypatch.setattr(planning, "now_utc", lambda: now)
    base, member, recipe = setup_group(client, db_session, auth_headers, grant_basic_access)
    client.post(
        f"{base}/weekly-plans/current/slots", headers=auth_headers, json={"recipe_id": recipe["id"]}
    )
    personal = client.get("/api/v1/profile", headers=auth_headers).json()["weekly_planning"]
    config = {"mode": "automatic", "reset_day": 2, "notify": True, "time_zone": "America/New_York"}
    assert client.put(f"{base}/planning-settings", headers=member, json=config).status_code == 403
    assert (
        client.put(f"{base}/planning-settings", headers=auth_headers, json=config).status_code
        == 200
    )
    assert client.get("/api/v1/profile", headers=auth_headers).json()["weekly_planning"] == personal
    before_reset = client.get(f"{base}/weekly-plans/current", headers=member).json()
    assert len(before_reset["slots"]) == 1
    assert before_reset["reset_cycle"] == "2026-09-30"
    assert (
        client.patch(
            f"{base}/planning-reminder", headers=member, json={"notify": False}
        ).status_code
        == 200
    )
    assert not client.get("/api/v1/households/planning-reminders", headers=member).json()[0][
        "settings"
    ]["notify"]
    assert client.get("/api/v1/households/planning-reminders", headers=auth_headers).json()[0][
        "settings"
    ]["notify"]
    now = datetime(2026, 10, 7, 3, 59, tzinfo=UTC)
    assert len(client.get(f"{base}/weekly-plans/current", headers=member).json()["slots"]) == 1
    now = datetime(2026, 10, 7, 4, 1, tzinfo=UTC)
    after_reset = client.get(f"{base}/weekly-plans/current", headers=member).json()
    assert after_reset["slots"] == [] and after_reset["reset_cycle"] == "2026-10-07"
    # Repeated reconciliation doesn't erase meals newly selected after reset.
    client.post(
        f"{base}/weekly-plans/current/slots", headers=auth_headers, json={"recipe_id": recipe["id"]}
    )
    assert len(client.get(f"{base}/weekly-plans/current", headers=member).json()["slots"]) == 1


def test_group_deck_rejects_unshared_private_recipes_and_applies_safety(
    client: TestClient,
    db_session: Session,
    auth_headers: dict[str, str],
    grant_basic_access: Callable[[str], UserSubscription],
) -> None:
    base, member, recipe = setup_group(client, db_session, auth_headers, grant_basic_access)
    kitchen = next(
        row
        for row in client.get("/api/v1/households", headers=auth_headers).json()
        if row["is_personal"]
    )
    client.post(f"/api/v1/households/{kitchen['id']}/switch", headers=auth_headers)
    private = client.post(
        "/api/v1/recipes",
        headers=auth_headers,
        json={
            "name": "Private only",
            "servings": 1,
            "ingredients": [],
            "instructions": [],
            "accept_placeholder_photo": True,
        },
    ).json()
    assert (
        client.patch(
            f"{base}/discover-choices", headers=auth_headers, json={"enable_ids": [private["id"]]}
        ).status_code
        == 422
    )
    assert (
        client.post(
            f"{base}/proposals", headers=member, json={"recipe_id": private["id"]}
        ).status_code
        == 404
    )
    assert (
        client.patch(
            f"{base}/discover-choices",
            headers=auth_headers,
            json={"bulk_action": "enable", "q": "Shared"},
        ).status_code
        == 200
    )
    assert [
        item["recipe"]["id"]
        for item in client.get(f"{base}/library?discover=true", headers=member).json()["items"]
    ] == [recipe["id"]]
    client.put("/api/v1/profile", headers=member, json={"allergens": ["red onion"]})
    client.patch(
        f"{base}/settings",
        headers=auth_headers,
        json={"allergen_filter_mode": "block", "dislike_filter_mode": "warn"},
    )
    assert client.get(f"{base}/library?discover=true", headers=member).json()["items"] == []
    assert (
        client.post(
            f"{base}/proposals", headers=member, json={"recipe_id": recipe["id"]}
        ).status_code
        == 422
    )
