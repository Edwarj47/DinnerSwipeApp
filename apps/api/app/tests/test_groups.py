from __future__ import annotations

from collections.abc import Callable

from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from app.models.entities import User


def test_household_invite_and_vote(client: TestClient, auth_headers: dict[str, str]) -> None:
    household = client.get("/api/v1/households/current", headers=auth_headers)
    assert household.status_code == 200
    assert len(household.json()["invite_code"]) == 8

    recipe = client.post(
        "/api/v1/recipes",
        headers=auth_headers,
        json={
            "name": "Group vote dinner",
            "photo_url": "https://example.com/group.jpg",
            "servings": 4,
            "ingredients": [{"original_text": "1 lb chicken"}],
            "instructions": [{"step_number": 1, "text": "Cook chicken"}],
        },
    ).json()
    vote = client.post(
        "/api/v1/households/current/votes",
        headers=auth_headers,
        json={"recipe_id": recipe["id"], "vote": "yes"},
    )
    assert vote.status_code == 200
    assert vote.json()["votes"][0]["yes"] == 1


def test_unverified_user_cannot_join_or_vote(
    client: TestClient, auth_headers: dict[str, str]
) -> None:
    household = client.get("/api/v1/households/current", headers=auth_headers).json()
    recipe = client.post(
        "/api/v1/recipes",
        headers=auth_headers,
        json={
            "name": "Verification gated dinner",
            "photo_url": "https://example.com/gated.jpg",
            "servings": 4,
            "ingredients": [{"original_text": "1 lb chicken"}],
            "instructions": [{"step_number": 1, "text": "Cook chicken"}],
        },
    ).json()
    member = client.post(
        "/api/v1/auth/register",
        json={
            "email": "unverified-member@example.com",
            "password": "change-me-123",
            "terms_accepted": True,
            "privacy_accepted": True,
        },
    )
    member_headers = {"Authorization": f"Bearer {member.json()['access_token']}"}

    joined = client.post(
        "/api/v1/households/join",
        headers=member_headers,
        json={"invite_code": household["invite_code"]},
    )
    vote = client.post(
        "/api/v1/households/current/votes",
        headers=member_headers,
        json={"recipe_id": recipe["id"], "vote": "yes"},
    )

    assert joined.status_code == 403
    assert vote.status_code == 403
    assert joined.json()["detail"] == "Verify your email before using group planning."


def test_group_vote_summary_uses_shared_household_plan_and_owner_voter_detail(
    client: TestClient,
    auth_headers: dict[str, str],
    db_session: Session,
    grant_basic_access: Callable[[str], object],
) -> None:
    household = client.get("/api/v1/households/current", headers=auth_headers).json()
    recipe = client.post(
        "/api/v1/recipes",
        headers=auth_headers,
        json={
            "name": "Majority fajitas",
            "photo_url": "https://example.com/fajitas.jpg",
            "servings": 4,
            "total_minutes": 30,
            "ingredients": [{"original_text": "1 lb chicken"}],
            "instructions": [{"step_number": 1, "text": "Cook chicken"}],
        },
    ).json()
    member = client.post(
        "/api/v1/auth/register",
        json={
            "email": "group-member@example.com",
            "password": "change-me-123",
            "terms_accepted": True,
            "privacy_accepted": True,
        },
    )
    member_user = db_session.query(User).filter_by(email="group-member@example.com").one()
    member_user.email_verified = True
    db_session.commit()
    grant_basic_access("group-member@example.com")
    member_headers = {"Authorization": f"Bearer {member.json()['access_token']}"}
    joined = client.post(
        "/api/v1/households/join",
        headers=member_headers,
        json={"invite_code": household["invite_code"]},
    )
    assert joined.status_code == 200

    member_recipes = client.get("/api/v1/recipes?max_total_minutes=40", headers=member_headers)
    assert any(item["id"] == recipe["id"] for item in member_recipes.json())

    owner_vote = client.post(
        "/api/v1/households/current/votes",
        headers=auth_headers,
        json={"recipe_id": recipe["id"], "vote": "yes"},
    )
    member_vote = client.post(
        "/api/v1/households/current/votes",
        headers=member_headers,
        json={"recipe_id": recipe["id"], "vote": "no"},
    ).json()
    owner_summary = client.get("/api/v1/households/current/votes", headers=auth_headers).json()

    assert owner_vote.status_code == 200
    assert owner_summary["weekly_plan_id"] == member_vote["weekly_plan_id"]
    assert owner_summary["can_view_voters"] is True
    assert member_vote["can_view_voters"] is False
    result = owner_summary["votes"][0]
    assert result["yes"] == 1
    assert result["no"] == 1
    assert result["majority_vote"] == "tied"
    assert result["percentages"] == {"yes": 50, "no": 50}
    assert {row["email"] for row in result["voters"]} == {
        "owner@example.com",
        "group-member@example.com",
    }


def test_group_safety_settings_warn_and_block_vote_options(
    client: TestClient, auth_headers: dict[str, str]
) -> None:
    profile = client.get("/api/v1/profile", headers=auth_headers).json()
    profile["allergens"] = ["peanut"]
    profile["disliked_ingredients"] = ["cilantro"]
    update_profile = client.put("/api/v1/profile", headers=auth_headers, json=profile)
    assert update_profile.status_code == 200

    recipe = client.post(
        "/api/v1/recipes",
        headers=auth_headers,
        json={
            "name": "Peanut cilantro noodles",
            "photo_url": "https://example.com/noodles.jpg",
            "servings": 4,
            "total_minutes": 25,
            "ingredients": [
                {"original_text": "2 tablespoons peanut butter"},
                {"original_text": "1 cup chopped cilantro"},
            ],
            "instructions": [{"step_number": 1, "text": "Toss noodles with sauce"}],
        },
    ).json()

    options = client.get("/api/v1/households/current/vote-options", headers=auth_headers)
    assert options.status_code == 200
    option = next(item for item in options.json() if item["recipe"]["id"] == recipe["id"])
    assert option["is_blocked"] is False
    assert "Allergy: peanut" in option["warning_labels"]
    assert "Dislike: cilantro" in option["warning_labels"]

    settings = client.patch(
        "/api/v1/households/current/settings",
        headers=auth_headers,
        json={"allergen_filter_mode": "block", "dislike_filter_mode": "warn"},
    )
    assert settings.status_code == 200
    assert settings.json()["allergen_filter_mode"] == "block"

    filtered_options = client.get("/api/v1/households/current/vote-options", headers=auth_headers)
    assert recipe["id"] not in [item["recipe"]["id"] for item in filtered_options.json()]
    blocked_vote = client.post(
        "/api/v1/households/current/votes",
        headers=auth_headers,
        json={"recipe_id": recipe["id"], "vote": "yes"},
    )
    assert blocked_vote.status_code == 400
    assert "blocked" in blocked_vote.json()["detail"]


def test_owner_can_transfer_household_ownership(
    client: TestClient,
    auth_headers: dict[str, str],
    db_session: Session,
    grant_basic_access: Callable[[str], object],
) -> None:
    household = client.get("/api/v1/households/current", headers=auth_headers).json()
    member = client.post(
        "/api/v1/auth/register",
        json={
            "email": "new-owner@example.com",
            "password": "change-me-123",
            "terms_accepted": True,
            "privacy_accepted": True,
        },
    )
    member_user = db_session.query(User).filter_by(email="new-owner@example.com").one()
    member_user.email_verified = True
    db_session.commit()
    grant_basic_access("new-owner@example.com")
    member_headers = {"Authorization": f"Bearer {member.json()['access_token']}"}
    joined = client.post(
        "/api/v1/households/join",
        headers=member_headers,
        json={"invite_code": household["invite_code"]},
    )
    assert joined.status_code == 200

    transferred = client.post(
        "/api/v1/households/current/transfer-owner",
        headers=auth_headers,
        json={"user_id": member_user.id},
    )
    assert transferred.status_code == 200
    assert transferred.json()["current_user_role"] == "member"

    new_owner_household = client.get("/api/v1/households/current", headers=member_headers)
    assert new_owner_household.json()["current_user_role"] == "owner"
    old_owner_settings = client.patch(
        "/api/v1/households/current/settings",
        headers=auth_headers,
        json={"allergen_filter_mode": "off", "dislike_filter_mode": "off"},
    )
    new_owner_settings = client.patch(
        "/api/v1/households/current/settings",
        headers=member_headers,
        json={"allergen_filter_mode": "block", "dislike_filter_mode": "warn"},
    )
    assert old_owner_settings.status_code == 403
    assert new_owner_settings.status_code == 200
