from __future__ import annotations

from fastapi import APIRouter, HTTPException
from sqlalchemy import select
from sqlalchemy.orm import Session
from sqlalchemy.sql.elements import ColumnElement

from app.api.deps import BasicUser, DbDep
from app.models.entities import GroceryList, GroceryListItem, PantryItem, User, WeeklyPlan
from app.schemas.common import GroceryManualItemIn, PantryCoverageIn, PantryItemIn
from app.services.grocery_groups import recipe_grocery_groups
from app.services.pantry import (
    grocery_requirements,
    pantry_adjusted_requirements,
    requirement_fingerprint,
    update_manual_pantry,
)
from app.services.parsing import normalize_name
from app.services.recipes import category_for, get_or_create_current_plan, regenerate_grocery_list
from app.services.retailers import WalmartSearchLinkAdapter, get_retailer_adapter

router = APIRouter(prefix="/grocery-lists", tags=["grocery-lists"])
group_router = APIRouter(
    prefix="/households/{household_id}/grocery-lists", tags=["group-groceries"]
)


def _plan(
    db: Session, user: User, household_id: str | None = None, *, lock: bool = False
) -> WeeklyPlan:
    if household_id:
        from app.services.group_planning import current_plan

        return current_plan(db, user, household_id)
    return get_or_create_current_plan(db, user, lock=lock)


def _scope(
    model: type[GroceryList] | type[PantryItem], user: User, household_id: str | None
) -> ColumnElement[bool]:
    return model.household_id == household_id if household_id else model.user_id == user.id


@router.post("/current/regenerate")
@group_router.post("/current/regenerate")
def regenerate(
    db: DbDep, current_user: BasicUser, household_id: str | None = None
) -> dict[str, object]:
    plan = _plan(db, current_user, household_id, lock=True)
    grocery = regenerate_grocery_list(db, current_user, plan, preserve_edits=True)
    return list_current(db, current_user, grocery.id, household_id)


@router.get("/current")
@group_router.get("/current")
def list_current(
    db: DbDep,
    current_user: BasicUser,
    grocery_id: str | None = None,
    household_id: str | None = None,
) -> dict[str, object]:
    plan = _plan(db, current_user, household_id)
    grocery = db.get(GroceryList, grocery_id) if grocery_id else None
    if grocery and (
        (
            grocery.household_id != household_id
            if household_id
            else grocery.user_id != current_user.id
        )
        or grocery.weekly_plan_id != plan.id
    ):
        raise HTTPException(404, "Grocery list not found")
    if not grocery:
        grocery = db.scalar(
            select(GroceryList).where(
                _scope(GroceryList, current_user, household_id),
                GroceryList.weekly_plan_id == plan.id,
            )
        )
    if not grocery:
        grocery = regenerate_grocery_list(db, current_user, plan)
    items = db.scalars(
        select(GroceryListItem)
        .where(GroceryListItem.grocery_list_id == grocery.id)
        .order_by(GroceryListItem.category, GroceryListItem.display_name)
    ).all()
    adapter = get_retailer_adapter(current_user.profile.preferred_grocery_retailer)
    serialized = [
        {
            "id": item.id,
            "revision": item.updated_at.isoformat(),
            "normalized_name": item.normalized_name,
            "display_name": item.display_name,
            "quantity": item.quantity,
            "required_quantity": item.required_quantity,
            "unit": item.unit,
            "category": item.category,
            "is_checked": item.is_checked,
            "walmart_search_url": item.walmart_search_url,
            "retailer_name": adapter.retailer_name,
            "retailer_display_name": adapter.display_name,
            "retailer_search_url": adapter.build_search_url(item.normalized_name),
            "match_status": item.match_status,
            "notes": item.notes,
        }
        for item in items
    ]
    db.commit()
    return {
        "id": grocery.id,
        "household_id": household_id,
        "weekly_plan_id": plan.id,
        "retailer_name": adapter.retailer_name,
        "retailer_display_name": adapter.display_name,
        "items": serialized,
        "recipe_groups": recipe_grocery_groups(db, plan, serialized),
        "pantry_coverage_version": 1,
    }


def _owned_grocery_item(
    db: DbDep, current_user: BasicUser, item_id: str, household_id: str | None = None
) -> GroceryListItem:
    if household_id:
        from app.services.group_planning import authorize

        authorize(db, current_user, household_id)
    item = db.scalar(
        select(GroceryListItem)
        .join(GroceryList, GroceryList.id == GroceryListItem.grocery_list_id)
        .where(GroceryListItem.id == item_id, _scope(GroceryList, current_user, household_id))
        .with_for_update(of=GroceryListItem)
    )
    if not item:
        raise HTTPException(status_code=404, detail="Item not found")
    return item


@router.post("/current/items")
@group_router.post("/current/items")
def add_manual_item(
    payload: GroceryManualItemIn,
    db: DbDep,
    current_user: BasicUser,
    household_id: str | None = None,
) -> dict[str, str]:
    plan = _plan(db, current_user, household_id, lock=True)
    grocery = db.scalar(
        select(GroceryList).where(
            _scope(GroceryList, current_user, household_id), GroceryList.weekly_plan_id == plan.id
        )
    )
    if not grocery:
        grocery = regenerate_grocery_list(db, current_user, plan)
    normalized_name = normalize_name(payload.display_name)
    if not normalized_name:
        raise HTTPException(status_code=400, detail="Item name is required")
    unit = payload.unit.strip() if payload.unit else None
    item = GroceryListItem(
        grocery_list_id=grocery.id,
        normalized_name=normalized_name,
        display_name=payload.display_name.strip(),
        quantity=payload.quantity,
        required_quantity=payload.quantity,
        unit=unit or None,
        category=payload.category.strip().lower() or "household",
        walmart_search_url=WalmartSearchLinkAdapter().build_search_url(normalized_name),
        match_status="manual",
        notes=payload.notes,
    )
    db.add(item)
    db.flush()
    update_manual_pantry(
        db, current_user.id, plan, grocery.id, grocery_requirements(db, plan), normalized_name
    )
    db.commit()
    return {"id": item.id}


@router.patch("/items/{item_id}")
@group_router.patch("/items/{item_id}")
def update_item(
    item_id: str,
    payload: dict[str, object],
    db: DbDep,
    current_user: BasicUser,
    household_id: str | None = None,
) -> dict[str, str]:
    item = _owned_grocery_item(db, current_user, item_id, household_id)
    allowed = {"is_checked", "quantity", "unit", "display_name", "notes"}
    for key, value in payload.items():
        if key in allowed:
            setattr(item, key, value)
    db.commit()
    return {"status": "updated"}


@router.delete("/items/{item_id}")
@group_router.delete("/items/{item_id}")
def delete_item(
    item_id: str, db: DbDep, current_user: BasicUser, household_id: str | None = None
) -> dict[str, str]:
    item = _owned_grocery_item(db, current_user, item_id, household_id)
    db.delete(item)
    db.commit()
    return {"status": "deleted"}


@router.get("/pantry")
@group_router.get("/pantry")
def pantry(
    db: DbDep, current_user: BasicUser, household_id: str | None = None
) -> list[dict[str, object]]:
    plan = _plan(db, current_user, household_id)
    items = db.scalars(
        select(PantryItem).where(_scope(PantryItem, current_user, household_id))
    ).all()
    requirements = grocery_requirements(db, plan)
    db.commit()
    return [
        {
            "id": item.id,
            "normalized_name": item.normalized_name,
            "category": item.category,
            "coverage_mode": item.coverage_mode,
            "quantity": item.quantity,
            "unit": item.unit,
            "week_start": item.week_start,
            "needs_confirmation": item.coverage_mode == "enough"
            and (
                item.week_start != plan.week_start
                or item.requirements_fingerprint
                != requirement_fingerprint(requirements, item.normalized_name)
            ),
        }
        for item in items
    ]


@router.post("/pantry")
@group_router.post("/pantry")
def add_pantry(
    payload: PantryItemIn, db: DbDep, current_user: BasicUser, household_id: str | None = None
) -> dict[str, str]:
    normalized_name = normalize_name(payload.normalized_name)
    if not normalized_name:
        raise HTTPException(status_code=400, detail="Pantry item name is required")
    plan = _plan(db, current_user, household_id, lock=True)
    item = _save_pantry(db, current_user, plan, normalized_name, payload.category, payload)
    db.commit()
    return {"id": item.id}


def _save_pantry(
    db: DbDep,
    current_user: BasicUser,
    plan: WeeklyPlan,
    normalized_name: str,
    category: str,
    payload: PantryCoverageIn,
) -> PantryItem:
    if payload.coverage_mode == "quantity" and payload.quantity is None:
        raise HTTPException(422, "Enter the amount available in your pantry")
    item = db.scalar(
        select(PantryItem).where(
            _scope(PantryItem, current_user, plan.household_id),
            PantryItem.normalized_name == normalized_name,
        )
    )
    if not item:
        item = PantryItem(
            user_id=None if plan.household_id else current_user.id,
            household_id=plan.household_id,
            normalized_name=normalized_name,
            category=category,
        )
        db.add(item)
    item.coverage_mode = payload.coverage_mode
    item.quantity = payload.quantity if payload.coverage_mode == "quantity" else None
    item.unit = payload.unit.strip() or None if payload.unit else None
    item.week_start = plan.week_start if payload.coverage_mode == "enough" else None
    item.requirements_fingerprint = (
        requirement_fingerprint(grocery_requirements(db, plan), normalized_name)
        if payload.coverage_mode == "enough"
        else None
    )
    db.flush()
    _refresh_pantry_list(db, current_user, plan, normalized_name)
    return item


@router.post("/items/{item_id}/pantry")
@group_router.post("/items/{item_id}/pantry")
def item_to_pantry(
    item_id: str,
    db: DbDep,
    current_user: BasicUser,
    payload: PantryCoverageIn | None = None,
    household_id: str | None = None,
) -> dict[str, str]:
    plan = _plan(db, current_user, household_id, lock=True)
    item = _owned_grocery_item(db, current_user, item_id, household_id)
    grocery = db.get(GroceryList, item.grocery_list_id)
    if not grocery or grocery.weekly_plan_id != plan.id:
        raise HTTPException(409, "Refresh this week's grocery list first")
    pantry_item = _save_pantry(
        db, current_user, plan, item.normalized_name, item.category, payload or PantryCoverageIn()
    )
    db.commit()
    return {"id": pantry_item.id}


@router.delete("/pantry/{item_id}")
@group_router.delete("/pantry/{item_id}")
def delete_pantry(
    item_id: str, db: DbDep, current_user: BasicUser, household_id: str | None = None
) -> dict[str, str]:
    plan = _plan(db, current_user, household_id, lock=True)
    item = db.scalar(
        select(PantryItem).where(
            PantryItem.id == item_id, _scope(PantryItem, current_user, household_id)
        )
    )
    if not item:
        raise HTTPException(status_code=404, detail="Pantry item not found")
    name = item.normalized_name
    db.delete(item)
    db.flush()
    _refresh_pantry_list(db, current_user, plan, name)
    db.commit()
    return {"status": "deleted"}


def _refresh_pantry_list(
    db: DbDep,
    current_user: BasicUser,
    plan: WeeklyPlan,
    name: str,
) -> None:
    grocery = db.scalar(
        select(GroceryList).where(
            _scope(GroceryList, current_user, plan.household_id),
            GroceryList.weekly_plan_id == plan.id,
        )
    )
    if not grocery:
        regenerate_grocery_list(db, current_user, plan, preserve_edits=True, commit=False)
        return
    requirements = grocery_requirements(db, plan)
    desired = {
        key: bucket
        for key, bucket in pantry_adjusted_requirements(
            db, current_user.id, plan, requirements
        ).items()
        if key[0] == name
    }
    rows = db.scalars(
        select(GroceryListItem).where(
            GroceryListItem.grocery_list_id == grocery.id,
            GroceryListItem.normalized_name == name,
            GroceryListItem.match_status != "manual",
        )
    ).all()
    for row in rows:
        bucket = desired.pop((row.normalized_name, row.unit), None)
        if bucket is None:
            db.delete(row)
        else:
            row.quantity = round(bucket["quantity"], 2) if bucket["quantity"] is not None else None
            row.required_quantity = bucket["required_quantity"]
            row.notes = bucket["notes"]
    for (_name, unit), bucket in desired.items():
        db.add(
            GroceryListItem(
                grocery_list_id=grocery.id,
                normalized_name=name,
                display_name=bucket["display_name"],
                quantity=round(bucket["quantity"], 2) if bucket["quantity"] is not None else None,
                required_quantity=bucket["required_quantity"],
                unit=unit,
                category=category_for(name),
                walmart_search_url=WalmartSearchLinkAdapter().build_search_url(name),
                match_status="search_link",
                notes=bucket["notes"],
            )
        )
    update_manual_pantry(db, current_user.id, plan, grocery.id, requirements, name)
