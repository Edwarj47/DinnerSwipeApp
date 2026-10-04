from __future__ import annotations

from collections.abc import Callable
from typing import Any

from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from app.models.entities import HiddenRecipe, HouseholdRecipe, Recipe, User, UserSubscription
from app.schemas.common import RecipeCreate
from app.services.recipes import create_recipe


def private_recipes(db: Session, count: int = 3) -> list[Recipe]:
    owner = db.query(User).filter_by(email="owner@example.com").one()
    recipes = [
        create_recipe(db, RecipeCreate(name=f"Private meal {index:02d}"), owner, commit=False)
        for index in range(count)
    ]
    db.commit()
    return recipes


def create_group(client: TestClient, headers: dict[str, str], name: str = "Family") -> str:
    response = client.post("/api/v1/households", headers=headers, json={"name": name})
    assert response.status_code == 200, response.text
    return str(response.json()["id"])


def guest_headers(
    client: TestClient, db: Session, grant: Callable[[str], object]
) -> dict[str, str]:
    response = client.post(
        "/api/v1/auth/register",
        json={
            "email": "guest@example.com",
            "password": "fixture-password",
            "terms_accepted": True,
            "privacy_accepted": True,
        },
    )
    guest = db.query(User).filter_by(email="guest@example.com").one()
    guest.email_verified = True
    db.commit()
    grant(guest.email)
    return {"Authorization": f"Bearer {response.json()['access_token']}"}


def share(
    client: TestClient, headers: dict[str, str], group_id: str, payload: dict[str, Any]
) -> Any:
    return client.post(
        f"/api/v1/households/{group_id}/recipes/share", headers=headers, json=payload
    )


def test_options_paginate_all_owned_recipes_and_mark_existing_shares(
    client: TestClient,
    auth_headers: dict[str, str],
    db_session: Session,
) -> None:
    recipes = private_recipes(db_session, 36)
    group_id = create_group(client, auth_headers)
    owner = db_session.query(User).filter_by(email="owner@example.com").one()
    owner.profile.max_cook_minutes = 1
    recipes[1].total_minutes = 90
    db_session.add(HiddenRecipe(user_id=owner.id, recipe_id=recipes[1].id))
    recipes[-1].archived_at = recipes[-1].created_at
    recipes[-2].validation_status = "requires_review"
    db_session.commit()
    client.post(
        f"/api/v1/households/{group_id}/recipes",
        headers=auth_headers,
        json={"recipe_id": recipes[0].id},
    )
    path = f"/api/v1/households/{group_id}/recipes"
    first = client.get(path, headers=auth_headers, params={"limit": 30}).json()
    second = client.get(path, headers=auth_headers, params={"limit": 30, "offset": 30}).json()
    assert first["total"] == second["total"] == 34
    assert first["shared_count"] == 1
    assert len(first["items"]) == 30 and len(second["items"]) == 4
    assert first["items"][0]["is_shared"]
    assert first["items"][1]["recipe"]["is_hidden"]
    assert len({row["recipe"]["id"] for row in first["items"] + second["items"]}) == 34
    filtered = client.get(path, headers=auth_headers, params={"q": " MEAL 3 "}).json()
    assert filtered["total"] == 4
    assert all("meal 3" in row["recipe"]["name"] for row in filtered["items"])


def test_bulk_selection_is_atomic_scoped_and_repeatable(
    client: TestClient,
    auth_headers: dict[str, str],
    db_session: Session,
    grant_basic_access: Callable[[str], object],
) -> None:
    recipes = private_recipes(db_session)
    private_kitchen_id = recipes[0].household_id
    group_id = create_group(client, auth_headers)
    guest = guest_headers(client, db_session, grant_basic_access)
    group = client.get("/api/v1/households/current", headers=auth_headers).json()
    assert client.get(f"/api/v1/households/{group_id}/recipes", headers=guest).status_code == 404
    assert share(client, guest, group_id, {"select_all": True}).status_code == 404
    client.post(
        "/api/v1/households/join", headers=guest, json={"invite_code": group["invite_code"]}
    )
    assert client.get(f"/api/v1/recipes/{recipes[0].id}", headers=guest).status_code == 404
    invalid = share(
        client, auth_headers, group_id, {"recipe_ids": [recipes[0].id, "not-available"]}
    )
    assert invalid.status_code == 404
    assert db_session.query(HouseholdRecipe).count() == 0
    payload = {"recipe_ids": [recipes[0].id, recipes[1].id, recipes[0].id]}
    result = share(client, auth_headers, group_id, payload)
    assert result.status_code == 200, result.text
    assert result.json() == {"shared_count": 2, "already_shared_count": 0, "recipe_count": 2}
    assert share(client, auth_headers, group_id, payload).json() == {
        "shared_count": 0,
        "already_shared_count": 2,
        "recipe_count": 2,
    }
    assert db_session.query(HouseholdRecipe).count() == 2
    assert client.get(f"/api/v1/recipes/{recipes[0].id}", headers=guest).status_code == 200
    assert client.get(f"/api/v1/recipes/{recipes[2].id}", headers=guest).status_code == 404
    for recipe in recipes:
        stored = db_session.get(Recipe, recipe.id)
        assert stored is not None
        assert stored.household_id == private_kitchen_id
    assert client.get(f"/api/v1/households/{group_id}/recipes", headers=guest).json()["total"] == 0
    assert share(client, guest, group_id, {"recipe_ids": [recipes[0].id]}).status_code == 404


def test_basic_member_can_share_their_private_recipe_and_group_recipes_are_already_shared(
    client: TestClient,
    auth_headers: dict[str, str],
    db_session: Session,
    grant_basic_access: Callable[[str], object],
) -> None:
    group_id = create_group(client, auth_headers)
    group = client.get("/api/v1/households/current", headers=auth_headers).json()
    guest = guest_headers(client, db_session, grant_basic_access)
    user = db_session.query(User).filter_by(email="guest@example.com").one()
    private_recipe = create_recipe(db_session, RecipeCreate(name="Guest's private soup"), user)
    kitchen_id = private_recipe.household_id
    joined = client.post(
        "/api/v1/households/join", headers=guest, json={"invite_code": group["invite_code"]}
    )
    assert joined.status_code == 200
    db_session.refresh(user.profile)
    group_recipe = create_recipe(db_session, RecipeCreate(name="Guest's group salad"), user)
    assert group_recipe.household_id == group_id
    options = client.get(f"/api/v1/households/{group_id}/recipes", headers=guest).json()
    assert options["total"] == 2 and options["shared_count"] == 1
    shared = {item["recipe"]["id"]: item["is_shared"] for item in options["items"]}
    assert shared == {private_recipe.id: False, group_recipe.id: True}
    result = share(client, guest, "current", {"select_all": True})
    assert result.json() == {"shared_count": 1, "already_shared_count": 1, "recipe_count": 2}
    assert db_session.query(HouseholdRecipe).count() == 1
    assert private_recipe.household_id == kitchen_id
    assert (
        client.get(f"/api/v1/recipes/{private_recipe.id}", headers=auth_headers).status_code == 200
    )
    repeated = client.post(
        f"/api/v1/households/{group_id}/recipes",
        headers=guest,
        json={"recipe_id": private_recipe.id},
    )
    assert repeated.status_code == 200 and repeated.json() == {"shared": True}
    assert db_session.query(HouseholdRecipe).count() == 1


def test_select_all_covers_unloaded_pages_with_exclusions_and_no_other_group_exposure(
    client: TestClient,
    auth_headers: dict[str, str],
    db_session: Session,
) -> None:
    recipes = private_recipes(db_session, 37)
    owner = db_session.query(User).filter_by(email="owner@example.com").one()
    subscription = db_session.query(UserSubscription).filter_by(user_id=owner.id).one()
    subscription.plan_key = "premium_macros_monthly"
    db_session.commit()
    group_id = create_group(client, auth_headers)
    other_id = create_group(client, auth_headers, "Friends")
    response = share(
        client, auth_headers, group_id, {"select_all": True, "excluded_recipe_ids": [recipes[0].id]}
    )
    assert response.json() == {"shared_count": 36, "already_shared_count": 0, "recipe_count": 36}
    assert db_session.query(HouseholdRecipe).filter_by(household_id=other_id).count() == 0
    assert (
        client.get(f"/api/v1/households/{other_id}/recipes", headers=auth_headers).json()[
            "shared_count"
        ]
        == 0
    )
    assert share(client, auth_headers, group_id, {"select_all": True}).json() == {
        "shared_count": 1,
        "already_shared_count": 36,
        "recipe_count": 37,
    }
    assert (
        share(client, auth_headers, other_id, {"recipe_ids": [recipes[0].id]}).json()[
            "shared_count"
        ]
        == 1
    )


def test_filtered_select_all_treats_search_as_literal_and_skips_archived_and_drafts(
    client: TestClient,
    auth_headers: dict[str, str],
    db_session: Session,
) -> None:
    recipes = private_recipes(db_session, 5)
    recipes[0].name = "100% dinner"
    recipes[1].name = "1000 dinner"
    recipes[2].name = "100% supper"
    recipes[3].name = "100% archived"
    recipes[3].archived_at = recipes[3].created_at
    recipes[4].name = "100% draft"
    recipes[4].validation_status = "requires_review"
    db_session.commit()
    group_id = create_group(client, auth_headers)
    response = share(client, auth_headers, group_id, {"select_all": True, "q": "%"})
    assert response.json()["shared_count"] == 2
    assert (
        client.get(
            f"/api/v1/households/{group_id}/recipes", headers=auth_headers, params={"q": "%"}
        ).json()["total"]
        == 2
    )
    assert share(client, auth_headers, group_id, {"select_all": True, "q": "no match"}).json() == {
        "shared_count": 0,
        "already_shared_count": 0,
        "recipe_count": 0,
    }
    assert share(client, auth_headers, group_id, {"recipe_ids": [recipes[3].id]}).status_code == 404
    assert share(client, auth_headers, group_id, {"recipe_ids": [recipes[4].id]}).status_code == 404


def test_invalid_selection_private_target_and_unverified_sharing_are_rejected(
    client: TestClient,
    auth_headers: dict[str, str],
    db_session: Session,
) -> None:
    recipes = private_recipes(db_session)
    kitchen_id = recipes[0].household_id
    assert (
        client.get(f"/api/v1/households/{kitchen_id}/recipes", headers=auth_headers).status_code
        == 404
    )
    assert share(client, auth_headers, str(kitchen_id), {"select_all": True}).status_code == 404
    group_id = create_group(client, auth_headers)
    invalid_payloads: list[dict[str, Any]] = [
        {},
        {"recipe_ids": []},
        {"select_all": True, "recipe_ids": [recipes[0].id]},
        {"recipe_ids": [" "]},
        {"recipe_ids": ["x"] * 501},
        {"recipe_ids": [recipes[0].id], "excluded_recipe_ids": [recipes[1].id]},
    ]
    for payload in invalid_payloads:
        assert share(client, auth_headers, group_id, payload).status_code == 422
    assert client.get(f"/api/v1/households/{group_id}/recipes").status_code == 401
    owner = db_session.query(User).filter_by(email="owner@example.com").one()
    owner.email_verified = False
    db_session.commit()
    assert share(client, auth_headers, group_id, {"select_all": True}).status_code == 403
    assert db_session.query(HouseholdRecipe).count() == 0
