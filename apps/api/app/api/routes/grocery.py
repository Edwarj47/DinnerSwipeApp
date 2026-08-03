from __future__ import annotations

from fastapi import APIRouter, HTTPException
from sqlalchemy import select

from app.api.deps import CurrentUser, DbDep
from app.models.entities import GroceryList, GroceryListItem, PantryItem
from app.schemas.common import PantryItemIn
from app.services.recipes import get_or_create_current_plan, regenerate_grocery_list

router = APIRouter(prefix="/grocery-lists", tags=["grocery-lists"])


@router.post("/current/regenerate")
def regenerate(db: DbDep, current_user: CurrentUser) -> dict[str, object]:
    plan = get_or_create_current_plan(db, current_user)
    grocery = regenerate_grocery_list(db, current_user, plan)
    return list_current(db, current_user, grocery.id)


@router.get("/current")
def list_current(
    db: DbDep, current_user: CurrentUser, grocery_id: str | None = None
) -> dict[str, object]:
    plan = get_or_create_current_plan(db, current_user)
    grocery = db.get(GroceryList, grocery_id) if grocery_id else None
    if not grocery:
        grocery = db.scalar(
            select(GroceryList).where(
                GroceryList.user_id == current_user.id, GroceryList.weekly_plan_id == plan.id
            )
        )
    if not grocery:
        grocery = regenerate_grocery_list(db, current_user, plan)
    items = db.scalars(
        select(GroceryListItem)
        .where(GroceryListItem.grocery_list_id == grocery.id)
        .order_by(GroceryListItem.category, GroceryListItem.display_name)
    ).all()
    return {
        "id": grocery.id,
        "weekly_plan_id": plan.id,
        "items": [
            {
                "id": item.id,
                "normalized_name": item.normalized_name,
                "display_name": item.display_name,
                "quantity": item.quantity,
                "unit": item.unit,
                "category": item.category,
                "is_checked": item.is_checked,
                "walmart_search_url": item.walmart_search_url,
                "match_status": item.match_status,
                "notes": item.notes,
            }
            for item in items
        ],
    }


@router.patch("/items/{item_id}")
def update_item(
    item_id: str, payload: dict[str, object], db: DbDep, current_user: CurrentUser
) -> dict[str, str]:
    item = db.get(GroceryListItem, item_id)
    if not item:
        raise HTTPException(status_code=404, detail="Item not found")
    allowed = {"is_checked", "quantity", "unit", "display_name", "notes"}
    for key, value in payload.items():
        if key in allowed:
            setattr(item, key, value)
    db.commit()
    return {"status": "updated"}


@router.get("/pantry")
def pantry(db: DbDep, current_user: CurrentUser) -> list[dict[str, object]]:
    items = db.scalars(select(PantryItem).where(PantryItem.user_id == current_user.id)).all()
    return [
        {"id": item.id, "normalized_name": item.normalized_name, "category": item.category}
        for item in items
    ]


@router.post("/pantry")
def add_pantry(payload: PantryItemIn, db: DbDep, current_user: CurrentUser) -> dict[str, str]:
    item = PantryItem(
        user_id=current_user.id,
        normalized_name=payload.normalized_name.lower(),
        category=payload.category,
    )
    db.add(item)
    db.commit()
    return {"id": item.id}
