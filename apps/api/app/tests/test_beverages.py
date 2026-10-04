from __future__ import annotations

import json
from typing import Any

import pytest
from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from app.ingestion.extractors import extract_json_ld_recipe
from app.models.entities import UserSubscription
from app.schemas.common import MacroEntryUpdate, MealMacroConfirmationIn, RecipeCreate
from app.services.ai_recipes import RecipeDraft


@pytest.mark.parametrize("category", ["beverage", "Beverages", "Drink", " DRINKS "])
def test_beverage_aliases_are_consistent_without_restricting_other_categories(
    category: str,
) -> None:
    assert RecipeCreate(name="Tea", meal_type=category).meal_type == "beverage"
    assert MealMacroConfirmationIn(meal_label=category).meal_label == "beverage"
    assert MacroEntryUpdate(meal_label=category).meal_label == "beverage"
    assert RecipeCreate(name="Soup", meal_type="Custom category").meal_type == "Custom category"
    assert MacroEntryUpdate(meal_label=None).meal_label is None


@pytest.mark.parametrize("category", ["Drinks", ["Smoothies", "Beverages"]])
def test_web_recipe_extracts_beverage_category_from_strings_and_lists(category: Any) -> None:
    data = {"@type": "Recipe", "name": "Mint tea", "recipeCategory": category}
    html = f'<script type="application/ld+json">{json.dumps(data)}</script>'
    assert extract_json_ld_recipe(html)["meal_type"] == "beverage"
    data["recipeCategory"] = ["Dessert", "Baking"]
    html = f'<script type="application/ld+json">{json.dumps(data)}</script>'
    assert extract_json_ld_recipe(html)["meal_type"] == "Dessert"


def test_ai_draft_schema_can_classify_beverages() -> None:
    draft = RecipeDraft(
        name="Mint tea",
        description="A cup of mint tea.",
        servings=1,
        prep_minutes=0,
        cook_minutes=5,
        total_minutes=5,
        difficulty="easy",
        meal_type="beverage",
        ingredients=["1 cup water", "Mint"],
        instructions=["Steep mint in hot water."],
        review_notes=[],
    )
    assert draft.meal_type == "beverage"
    assert "beverage" in RecipeDraft.model_json_schema()["properties"]["meal_type"]["enum"]


def test_beverages_can_be_edited_shared_planned_logged_and_exported(
    client: TestClient, auth_headers: dict[str, str], db_session: Session
) -> None:
    subscription = db_session.query(UserSubscription).one()
    subscription.plan_key = "premium_macros_monthly"
    db_session.commit()
    payload = {
        "name": "Protein shake",
        "meal_type": "Beverages",
        "servings": 1,
        "nutrition": {"calories": 160, "protein_g": 30, "carbs_g": 4, "fat_g": 3},
    }
    created = client.post("/api/v1/recipes", headers=auth_headers, json=payload)
    assert created.status_code == 200, created.text
    recipe = created.json()
    assert recipe["meal_type"] == "beverage"
    updated = client.put(
        f"/api/v1/recipes/{recipe['id']}",
        headers=auth_headers,
        json={**payload, "meal_type": "drink", "name": "Vanilla protein shake"},
    )
    assert updated.status_code == 200 and updated.json()["meal_type"] == "beverage"
    group = client.post("/api/v1/households", headers=auth_headers, json={"name": "Friends"})
    assert group.status_code == 200
    shared = client.post(
        f"/api/v1/households/{group.json()['id']}/recipes/share",
        headers=auth_headers,
        json={"recipe_ids": [recipe["id"]]},
    )
    assert shared.status_code == 200 and shared.json()["shared_count"] == 1
    options = client.get(
        f"/api/v1/households/{group.json()['id']}/recipes",
        headers=auth_headers,
    ).json()
    assert options["items"][0]["recipe"]["meal_type"] == "beverage"
    planned = client.post(
        "/api/v1/recipes/swipes",
        headers=auth_headers,
        json={"recipe_id": recipe["id"], "action": "add", "session_id": "beverage-test"},
    )
    assert planned.status_code == 200, planned.text
    logged = client.post(
        "/api/v1/macros/entries",
        headers=auth_headers,
        json={
            "recipe_id": recipe["id"],
            "meal_label": "Beverages",
            "meal_date": "2026-10-04",
            "servings_consumed": 1.5,
        },
    )
    assert logged.status_code == 200, logged.text
    entry = logged.json()
    assert entry["meal_label"] == "beverage"
    assert entry["calories"] == 240 and entry["protein_g"] == 45
    edited = client.put(
        f"/api/v1/macros/entries/{entry['id']}",
        headers=auth_headers,
        json={"meal_label": "drinks", "calories": 250},
    )
    assert edited.status_code == 200 and edited.json()["meal_label"] == "beverage"
    exported = client.get(
        "/api/v1/macros/export?start_date=2026-10-04&end_date=2026-10-04",
        headers=auth_headers,
    ).json()
    assert exported["entries"][0]["meal_label"] == "beverage"
    assert exported["analytics"]["totals"]["calories"] == 250
