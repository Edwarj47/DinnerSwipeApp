from __future__ import annotations

from typing import Annotated, Any
from uuid import UUID

from fastapi import APIRouter, HTTPException, Query, Response
from pydantic import BaseModel, Field
from sqlalchemy import select

from app.api.deps import BasicUser, DbDep
from app.core.rate_limit import auth_rate_limiter
from app.models.nutrition import (
    NutritionCalculation,
    NutritionProviderState,
    NutritionServing,
    NutritionUsage,
)
from app.schemas.calculator import CalculatorPreview, CalculatorSave
from app.services.calculator import (
    calculation_response,
    resolve_items,
    save_calculation,
    update_calculation,
)
from app.services.fatsecret import ATTRIBUTION
from app.services.nutrition import nutrition_budget, nutrition_client, store_identifiers
from app.services.nutrition_budget import NutritionError, utcnow

router = APIRouter(prefix="/nutrition", tags=["nutrition"])
Identifier = Annotated[str, Field(pattern=r"^[0-9]{1,20}$")]


class UsageInput(BaseModel):
    food_id: Identifier
    serving_id: Identifier
    portions: float = Field(default=1, gt=0, le=100, allow_inf_nan=False)
    request_id: UUID


@router.post("/calculations/preview")
def preview_calculation(
    db: DbDep, user: BasicUser, payload: CalculatorPreview, response: Response
) -> dict[str, Any]:
    from app.services.billing import require_premium

    require_premium(db, user)
    auth_rate_limiter.check(f"nutrition:lookup:{user.id}", 20, 60)
    for item in payload.items:
        if item.source == "fatsecret" and not db.get(
            NutritionServing, (item.food_id, item.serving_id)
        ):
            raise HTTPException(422, "Select a valid database serving first.")
    values, unavailable, labels = resolve_items(
        NutritionCalculation(items=[item.model_dump(exclude_none=True) for item in payload.items])
    )
    response.headers["Cache-Control"] = "no-store"
    return {
        "resolved_items": values,
        "nutrition_unavailable": unavailable,
        "serving_labels": labels,
    }


@router.post("/calculations")
def create_calculation(
    db: DbDep, user: BasicUser, payload: CalculatorSave, response: Response
) -> dict[str, Any]:
    auth_rate_limiter.check(f"nutrition:save:{user.id}", 20, 60)
    response.headers["Cache-Control"] = "no-store"
    return calculation_response(db, save_calculation(db, user, payload))


@router.get("/calculations/{calculation_id}")
def get_calculation(
    db: DbDep, user: BasicUser, calculation_id: str, response: Response
) -> dict[str, Any]:
    from app.services.billing import require_premium

    require_premium(db, user)
    auth_rate_limiter.check(f"nutrition:lookup:{user.id}", 20, 60)
    calculation = db.get(NutritionCalculation, calculation_id)
    if not calculation:
        raise HTTPException(404, "Calculation not found.")
    if calculation.user_id != user.id:
        from app.models.entities import Recipe
        from app.services.recipes import accessible_recipes_query

        if not calculation.recipe_id or not db.scalar(
            accessible_recipes_query(user).where(Recipe.id == calculation.recipe_id)
        ):
            raise HTTPException(404, "Calculation not found.")
    response.headers["Cache-Control"] = "no-store"
    return calculation_response(db, calculation)


@router.put("/calculations/{calculation_id}")
def edit_calculation(
    db: DbDep, user: BasicUser, calculation_id: str, payload: CalculatorSave, response: Response
) -> dict[str, Any]:
    auth_rate_limiter.check(f"nutrition:save:{user.id}", 20, 60)
    calculation = db.scalar(
        select(NutritionCalculation)
        .where(
            NutritionCalculation.id == calculation_id,
            NutritionCalculation.user_id == user.id,
        )
        .with_for_update()
    )
    if not calculation:
        raise HTTPException(404, "Calculation not found.")
    response.headers["Cache-Control"] = "no-store"
    return calculation_response(db, update_calculation(db, user, calculation, payload))


def lookup(db: DbDep, response: Response, method: str, params: dict[str, str]) -> dict[str, Any]:
    response.headers["Cache-Control"] = "no-store"
    try:
        payload = nutrition_client.request(method, params)
        store_identifiers(db, payload, detailed=method == "food.get.v5")
        return {
            "data": payload,
            "source": "fatsecret",
            "attribution": ATTRIBUTION,
            "terms_url": "https://platform.fatsecret.com/terms",
            "temporary": True,
            "persist_identifiers_only": True,
        }
    except NutritionError as error:
        raise HTTPException(
            status_code=429 if "budget" in error.code else 503,
            detail={"message": "Nutrition lookup is temporarily unavailable.", "code": error.code},
            headers={"Retry-After": str(error.retry_seconds), "Cache-Control": "no-store"},
        ) from None


@router.get("/foods/search")
def search_foods(
    db: DbDep,
    user: BasicUser,
    response: Response,
    query: Annotated[str, Query(min_length=2, max_length=100)],
    page: Annotated[int, Query(ge=0, le=20)] = 0,
) -> dict[str, Any]:
    auth_rate_limiter.check(f"nutrition:lookup:{user.id}", 20, 60)
    expression = " ".join(query.split())
    if len(expression) < 2:
        raise HTTPException(status_code=422, detail="Enter at least two characters.")
    return lookup(
        db,
        response,
        "foods.search",
        {"search_expression": expression, "page_number": str(page), "max_results": "20"},
    )


@router.get("/foods/{food_id}")
def food_details(
    db: DbDep, user: BasicUser, response: Response, food_id: Identifier
) -> dict[str, Any]:
    auth_rate_limiter.check(f"nutrition:lookup:{user.id}", 20, 60)
    return lookup(db, response, "food.get.v5", {"food_id": food_id})


@router.post("/usage")
def record_usage(db: DbDep, user: BasicUser, payload: UsageInput) -> dict[str, str]:
    db.scalar(
        select(NutritionProviderState)
        .where(NutritionProviderState.provider == "fatsecret")
        .with_for_update()
    )
    request_id = str(payload.request_id)
    existing = db.scalar(select(NutritionUsage).where(NutritionUsage.request_id == request_id))
    if existing:
        if existing.user_id != user.id or (
            existing.food_id,
            existing.serving_id,
            existing.portions,
        ) != (payload.food_id, payload.serving_id, payload.portions):
            raise HTTPException(status_code=409, detail="Usage request already recorded.")
        return {"id": existing.id}
    if not db.get(NutritionServing, (payload.food_id, payload.serving_id)):
        raise HTTPException(
            status_code=422, detail="Look up the food and select a valid serving first."
        )
    usage = NutritionUsage(
        user_id=user.id,
        food_id=payload.food_id,
        serving_id=payload.serving_id,
        portions=payload.portions,
        request_id=request_id,
        used_at=utcnow(),
    )
    db.add(usage)
    db.commit()
    return {"id": usage.id}


@router.get("/usage")
def recent_usage(db: DbDep, user: BasicUser) -> list[dict[str, object]]:
    return [
        {
            "id": item.id,
            "food_id": item.food_id,
            "serving_id": item.serving_id,
            "portions": item.portions,
            "used_at": item.used_at.isoformat(),
        }
        for item in db.scalars(
            select(NutritionUsage)
            .where(NutritionUsage.user_id == user.id)
            .order_by(NutritionUsage.used_at.desc())
            .limit(100)
        )
    ]


@router.get("/status")
def provider_status(user: BasicUser) -> dict[str, object]:
    return nutrition_budget.status()
