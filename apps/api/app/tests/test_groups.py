from __future__ import annotations

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
    client: TestClient, auth_headers: dict[str, str], db_session: Session
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
