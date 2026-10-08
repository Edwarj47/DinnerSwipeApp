from __future__ import annotations

import json
from datetime import date
from uuid import uuid4

import httpx
import pytest
from fastapi.testclient import TestClient
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.security import create_access_token
from app.models.entities import (
    Household,
    HouseholdMember,
    HouseholdRecipe,
    MealMacroConfirmation,
    OfflineReceipt,
    RecipeMacroProfile,
    User,
    UserProfile,
    UserSubscription,
)
from app.models.nutrition import NutritionCalculation, NutritionUsage
from app.services import calculator
from app.services.billing import PREMIUM_PLAN_KEY
from app.services.fatsecret import FatSecretClient
from app.tests.test_nutrition_service import provider as provider_fixture

provider = provider_fixture


@pytest.fixture()
def premium(
    db_session: Session,
    auth_headers: dict[str, str],
    provider: FatSecretClient,
    monkeypatch: pytest.MonkeyPatch,
) -> dict[str, str]:
    subscription = db_session.scalar(select(UserSubscription))
    assert subscription
    subscription.plan_key = PREMIUM_PLAN_KEY
    db_session.commit()
    monkeypatch.setattr(calculator, "nutrition_client", provider)
    return auth_headers


def payload(destination: str = "entry", *, database: bool = False) -> dict[str, object]:
    item = (
        {
            "source": "fatsecret",
            "name": "My eggs",
            "portions": 2,
            "food_id": "42",
            "serving_id": "7",
        }
        if database
        else {
            "source": "manual",
            "name": "My rice",
            "portions": 2,
            "nutrition": {"calories": 100, "protein_g": 8, "carbs_g": 20, "fat_g": 1, "fiber_g": 2},
        }
    )
    return {
        "name": "Breakfast bowl",
        "meal_label": "breakfast",
        "meal_date": str(date.today()),
        "servings": 4,
        "destination": destination,
        "items": [item],
        "request_id": str(uuid4()),
    }


def test_manual_stack_recipe_entry_and_idempotency(
    client: TestClient, db_session: Session, premium: dict[str, str]
) -> None:
    body = payload("recipe")
    result = client.post("/api/v1/nutrition/calculations", json=body, headers=premium)
    assert result.status_code == 200, result.text
    assert result.json()["totals"]["calories"] == 200
    recipe = client.get(f"/api/v1/recipes/{result.json()['recipe_id']}", headers=premium).json()
    assert recipe["nutrition"]["calories"] == 50 and len(recipe["ingredients"]) == 1
    retry = client.post("/api/v1/nutrition/calculations", json=body, headers=premium)
    assert retry.json()["id"] == result.json()["id"]
    body["name"] = "Different bowl"
    assert (
        client.post("/api/v1/nutrition/calculations", json=body, headers=premium).status_code == 409
    )
    body = payload()
    result = client.post("/api/v1/nutrition/calculations", json=body, headers=premium)
    entry = db_session.get(MealMacroConfirmation, result.json()["entry_id"])
    assert entry and entry.calories == 200


def test_database_values_never_persist_and_logging_scales(
    client: TestClient, db_session: Session, premium: dict[str, str]
) -> None:
    assert client.get("/api/v1/nutrition/foods/42", headers=premium).status_code == 200
    result = client.post(
        "/api/v1/nutrition/calculations", json=payload("recipe", database=True), headers=premium
    )
    assert result.status_code == 200, result.text
    saved = result.json()
    calculation = db_session.get(NutritionCalculation, saved["id"])
    assert calculation and "nutrition" not in calculation.items[0]
    assert saved["totals"]["calories"] == 200 and saved["temporary_nutrition"]
    assert (
        db_session.scalar(
            select(RecipeMacroProfile).where(RecipeMacroProfile.recipe_id == saved["recipe_id"])
        )
        is None
    )
    assert db_session.scalar(select(NutritionUsage))
    logged = client.post(
        "/api/v1/macros/entries",
        headers=premium,
        json={
            "recipe_id": saved["recipe_id"],
            "servings_consumed": 2,
            "meal_date": str(date.today()),
        },
    )
    assert logged.status_code == 200, logged.text
    assert logged.json()["calories"] == 100 and logged.json()["calculator_id"]
    assert sorted(usage.portions for usage in db_session.scalars(select(NutritionUsage))) == [1, 2]
    row = db_session.get(MealMacroConfirmation, logged.json()["id"])
    assert row and row.calories is None
    db_session.commit()
    db_session.refresh(row)
    assert row.calories is None
    detail = client.get(
        f"/api/v1/nutrition/calculations/{logged.json()['calculator_id']}", headers=premium
    ).json()
    assert detail["totals"]["calories"] == 100 and detail["items"][0]["portions"] == 1
    summary = client.get("/api/v1/macros/summary?days=1", headers=premium).json()
    assert summary["totals"]["calories"] == 100 and summary["temporary_nutrition"]
    export = client.get("/api/v1/macros/export?days=1", headers=premium).json()
    assert export["entries"][0]["calories"] is None and export["nutrition_references"]
    assert export["analytics"]["totals"]["calories"] == 0
    assert (
        client.put(
            f"/api/v1/macros/entries/{row.id}", headers=premium, json={"calories": 100}
        ).status_code
        == 422
    )
    assert (
        client.put(
            f"/api/v1/recipes/{saved['recipe_id']}/nutrition",
            headers=premium,
            json={"calories": 100},
        ).status_code
        == 422
    )


def test_provider_failure_does_not_zero_entry(
    client: TestClient, db_session: Session, premium: dict[str, str], provider: FatSecretClient
) -> None:
    client.get("/api/v1/nutrition/foods/42", headers=premium)
    saved = client.post(
        "/api/v1/nutrition/calculations", json=payload(database=True), headers=premium
    ).json()
    provider.cache.entries.clear()
    provider.http = httpx.Client(transport=httpx.MockTransport(lambda request: httpx.Response(500)))
    entries = client.get("/api/v1/macros/entries?days=1", headers=premium).json()
    assert entries[0]["calories"] is None and entries[0]["nutrition_unavailable"]
    summary = client.get("/api/v1/macros/summary?days=1", headers=premium).json()
    assert summary["nutrition_unavailable_count"] == 1
    row = db_session.get(MealMacroConfirmation, saved["entry_id"])
    assert row and row.calories is None


def test_update_and_delete_stack(
    client: TestClient, db_session: Session, premium: dict[str, str]
) -> None:
    body = payload()
    saved = client.post("/api/v1/nutrition/calculations", json=body, headers=premium).json()
    body["name"], body["request_id"] = "New breakfast", str(uuid4())
    body["items"] = [
        {
            "source": "manual",
            "name": "My toast",
            "portions": 1,
            "nutrition": {"calories": 80, "protein_g": 4},
        }
    ]
    updated = client.put(
        f"/api/v1/nutrition/calculations/{saved['id']}", json=body, headers=premium
    )
    assert updated.status_code == 200, updated.text
    assert updated.json()["totals"]["calories"] == 80
    entry = db_session.get(MealMacroConfirmation, saved["entry_id"])
    assert entry and entry.entry_name == "New breakfast" and entry.calories == 80
    assert client.delete(f"/api/v1/macros/entries/{entry.id}", headers=premium).status_code == 200
    assert db_session.get(NutritionCalculation, saved["id"]) is None


def test_source_validation_and_access(
    client: TestClient, db_session: Session, auth_headers: dict[str, str], provider: FatSecretClient
) -> None:
    assert (
        client.post(
            "/api/v1/nutrition/calculations", json=payload(), headers=auth_headers
        ).status_code
        == 402
    )
    subscription = db_session.scalar(select(UserSubscription))
    assert subscription
    subscription.plan_key = PREMIUM_PLAN_KEY
    db_session.commit()
    body = payload(database=True)
    assert (
        client.post("/api/v1/nutrition/calculations", json=body, headers=auth_headers).status_code
        == 422
    )
    assert (
        client.get("/api/v1/nutrition/calculations/unknown", headers=auth_headers).status_code
        == 404
    )
    assert client.get("/api/v1/nutrition/calculations/unknown").status_code == 401
    body["items"] = [
        {
            "source": "fatsecret",
            "name": "Eggs",
            "portions": 1,
            "food_id": "42",
            "serving_id": "7",
            "nutrition": {"calories": 100},
        }
    ]
    assert (
        client.post("/api/v1/nutrition/calculations", json=body, headers=auth_headers).status_code
        == 422
    )


def test_offline_receipt_excludes_provider_content(
    client: TestClient, db_session: Session, premium: dict[str, str]
) -> None:
    client.get("/api/v1/nutrition/foods/42", headers=premium)
    saved = client.post(
        "/api/v1/nutrition/calculations", json=payload("recipe", database=True), headers=premium
    ).json()
    operation = {
        "operation_id": str(uuid4()),
        "kind": "macro_create",
        "values": {
            "entry_name": "My breakfast",
            "recipe_id": saved["recipe_id"],
            "meal_date": str(date.today()),
            "calories": None,
            "protein_g": None,
            "carbs_g": None,
            "fat_g": None,
            "fiber_g": None,
        },
    }
    response = client.post("/api/v1/offline/sync", headers=premium, json=operation)
    assert response.status_code == 200, response.text
    receipt = db_session.scalar(select(OfflineReceipt))
    assert receipt and json.loads(json.dumps(receipt.result))["result"].get("calories") is None
    assert "Test food" not in json.dumps(receipt.result)


@pytest.mark.parametrize("database", [False, True])
def test_recipe_serving_edits_and_reference_copies(
    client: TestClient, db_session: Session, premium: dict[str, str], database: bool
) -> None:
    if database:
        client.get("/api/v1/nutrition/foods/42", headers=premium)
    saved = client.post(
        "/api/v1/nutrition/calculations", headers=premium, json=payload("recipe", database=database)
    ).json()
    recipe = client.get(f"/api/v1/recipes/{saved['recipe_id']}", headers=premium).json()
    recipe.pop("nutrition")
    recipe["servings"] = 2
    edited = client.put(f"/api/v1/recipes/{saved['recipe_id']}", headers=premium, json=recipe)
    assert edited.status_code == 200, edited.text
    logged = client.post(
        "/api/v1/macros/entries",
        headers=premium,
        json={
            "recipe_id": saved["recipe_id"],
            "servings_consumed": 1,
            "meal_date": str(date.today()),
        },
    )
    assert logged.status_code == 200 and logged.json()["calories"] == 100
    recipe["name"] = "Copied breakfast"
    recipe["calculator_source_id"] = saved["id"]
    copied = client.post("/api/v1/recipes", headers=premium, json=recipe)
    assert copied.status_code == 200, copied.text
    copy = copied.json()
    assert copy["calculator_id"] != saved["id"]
    if database:
        assert copy["nutrition"] is None
    else:
        assert copy["nutrition"]["calories"] == 100


def test_manual_total_limits_return_validation_errors(
    client: TestClient, premium: dict[str, str]
) -> None:
    body = payload()
    body["items"] = [
        {
            "source": "manual",
            "name": "My ingredient",
            "portions": 100,
            "nutrition": {"calories": 20000},
        }
    ]
    response = client.post("/api/v1/nutrition/calculations", headers=premium, json=body)
    assert response.status_code == 422


def test_preview_refresh_does_not_save_nutrition_or_entries(
    client: TestClient, db_session: Session, premium: dict[str, str], provider: FatSecretClient
) -> None:
    body = {"items": payload(database=True)["items"]}
    assert (
        client.post(
            "/api/v1/nutrition/calculations/preview", headers=premium, json=body
        ).status_code
        == 422
    )
    client.get("/api/v1/nutrition/foods/42", headers=premium)
    response = client.post("/api/v1/nutrition/calculations/preview", headers=premium, json=body)
    assert response.status_code == 200, response.text
    assert response.headers["Cache-Control"] == "no-store"
    assert response.json()["resolved_items"][0]["calories"] == 100
    assert response.json()["serving_labels"] == ["1 cup"]
    assert db_session.scalar(select(NutritionCalculation)) is None
    assert db_session.scalar(select(MealMacroConfirmation)) is None
    assert db_session.scalar(select(NutritionUsage)) is None
    provider.cache.entries.clear()
    provider.http = httpx.Client(transport=httpx.MockTransport(lambda request: httpx.Response(500)))
    unavailable = client.post(
        "/api/v1/nutrition/calculations/preview", headers=premium, json=body
    ).json()
    assert (
        unavailable["nutrition_unavailable"]
        and unavailable["resolved_items"][0]["calories"] is None
    )
    assert unavailable["serving_labels"] == [None]


def test_private_calculation_access_and_skipped_edit(
    client: TestClient, db_session: Session, premium: dict[str, str]
) -> None:
    body = payload()
    saved = client.post("/api/v1/nutrition/calculations", headers=premium, json=body).json()
    skipped = client.put(
        f"/api/v1/macros/entries/{saved['entry_id']}", headers=premium, json={"status": "skipped"}
    )
    assert skipped.status_code == 200
    body["request_id"] = str(uuid4())
    body["name"] = "Edited skipped meal"
    updated = client.put(
        f"/api/v1/nutrition/calculations/{saved['id']}", headers=premium, json=body
    )
    assert updated.status_code == 200, updated.text
    entry = db_session.get(MealMacroConfirmation, saved["entry_id"])
    assert entry and entry.status == "skipped" and entry.calories == 0
    assert (
        client.get("/api/v1/macros/summary?days=1", headers=premium).json()["totals"]["calories"]
        == 0
    )

    other = User(
        email="calculator-other@example.com", password_hash=str(uuid4()), email_verified=True
    )
    db_session.add(other)
    db_session.flush()
    db_session.add(
        UserSubscription(
            user_id=other.id, plan_key=PREMIUM_PLAN_KEY, status="active", source="waiver_code"
        )
    )
    db_session.commit()
    headers = {"Authorization": f"Bearer {create_access_token(other.id)}"}
    path = f"/api/v1/nutrition/calculations/{saved['id']}"
    assert client.get(path, headers=headers).status_code == 404
    assert client.put(path, headers=headers, json=body).status_code == 404
    assert (
        client.post("/api/v1/nutrition/calculations", headers=headers, json=body).status_code == 409
    )


def test_shared_recipe_references_can_be_read_and_logged_but_not_edited(
    client: TestClient, db_session: Session, premium: dict[str, str]
) -> None:
    client.get("/api/v1/nutrition/foods/42", headers=premium)
    body = payload("recipe", database=True)
    saved = client.post("/api/v1/nutrition/calculations", headers=premium, json=body).json()
    owner = db_session.scalar(select(User).where(User.email == "owner@example.com"))
    assert owner
    group = Household(name="Shared recipe test")
    member = User(
        email="calculator-member@example.com", password_hash=str(uuid4()), email_verified=True
    )
    db_session.add_all([group, member])
    db_session.flush()
    db_session.add_all(
        [
            HouseholdMember(household_id=group.id, user_id=owner.id, role="owner"),
            HouseholdMember(household_id=group.id, user_id=member.id, role="member"),
            HouseholdRecipe(household_id=group.id, recipe_id=saved["recipe_id"]),
            UserProfile(user_id=member.id, household_id=group.id),
            UserSubscription(
                user_id=member.id, plan_key=PREMIUM_PLAN_KEY, status="active", source="waiver_code"
            ),
        ]
    )
    db_session.commit()
    headers = {"Authorization": f"Bearer {create_access_token(member.id)}"}
    path = f"/api/v1/nutrition/calculations/{saved['id']}"
    assert client.get(path, headers=headers).json()["totals"]["calories"] == 200
    assert client.put(path, headers=headers, json=body).status_code == 404
    logged = client.post(
        "/api/v1/macros/entries",
        headers=headers,
        json={
            "recipe_id": saved["recipe_id"],
            "servings_consumed": 2,
            "meal_date": str(date.today()),
        },
    )
    assert logged.status_code == 200, logged.text
    assert logged.json()["calories"] == 100
    entry = db_session.get(MealMacroConfirmation, logged.json()["id"])
    assert entry and entry.user_id == member.id and entry.calories is None
    reference = db_session.get(NutritionCalculation, logged.json()["calculator_id"])
    assert reference and reference.user_id == member.id and reference.id != saved["id"]
    assert "nutrition" not in reference.items[0]
