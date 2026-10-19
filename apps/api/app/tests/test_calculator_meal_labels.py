from __future__ import annotations

from uuid import uuid4

import pytest
from fastapi.testclient import TestClient
from pydantic import ValidationError
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models.entities import UserSubscription
from app.schemas.calculator import CalculatorSave
from app.services.billing import PREMIUM_PLAN_KEY
from app.tests.test_macro_calculator import payload


@pytest.fixture()
def premium_labels(auth_headers: dict[str, str], db_session: Session) -> dict[str, str]:
    subscription = db_session.scalar(select(UserSubscription))
    assert subscription
    subscription.plan_key = PREMIUM_PLAN_KEY
    db_session.commit()
    return auth_headers


@pytest.mark.parametrize(
    ("label", "expected"),
    [
        ("sauce", "sauce"),
        ("  side_dish  ", "side_dish"),
        ("Appetizer", "Appetizer"),
        ("x" * 32, "x" * 32),
        ("Beverages", "beverage"),
        (" DRINKS ", "beverage"),
    ],
)
@pytest.mark.parametrize("destination", ["entry", "recipe"])
def test_calculator_labels_round_trip_on_create_read_and_edit(
    client: TestClient,
    premium_labels: dict[str, str],
    label: str,
    expected: str,
    destination: str,
) -> None:
    body = {**payload(destination), "meal_label": label}
    response = client.post("/api/v1/nutrition/calculations", headers=premium_labels, json=body)
    assert response.status_code == 200, response.text
    saved = response.json()
    assert saved["meal_label"] == expected
    path = f"/api/v1/nutrition/calculations/{saved['id']}"
    assert client.get(path, headers=premium_labels).json()["meal_label"] == expected
    body.update(name="Edited custom meal", request_id=str(uuid4()))
    edited = client.put(path, headers=premium_labels, json=body)
    assert edited.status_code == 200, edited.text
    assert edited.json()["meal_label"] == expected
    if destination == "recipe":
        recipe = client.get(f"/api/v1/recipes/{saved['recipe_id']}", headers=premium_labels).json()
        assert recipe["meal_type"] == expected
        logged = client.post(
            "/api/v1/macros/entries",
            headers=premium_labels,
            json={"recipe_id": recipe["id"], "meal_label": expected},
        )
        assert logged.status_code == 200, logged.text
        assert logged.json()["meal_label"] == expected
    else:
        entries = client.get("/api/v1/macros/entries?days=1", headers=premium_labels).json()
        assert (
            next(entry for entry in entries if entry["id"] == saved["entry_id"])["meal_label"]
            == expected
        )


@pytest.mark.parametrize("label", ["", "   ", "x" * 33, None, 12, [], {}])
def test_calculator_rejects_empty_oversized_and_non_string_labels(label: object) -> None:
    with pytest.raises(ValidationError):
        CalculatorSave.model_validate({**payload(), "meal_label": label})


def test_calculator_keeps_default_and_forbids_unknown_fields() -> None:
    body = payload()
    body.pop("meal_label")
    assert CalculatorSave.model_validate(body).meal_label == "dinner"
    with pytest.raises(ValidationError):
        CalculatorSave.model_validate({**body, "unknown": "ignored?"})


@pytest.mark.parametrize("label", ["", "   ", "x" * 33, None, 12])
def test_calculator_invalid_labels_return_422_without_changing_saved_data(
    client: TestClient, premium_labels: dict[str, str], label: object
) -> None:
    body = {**payload(), "meal_label": "sauce"}
    created = client.post("/api/v1/nutrition/calculations", headers=premium_labels, json=body)
    assert created.status_code == 200, created.text
    path = f"/api/v1/nutrition/calculations/{created.json()['id']}"
    invalid = {**body, "meal_label": label, "request_id": str(uuid4())}
    assert (
        client.post(
            "/api/v1/nutrition/calculations", headers=premium_labels, json=invalid
        ).status_code
        == 422
    )
    assert client.put(path, headers=premium_labels, json=invalid).status_code == 422
    assert client.get(path, headers=premium_labels).json()["meal_label"] == "sauce"


def test_calculator_api_still_rejects_unknown_fields(
    client: TestClient, premium_labels: dict[str, str]
) -> None:
    body = {**payload(), "meal_label": "sauce", "unknown": "not accepted"}
    response = client.post("/api/v1/nutrition/calculations", headers=premium_labels, json=body)
    assert response.status_code == 422
    assert any(error["type"] == "extra_forbidden" for error in response.json()["detail"])
