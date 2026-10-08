from collections.abc import Callable

from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from app.models.entities import HouseholdMember, User
from app.tests.test_multiple_groups import group, member


def login(client: TestClient) -> dict[str, str]:
    response = client.post(
        "/api/v1/auth/login",
        json={"email": "owner@example.com", "password": "change-me-123"},
    )
    assert response.status_code == 200
    return {"Authorization": f"Bearer {response.json()['access_token']}"}


def test_explicit_default_restores_on_login_without_changing_temporary_switches(
    client: TestClient, auth_headers: dict[str, str]
) -> None:
    kitchen = client.get("/api/v1/households/current", headers=auth_headers).json()
    shared = group(client, auth_headers, "Family")
    result = client.post(f"/api/v1/households/{shared['id']}/default", headers=auth_headers)
    assert result.status_code == 200 and result.json()["is_default"]
    tokens = client.post(
        "/api/v1/auth/login", json={"email": "owner@example.com", "password": "change-me-123"}
    ).json()
    switched = client.post(f"/api/v1/households/{kitchen['id']}/switch", headers=auth_headers)
    assert switched.status_code == 200 and not switched.json()["is_default"]
    groups = client.get("/api/v1/households", headers=auth_headers).json()
    assert [item["id"] for item in groups if item["is_default"]] == [shared["id"]]
    # Routine token renewal must not jump out of the currently selected group.
    refreshed = client.post("/api/v1/auth/refresh", json={"refresh_token": tokens["refresh_token"]})
    assert refreshed.status_code == 200
    assert (
        client.get("/api/v1/households/current", headers=auth_headers).json()["id"] == kitchen["id"]
    )
    fresh_headers = login(client)
    assert (
        client.get("/api/v1/households/current", headers=fresh_headers).json()["id"] == shared["id"]
    )
    assert (
        client.post(
            f"/api/v1/households/{kitchen['id']}/default", headers=fresh_headers
        ).status_code
        == 200
    )
    assert client.get("/api/v1/households/current", headers=login(client)).json()["is_personal"]


def test_unconfigured_default_preserves_legacy_login_selection(
    client: TestClient, auth_headers: dict[str, str]
) -> None:
    shared = group(client, auth_headers, "Family")
    assert (
        client.get("/api/v1/households/current", headers=login(client)).json()["id"] == shared["id"]
    )


def test_default_is_membership_checked_and_survives_unrelated_profile_updates(
    client: TestClient, auth_headers: dict[str, str]
) -> None:
    shared = group(client, auth_headers, "Family")
    client.post(f"/api/v1/households/{shared['id']}/default", headers=auth_headers)
    rejected = client.post("/api/v1/households/not-mine/default", headers=auth_headers)
    assert rejected.status_code == 404
    client.put(
        "/api/v1/profile",
        headers=auth_headers,
        json={
            "notification_preferences": {
                "default_household_id": "not-mine",
                "macro_summary_days": 14,
            }
        },
    )
    profile = client.get("/api/v1/profile", headers=auth_headers).json()
    assert profile["notification_preferences"]["default_household_id"] == shared["id"]
    assert profile["notification_preferences"]["macro_summary_days"] == 14
    assert (
        client.get("/api/v1/households/current", headers=login(client)).json()["id"] == shared["id"]
    )


def test_leaving_default_or_removed_membership_falls_back_to_private_kitchen(
    client: TestClient, auth_headers: dict[str, str], db_session: Session
) -> None:
    shared = group(client, auth_headers, "Family")
    client.post(f"/api/v1/households/{shared['id']}/default", headers=auth_headers)
    left = client.post(f"/api/v1/households/{shared['id']}/leave", headers=auth_headers)
    assert left.status_code == 200 and left.json()["is_personal"] and left.json()["is_default"]
    shared = group(client, auth_headers, "Another family")
    client.post(f"/api/v1/households/{shared['id']}/default", headers=auth_headers)
    user = db_session.query(User).filter_by(email="owner@example.com").one()
    membership = (
        db_session.query(HouseholdMember)
        .filter_by(household_id=shared["id"], user_id=user.id)
        .one()
    )
    db_session.delete(membership)
    db_session.commit()
    restored = client.get("/api/v1/households/current", headers=login(client)).json()
    assert restored["is_personal"] and restored["is_default"]
    assert (
        client.get(f"/api/v1/households/{shared['id']}/library", headers=auth_headers).status_code
        == 404
    )


def test_owner_identity_is_shared_only_with_members_and_tracks_owner_transfer(
    client: TestClient,
    auth_headers: dict[str, str],
    db_session: Session,
    grant_basic_access: Callable[[str], object],
) -> None:
    renamed = client.patch(
        "/api/v1/profile/identity", headers=auth_headers, json={"display_name": "  Alex  "}
    )
    assert renamed.status_code == 200 and renamed.json()["display_name"] == "Alex"
    shared = group(client, auth_headers, "Family")
    assert shared["owner"]["name"] == "Alex" and shared["owner"]["email"] == "owner@example.com"
    guest = member(client, db_session, grant_basic_access)
    assert (
        client.get(f"/api/v1/households/{shared['id']}/library", headers=guest).status_code == 404
    )
    joined = client.post(
        "/api/v1/households/join", headers=guest, json={"invite_code": shared["invite_code"]}
    )
    assert joined.json()["owner"]["name"] == "Alex"
    client.put(
        "/api/v1/profile",
        headers=auth_headers,
        json={"notification_preferences": {"display_name": "Overwrite"}},
    )
    assert client.get("/api/v1/profile", headers=auth_headers).json()["display_name"] == "Alex"
    assert (
        client.patch(
            "/api/v1/profile/identity", headers=auth_headers, json={"display_name": "x" * 101}
        ).status_code
        == 422
    )
    client.patch("/api/v1/profile/identity", headers=guest, json={"display_name": "Sam"})
    guest_user = db_session.query(User).filter_by(email="guest@example.com").one()
    transferred = client.post(
        f"/api/v1/households/{shared['id']}/transfer-owner",
        headers=auth_headers,
        json={"user_id": guest_user.id},
    )
    assert transferred.json()["owner"]["name"] == "Sam"
    assert transferred.json()["owner"]["email"] == "guest@example.com"
