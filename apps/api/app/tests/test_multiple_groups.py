from __future__ import annotations

from collections.abc import Callable
from typing import Any, cast

from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from app.models.entities import User, UserSubscription


def group(client: TestClient, headers: dict[str, str], name: str) -> dict[str, Any]:
    result = client.post("/api/v1/households", headers=headers, json={"name": name})
    assert result.status_code == 200, result.text
    return cast(dict[str, Any], result.json())


def member(client: TestClient, db: Session, grant: Callable[[str], object]) -> dict[str, str]:
    response = client.post(
        "/api/v1/auth/register",
        json={
            "email": "guest@example.com",
            "password": "fixture-password",
            "terms_accepted": True,
            "privacy_accepted": True,
        },
    )
    user = db.query(User).filter_by(email="guest@example.com").one()
    user.email_verified = True
    db.commit()
    grant(user.email)
    return {"Authorization": f"Bearer {response.json()['access_token']}"}


def premium(db: Session) -> None:
    user = db.query(User).filter_by(email="owner@example.com").one()
    subscription = db.query(UserSubscription).filter_by(user_id=user.id).one()
    subscription.plan_key = "premium_macros_monthly"
    db.commit()


def recipe(client: TestClient, headers: dict[str, str]) -> dict[str, Any]:
    response = client.post(
        "/api/v1/recipes",
        headers=headers,
        json={
            "name": "Private pasta",
            "photo_url": "https://example.com/pasta.jpg",
            "servings": 2,
            "ingredients": [{"original_text": "1 cup pasta"}],
            "instructions": [{"step_number": 1, "text": "Cook pasta."}],
        },
    )
    return cast(dict[str, Any], response.json())


def test_basic_has_private_kitchen_and_one_shared_group(
    client: TestClient, auth_headers: dict[str, str]
) -> None:
    kitchen = client.get("/api/v1/households/current", headers=auth_headers).json()
    assert kitchen["is_personal"] and not kitchen["invite_code"]
    first = group(client, auth_headers, "Family")
    assert not first["is_personal"]
    rejected = client.post("/api/v1/households", headers=auth_headers, json={"name": "Friends"})
    assert rejected.status_code == 403
    assert "Premium" in rejected.json()["detail"]
    spaces = client.get("/api/v1/households", headers=auth_headers).json()
    assert len(spaces) == 2
    switched = client.post(f"/api/v1/households/{kitchen['id']}/switch", headers=auth_headers)
    assert switched.status_code == 200 and switched.json()["is_personal"]
    assert (
        client.post("/api/v1/households/not-mine/switch", headers=auth_headers).status_code == 404
    )
    assert client.get("/api/v1/households/not-mine/votes", headers=auth_headers).status_code == 404
    assert (
        client.post(f"/api/v1/households/{first['id']}/leave", headers=auth_headers).status_code
        == 200
    )
    assert (
        client.post(
            "/api/v1/households/invite-preview",
            headers=auth_headers,
            json={"invite_code": first["invite_code"]},
        ).status_code
        == 404
    )
    assert group(client, auth_headers, "New family")["name"] == "New family"


def test_invites_validate_scope_rotation_and_basic_join_limit(
    client: TestClient,
    auth_headers: dict[str, str],
    db_session: Session,
    grant_basic_access: Callable[[str], object],
) -> None:
    premium(db_session)
    first = group(client, auth_headers, "Family")
    second = group(client, auth_headers, "Friends")
    guest = member(client, db_session, grant_basic_access)
    payload = {"invite_code": first["invite_code"]}
    preview = client.post("/api/v1/households/invite-preview", headers=guest, json=payload)
    assert preview.json() == {"id": first["id"], "name": "Family", "member_count": 1}
    rotated = client.post(f"/api/v1/households/{first['id']}/rotate-invite", headers=auth_headers)
    assert rotated.status_code == 200
    assert client.post("/api/v1/households/join", headers=guest, json=payload).status_code == 404
    payload["invite_code"] = rotated.json()["invite_code"].lower()
    assert client.post("/api/v1/households/join", headers=guest, json=payload).status_code == 200
    assert client.post("/api/v1/households/join", headers=guest, json=payload).status_code == 200
    assert (
        client.post(
            "/api/v1/households/join", headers=guest, json={"invite_code": second["invite_code"]}
        ).status_code
        == 403
    )
    assert (
        client.post(f"/api/v1/households/{first['id']}/rotate-invite", headers=guest).status_code
        == 403
    )
    assert client.get("/api/v1/households/current", headers=guest).json()["invite_code"] == ""
    assert client.get(f"/api/v1/households/{second['id']}/votes", headers=guest).status_code == 404
    blocked_leave = client.post(
        f"/api/v1/households/{first['id']}/leave", headers=auth_headers
    )
    assert blocked_leave.status_code == 409
    assert "Transfer ownership" in blocked_leave.json()["detail"]
    left = client.post(f"/api/v1/households/{first['id']}/leave", headers=guest)
    assert left.status_code == 200 and left.json()["is_personal"]
    assert client.get(f"/api/v1/households/{first['id']}/votes", headers=guest).status_code == 404
    assert (
        client.post(f"/api/v1/households/{left.json()['id']}/leave", headers=guest).status_code
        == 400
    )
    assert (
        client.post(
            "/api/v1/households/join", headers=guest, json={"invite_code": second["invite_code"]}
        ).status_code
        == 200
    )


def test_private_recipes_are_explicitly_shared_and_votes_survive_owner_transfer(
    client: TestClient,
    auth_headers: dict[str, str],
    db_session: Session,
    grant_basic_access: Callable[[str], object],
) -> None:
    premium(db_session)
    private = recipe(client, auth_headers)
    first = group(client, auth_headers, "Family")
    second = group(client, auth_headers, "Friends")
    for item in (first, second):
        options = client.get(
            f"/api/v1/households/{item['id']}/vote-options", headers=auth_headers
        ).json()
        assert private["id"] not in [option["recipe"]["id"] for option in options]
    payload = {"recipe_id": private["id"], "vote": "yes"}
    assert (
        client.post(
            f"/api/v1/households/{first['id']}/votes", headers=auth_headers, json=payload
        ).status_code
        == 404
    )
    for item in (first, second):
        response = client.post(
            f"/api/v1/households/{item['id']}/recipes",
            headers=auth_headers,
            json={"recipe_id": private["id"]},
        )
        assert response.status_code == 200
    assert (
        client.post(
            f"/api/v1/households/{first['id']}/votes", headers=auth_headers, json=payload
        ).status_code
        == 200
    )
    assert (
        client.get(f"/api/v1/households/{second['id']}/votes", headers=auth_headers).json()["votes"]
        == []
    )
    payload["vote"] = "no"
    assert (
        client.post(
            f"/api/v1/households/{second['id']}/votes", headers=auth_headers, json=payload
        ).status_code
        == 200
    )
    assert (
        client.get(f"/api/v1/households/{first['id']}/votes", headers=auth_headers).json()["votes"][
            0
        ]["yes"]
        == 1
    )
    guest = member(client, db_session, grant_basic_access)
    client.post(
        "/api/v1/households/join", headers=guest, json={"invite_code": first["invite_code"]}
    )
    assert client.get(f"/api/v1/recipes/{private['id']}", headers=guest).status_code == 200
    assert (
        client.post(
            f"/api/v1/households/{first['id']}/recipes",
            headers=guest,
            json={"recipe_id": private["id"]},
        ).status_code
        == 404
    )
    guest_user = db_session.query(User).filter_by(email="guest@example.com").one()
    transfer = client.post(
        f"/api/v1/households/{first['id']}/transfer-owner",
        headers=auth_headers,
        json={"user_id": guest_user.id},
    )
    assert transfer.status_code == 200
    votes = client.get(f"/api/v1/households/{first['id']}/votes", headers=guest).json()
    assert votes["votes"][0]["yes"] == 1 and votes["can_view_voters"]


def test_premium_can_join_multiple_groups(
    client: TestClient,
    auth_headers: dict[str, str],
    db_session: Session,
    grant_basic_access: Callable[[str], object],
) -> None:
    premium(db_session)
    first = group(client, auth_headers, "Family")
    second = group(client, auth_headers, "Friends")
    guest = member(client, db_session, grant_basic_access)
    user = db_session.query(User).filter_by(email="guest@example.com").one()
    subscription = db_session.query(UserSubscription).filter_by(user_id=user.id).one()
    subscription.plan_key = "premium_macros_monthly"
    db_session.commit()
    for item in (first, second):
        assert (
            client.post(
                "/api/v1/households/join", headers=guest, json={"invite_code": item["invite_code"]}
            ).status_code
            == 200
        )
    assert len(client.get("/api/v1/households", headers=guest).json()) == 3
