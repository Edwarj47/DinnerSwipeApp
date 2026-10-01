from collections.abc import Callable
from datetime import date
from typing import Any, cast

from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from app.models.entities import IngestionJob, User, UserSubscription, WeeklyPlan, WeeklyPlanSlot
from app.services import ai_recipes


def create(client: TestClient, headers: dict[str, str], **extra: Any) -> dict[str, Any]:
    response = client.post(
        "/api/v1/recipes",
        headers=headers,
        json={
            "name": "Nutrition bowl",
            "servings": 4,
            "accept_placeholder_photo": True,
            "ingredients": [{"original_text": "1 cup rice"}],
            "instructions": [{"step_number": 1, "text": "Cook rice."}],
            "nutrition": {"calories": 400, "protein_g": 20, "fiber_g": 0},
            **extra,
        },
    )
    assert response.status_code == 200, response.text
    return cast(dict[str, Any], response.json())


def premium(db: Session) -> None:
    sub = db.query(UserSubscription).one()
    sub.plan_key = "premium_macros_monthly"
    db.commit()


def test_recipe_nutrition_scaling_overrides_and_history(
    client: TestClient, auth_headers: dict[str, str], db_session: Session
) -> None:
    recipe = create(client, auth_headers)
    assert recipe["nutrition"]["protein_g"] == 20
    assert recipe["nutrition"]["carbs_g"] is None
    assert recipe["can_edit"]
    premium(db_session)
    entry = client.post(
        "/api/v1/macros/entries",
        headers=auth_headers,
        json={
            "recipe_id": recipe["id"],
            "servings_consumed": 1.5,
            "protein_g": 35,
        },
    )
    assert entry.status_code == 200, entry.text
    assert entry.json()["calories"] == 600
    assert entry.json()["protein_g"] == 35
    assert entry.json()["fiber_g"] == 0
    assert entry.json()["carbs_g"] is None
    updated = client.put(
        f"/api/v1/recipes/{recipe['id']}/nutrition",
        headers=auth_headers,
        json={"calories": 900, "protein_g": 80},
    )
    assert updated.status_code == 200
    scaled = client.put(
        f"/api/v1/macros/entries/{entry.json()['id']}",
        headers=auth_headers,
        json={"servings_consumed": 3},
    )
    assert scaled.status_code == 200, scaled.text
    assert scaled.json()["calories"] == 1200
    assert scaled.json()["protein_g"] == 70
    cleared = client.post(
        "/api/v1/macros/entries",
        headers=auth_headers,
        json={"recipe_id": recipe["id"], "calories": None},
    )
    assert cleared.json()["calories"] is None
    assert cleared.json()["protein_g"] == 80
    assert (
        client.get("/api/v1/macros/export?all_time=true", headers=auth_headers).json()["analytics"][
            "totals"
        ]["calories"]
        == 1200
    )


def test_hidden_and_archived_are_separate_and_restorable(
    client: TestClient, auth_headers: dict[str, str], db_session: Session
) -> None:
    recipe = create(client, auth_headers)
    rid = recipe["id"]
    db_session.query(User).one().profile.max_cook_minutes = 1
    db_session.commit()
    response = client.post(
        "/api/v1/recipes/swipes",
        headers=auth_headers,
        json={"recipe_id": rid, "action": "hide", "session_id": "test"},
    )
    assert response.status_code == 200

    def ids(collection: str) -> list[str]:
        return [
            r["id"]
            for r in client.get(
                f"/api/v1/recipes?collection={collection}", headers=auth_headers
            ).json()
        ]

    assert rid not in ids("library")
    assert rid in ids("hidden")
    assert client.post(f"/api/v1/recipes/{rid}/unhide", headers=auth_headers).status_code == 200
    assert rid in ids("library")
    assert client.post(f"/api/v1/recipes/{rid}/archive", headers=auth_headers).status_code == 200
    assert rid not in ids("library")
    assert rid not in ids("hidden")
    assert rid in ids("archived")
    assert client.post(f"/api/v1/recipes/{rid}/restore", headers=auth_headers).status_code == 200
    assert rid in ids("library")
    assert rid not in ids("archived")
    assert (
        client.get(f"/api/v1/recipes/{rid}", headers=auth_headers).json()["nutrition"]["calories"]
        == 400
    )


def test_other_user_cannot_edit_restore_or_log_private_recipe(
    client: TestClient,
    auth_headers: dict[str, str],
    db_session: Session,
    grant_basic_access: Callable[[str], UserSubscription],
) -> None:
    recipe = create(client, auth_headers)
    user = db_session.query(User).one()
    plan = WeeklyPlan(user_id=user.id, week_start=date.today())
    db_session.add(plan)
    db_session.flush()
    slot = WeeklyPlanSlot(weekly_plan_id=plan.id, recipe_id=recipe["id"])
    db_session.add(slot)
    db_session.commit()
    token = client.post(
        "/api/v1/auth/register",
        json={
            "email": "other@example.com",
            "password": "strong-password-123",
            "terms_accepted": True,
            "privacy_accepted": True,
        },
    ).json()["access_token"]
    sub = grant_basic_access("other@example.com")
    sub.plan_key = "premium_macros_monthly"
    db_session.commit()
    other = {"Authorization": f"Bearer {token}"}
    rid = recipe["id"]
    for action in ("restore", "unhide"):
        assert client.post(f"/api/v1/recipes/{rid}/{action}", headers=other).status_code == 404
    assert (
        client.put(
            f"/api/v1/recipes/{rid}/nutrition", headers=other, json={"calories": 50}
        ).status_code
        == 404
    )
    assert (
        client.post("/api/v1/macros/entries", headers=other, json={"recipe_id": rid}).status_code
        == 404
    )
    assert (
        client.post(
            "/api/v1/macros/entries", headers=other, json={"weekly_plan_slot_id": slot.id}
        ).status_code
        == 404
    )
    assert client.get("/api/v1/recipes?collection=archived", headers=other).json() == []


def test_nutrition_validation_basic_gate_and_ai_review(
    client: TestClient, auth_headers: dict[str, str], db_session: Session
) -> None:
    recipe = create(client, auth_headers)
    assert (
        client.put(
            f"/api/v1/recipes/{recipe['id']}/nutrition",
            headers=auth_headers,
            json={"protein_g": -1},
        ).status_code
        == 422
    )
    assert (
        client.post(
            "/api/v1/macros/entries", headers=auth_headers, json={"recipe_id": recipe["id"]}
        ).status_code
        == 402
    )
    premium(db_session)
    client.put(
        f"/api/v1/recipes/{recipe['id']}/nutrition", headers=auth_headers, json={"calories": 20000}
    )
    assert (
        client.post(
            "/api/v1/macros/entries",
            headers=auth_headers,
            json={"recipe_id": recipe["id"], "servings_consumed": 20},
        ).status_code
        == 422
    )
    job = IngestionJob(
        user_id=db_session.query(User).one().id,
        job_type=ai_recipes.JOB_TYPE,
        status="succeeded",
        progress={"draft": {}},
    )
    db_session.add(job)
    db_session.commit()
    approved = client.post(
        f"/api/v1/ai-recipes/{job.id}/approve",
        headers=auth_headers,
        json={
            "name": "AI reviewed soup",
            "servings": 2,
            "accept_placeholder_photo": True,
            "ingredients": [{"original_text": "2 carrots"}],
            "instructions": [{"step_number": 1, "text": "Cook carrots."}],
            "nutrition": {"calories": 200},
        },
    )
    assert approved.status_code == 200, approved.text
    saved = client.get(f"/api/v1/recipes/{approved.json()['recipe_id']}", headers=auth_headers)
    assert saved.json()["nutrition"]["calories"] == 200
