from collections.abc import Callable

from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from app.models.entities import Favorite, HiddenRecipe, User, UserSubscription
from app.tests.test_recipe_nutrition_library import create


def test_favorites_collection_filters_before_search_and_pagination(
    client: TestClient, auth_headers: dict[str, str], db_session: Session
) -> None:
    recipes = [
        create(client, auth_headers, name=name) for name in ["Apple soup", "Bean soup", "Not saved"]
    ]
    for recipe in recipes[:2]:
        for _ in range(2):
            assert (
                client.post(
                    f"/api/v1/recipes/{recipe['id']}/favorite", headers=auth_headers
                ).status_code
                == 200
            )
    assert db_session.query(Favorite).count() == 2
    url = "/api/v1/recipes?collection=favorites"
    response = client.get(url, headers=auth_headers)
    assert response.status_code == 200
    assert {r["id"] for r in response.json()} == {r["id"] for r in recipes[:2]}
    assert all(r["is_favorite"] for r in response.json())
    assert [r["id"] for r in client.get(url + "&q=Bean", headers=auth_headers).json()] == [
        recipes[1]["id"]
    ]
    first = client.get(url + "&limit=1", headers=auth_headers).json()
    second = client.get(url + "&limit=1&offset=1", headers=auth_headers).json()
    assert len(first) == len(second) == 1 and first[0]["id"] != second[0]["id"]
    assert client.get(url + "&offset=2", headers=auth_headers).json() == []


def test_favorites_can_be_removed_without_unhiding_or_changing_the_recipe(
    client: TestClient, auth_headers: dict[str, str], db_session: Session
) -> None:
    recipe = create(client, auth_headers, prep_minutes=60, total_minutes=60)
    user = db_session.query(User).one()
    user.profile.max_cook_minutes = 1
    db_session.add(HiddenRecipe(user_id=user.id, recipe_id=recipe["id"]))
    db_session.commit()
    favorite = f"/api/v1/recipes/{recipe['id']}/favorite"
    assert client.post(favorite, headers=auth_headers).status_code == 200
    response = client.get("/api/v1/recipes?collection=favorites", headers=auth_headers)
    assert [r["id"] for r in response.json()] == [recipe["id"]]
    assert response.json()[0]["is_hidden"]
    assert response.json()[0]["total_minutes"] == 60
    for _ in range(2):
        assert client.delete(favorite, headers=auth_headers).json() == {"status": "unfavorited"}
    assert client.get("/api/v1/recipes?collection=favorites", headers=auth_headers).json() == []
    assert (
        client.get(f"/api/v1/recipes/{recipe['id']}", headers=auth_headers).json()["is_favorite"]
        is False
    )
    assert db_session.query(HiddenRecipe).count() == 1
    assert (
        client.delete("/api/v1/recipes/nonexistent/favorite", headers=auth_headers).status_code
        == 200
    )


def test_archived_favorites_stay_in_archive_until_restored(
    client: TestClient, auth_headers: dict[str, str]
) -> None:
    recipe = create(client, auth_headers)
    rid = recipe["id"]
    client.post(f"/api/v1/recipes/{rid}/favorite", headers=auth_headers)
    client.post(f"/api/v1/recipes/{rid}/archive", headers=auth_headers)
    assert client.get("/api/v1/recipes?collection=favorites", headers=auth_headers).json() == []
    client.post(f"/api/v1/recipes/{rid}/restore", headers=auth_headers)
    assert [
        r["id"]
        for r in client.get("/api/v1/recipes?collection=favorites", headers=auth_headers).json()
    ] == [rid]


def test_favorites_are_private_and_removal_only_changes_the_current_users_rows(
    client: TestClient,
    auth_headers: dict[str, str],
    db_session: Session,
    grant_basic_access: Callable[[str], UserSubscription],
) -> None:
    recipe = create(client, auth_headers)
    url = f"/api/v1/recipes/{recipe['id']}/favorite"
    client.post(url, headers=auth_headers)
    other_token = client.post(
        "/api/v1/auth/register",
        json={
            "email": "favorites-other@example.com",
            "password": "strong-password-123",
            "terms_accepted": True,
            "privacy_accepted": True,
        },
    ).json()["access_token"]
    grant_basic_access("favorites-other@example.com")
    other = {"Authorization": f"Bearer {other_token}"}
    assert client.get("/api/v1/recipes?collection=favorites", headers=other).json() == []
    assert client.post(url, headers=other).status_code == 404
    other_user = db_session.query(User).filter_by(email="favorites-other@example.com").one()
    db_session.add(Favorite(user_id=other_user.id, recipe_id=recipe["id"]))
    db_session.commit()
    assert client.get("/api/v1/recipes?collection=favorites", headers=other).json() == []
    assert client.delete(url, headers=other).status_code == 200
    assert db_session.query(Favorite).count() == 1
    assert client.get("/api/v1/recipes?collection=favorites").status_code == 401
    assert client.delete(url).status_code == 401
