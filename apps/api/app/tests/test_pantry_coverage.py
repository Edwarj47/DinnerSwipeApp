from __future__ import annotations

from datetime import date, timedelta

from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from app.models.entities import PantryItem
from app.tests.test_recipe_feedback_and_grocery_groups import save_meal


def prepare(client: TestClient, headers: dict[str, str]) -> str:
    save_meal(
        client,
        headers,
        "Tacos",
        [{"original_text": "2 red onions", "normalized_name": "red onion", "quantity": 2}],
    )
    save_meal(
        client,
        headers,
        "Salad",
        [{"original_text": "1 red onion", "normalized_name": "red onion", "quantity": 1}],
    )
    return str(
        client.get("/api/v1/grocery-lists/current", headers=headers).json()["items"][0]["id"]
    )


def test_partial_stock_subtracted_once_and_not_consumed_by_planning(
    client: TestClient, auth_headers: dict[str, str]
) -> None:
    item_id = prepare(client, auth_headers)
    path = f"/api/v1/grocery-lists/items/{item_id}/pantry"
    response = client.post(
        path,
        headers=auth_headers,
        json={"coverage_mode": "quantity", "quantity": 1, "unit": "each"},
    )
    assert response.status_code == 200, response.text
    current = client.get("/api/v1/grocery-lists/current", headers=auth_headers).json()
    assert current["pantry_coverage_version"] == 1
    assert current["items"][0]["id"] == item_id
    assert current["items"][0]["quantity"] == 2 and current["items"][0]["required_quantity"] == 3
    assert len(current["recipe_groups"]) == 2
    assert [group["items"][0]["recipe_quantity"] for group in current["recipe_groups"]] == [2, 1]
    repeated = client.post(
        path,
        headers=auth_headers,
        json={"coverage_mode": "quantity", "quantity": 1, "unit": "each"},
    )
    assert repeated.status_code == 200
    assert (
        client.post("/api/v1/grocery-lists/current/regenerate", headers=auth_headers).json()[
            "items"
        ][0]["quantity"]
        == 2
    )
    assert (
        client.get("/api/v1/grocery-lists/pantry", headers=auth_headers).json()[0]["quantity"] == 1
    )
    client.delete(f"/api/v1/grocery-lists/pantry/{response.json()['id']}", headers=auth_headers)
    assert (
        client.get("/api/v1/grocery-lists/current", headers=auth_headers).json()["items"][0][
            "quantity"
        ]
        == 3
    )


def test_enough_is_week_scoped_and_rechecks_changed_requirements(
    client: TestClient, auth_headers: dict[str, str], db_session: Session
) -> None:
    item_id = prepare(client, auth_headers)
    saved = client.post(
        f"/api/v1/grocery-lists/items/{item_id}/pantry",
        headers=auth_headers,
        json={"coverage_mode": "enough"},
    )
    assert saved.status_code == 200
    assert client.get("/api/v1/grocery-lists/current", headers=auth_headers).json()["items"] == []
    save_meal(
        client,
        auth_headers,
        "More tacos",
        [{"original_text": "1 red onion", "normalized_name": "red onion", "quantity": 1}],
    )
    current = client.get("/api/v1/grocery-lists/current", headers=auth_headers).json()
    assert current["items"][0]["quantity"] == 4
    assert "Confirm pantry" in current["items"][0]["notes"]
    assert client.get("/api/v1/grocery-lists/pantry", headers=auth_headers).json()[0][
        "needs_confirmation"
    ]
    client.post(
        "/api/v1/grocery-lists/pantry",
        headers=auth_headers,
        json={"normalized_name": "red onion", "coverage_mode": "enough"},
    )
    assert client.get("/api/v1/grocery-lists/current", headers=auth_headers).json()["items"] == []
    entry = db_session.get(PantryItem, saved.json()["id"])
    assert entry and entry.week_start
    entry.week_start -= timedelta(days=7)
    db_session.commit()
    assert (
        client.post("/api/v1/grocery-lists/current/regenerate", headers=auth_headers).json()[
            "items"
        ][0]["quantity"]
        == 4
    )


def test_unit_mismatches_unknown_quantities_and_invalid_stock_are_not_guessed(
    client: TestClient, auth_headers: dict[str, str]
) -> None:
    save_meal(
        client,
        auth_headers,
        "Rice",
        [
            {
                "original_text": "2 cups rice",
                "normalized_name": "rice",
                "quantity": 2,
                "unit": "cups",
            }
        ],
    )
    endpoint = "/api/v1/grocery-lists/pantry"
    response = client.post(
        endpoint,
        headers=auth_headers,
        json={"normalized_name": "rice", "coverage_mode": "quantity", "quantity": 1, "unit": "kg"},
    )
    assert response.status_code == 200
    item = client.get("/api/v1/grocery-lists/current", headers=auth_headers).json()["items"][0]
    assert item["quantity"] == 2 and "units differ" in item["notes"]
    client.post(
        endpoint,
        headers=auth_headers,
        json={"normalized_name": "rice", "coverage_mode": "quantity", "quantity": 1, "unit": "cup"},
    )
    assert (
        client.get("/api/v1/grocery-lists/current", headers=auth_headers).json()["items"][0][
            "quantity"
        ]
        == 1
    )
    for payload in ({"coverage_mode": "quantity"}, {"coverage_mode": "quantity", "quantity": -1}):
        assert (
            client.post(
                endpoint, headers=auth_headers, json={"normalized_name": "rice", **payload}
            ).status_code
            == 422
        )
    save_meal(
        client,
        auth_headers,
        "Unknown rice",
        [{"original_text": "rice to taste", "normalized_name": "rice", "unit": "cups"}],
    )
    assert (
        client.get("/api/v1/grocery-lists/current", headers=auth_headers).json()["items"][0][
            "quantity"
        ]
        is None
    )


def test_manual_stock_changes_are_idempotent_and_preserve_other_item_ids(
    client: TestClient, auth_headers: dict[str, str]
) -> None:
    ids = []
    for name in ("Milk", "Foil"):
        ids.append(
            client.post(
                "/api/v1/grocery-lists/current/items",
                headers=auth_headers,
                json={"display_name": name, "quantity": 3, "unit": "each"},
            ).json()["id"]
        )
    for _ in range(2):
        response = client.post(
            f"/api/v1/grocery-lists/items/{ids[0]}/pantry",
            headers=auth_headers,
            json={"coverage_mode": "quantity", "quantity": 1, "unit": "each"},
        )
        assert response.status_code == 200
        items = {
            item["id"]: item
            for item in client.get("/api/v1/grocery-lists/current", headers=auth_headers).json()[
                "items"
            ]
        }
        assert items[ids[0]]["quantity"] == 2 and items[ids[1]]["quantity"] == 3
    client.delete(f"/api/v1/grocery-lists/pantry/{response.json()['id']}", headers=auth_headers)
    items = {
        item["id"]: item
        for item in client.get("/api/v1/grocery-lists/current", headers=auth_headers).json()[
            "items"
        ]
    }
    assert items[ids[0]]["quantity"] == 3


def test_summary_supports_today_and_full_year_with_exact_end_date(
    client: TestClient, auth_headers: dict[str, str]
) -> None:
    end = date(2026, 10, 4)
    for days in (1, 7, 14, 365):
        response = client.get(
            f"/api/v1/macros/summary?days={days}&end_date={end}", headers=auth_headers
        )
        assert response.status_code == 200
        assert response.json()["days"] == days
        assert response.json()["start_date"] == str(end - timedelta(days=days - 1))
        assert response.json()["end_date"] == str(end)
    assert client.get("/api/v1/macros/summary?days=367", headers=auth_headers).status_code == 422
