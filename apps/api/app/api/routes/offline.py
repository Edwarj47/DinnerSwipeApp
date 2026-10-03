from __future__ import annotations

import hashlib
import json
from typing import Literal
from uuid import UUID

from fastapi import APIRouter, HTTPException
from fastapi.encoders import jsonable_encoder
from pydantic import BaseModel, ConfigDict, Field, ValidationError
from sqlalchemy import select

from app.api.deps import BasicUser, DbDep
from app.api.routes.grocery import _owned_grocery_item
from app.models.entities import MealMacroConfirmation, OfflineReceipt, User
from app.schemas.common import MacroEntryUpdate, MealMacroConfirmationIn
from app.services.billing import require_premium
from app.services.macros import (
    create_confirmation,
    delete_macro_entry,
    serialize_confirmation,
    update_macro_entry,
)

router = APIRouter(prefix="/offline", tags=["offline"])


class OfflineEdit(BaseModel):
    model_config = ConfigDict(extra="forbid")
    operation_id: UUID
    kind: Literal["grocery_update", "macro_create", "macro_update", "macro_delete"]
    target_id: UUID | None = None
    revision: str | None = Field(default=None, max_length=64)
    values: dict[str, object] = Field(default_factory=dict)


class GroceryEdit(BaseModel):
    model_config = ConfigDict(extra="forbid")
    is_checked: bool | None = None
    quantity: float | None = Field(default=None, ge=0, le=100000, allow_inf_nan=False)


@router.post("/sync")
def sync_edit(payload: OfflineEdit, db: DbDep, current_user: BasicUser) -> dict[str, object]:
    if len(json.dumps(payload.values)) > 12000:
        raise HTTPException(413, "Offline change is too large.")
    # Serialize retries for this account. Mutation and receipt commit together.
    db.execute(select(User.id).where(User.id == current_user.id).with_for_update()).one()
    request_hash = hashlib.sha256(
        json.dumps(
            payload.model_dump(mode="json"),
            sort_keys=True,
            separators=(",", ":"),
        ).encode()
    ).hexdigest()
    if payload.kind.startswith("macro_"):
        require_premium(db, current_user)
    existing = db.scalar(
        select(OfflineReceipt).where(
            OfflineReceipt.user_id == current_user.id,
            OfflineReceipt.operation_id == str(payload.operation_id),
        )
    )
    if existing:
        if existing.request_hash != request_hash:
            raise HTTPException(409, "This change ID was already used for different content.")
        return existing.result
    try:
        result = _apply(payload, db, current_user)
    except ValidationError as exc:
        raise HTTPException(422, "Check the values in this offline change.") from exc
    # Retry receipts need identity and revision only, not deleted meal content.
    receipt = {key: value for key, value in result.items() if key in {"id", "revision", "status"}}
    response = {"operation_id": str(payload.operation_id), "result": jsonable_encoder(receipt)}
    db.add(
        OfflineReceipt(
            user_id=current_user.id,
            operation_id=str(payload.operation_id),
            request_hash=request_hash,
            result=response,
        )
    )
    db.commit()
    return response


def _apply(payload: OfflineEdit, db: DbDep, user: BasicUser) -> dict[str, object]:
    if payload.kind == "macro_create":
        if db.get(MealMacroConfirmation, str(payload.operation_id)):
            raise HTTPException(409, "This entry ID is already in use.")
        values = MealMacroConfirmationIn.model_validate(payload.values)
        # Capture a definite date and totals on the device; never derive them at replay time.
        if not values.meal_date or values.weekly_plan_slot_id:
            raise HTTPException(
                422,
                "Offline entries need a date and cannot change a planned meal.",
            )
        nutrients = {"calories", "protein_g", "carbs_g", "fat_g", "fiber_g"}
        if not nutrients.issubset(payload.values):
            raise HTTPException(422, "Offline entries need a nutrition snapshot.")
        return serialize_confirmation(
            db,
            create_confirmation(
                db,
                user,
                values,
                commit=False,
                entry_id=str(payload.operation_id),
            ),
        )
    if not payload.target_id or not payload.revision:
        raise HTTPException(422, "Download this item before editing it offline.")
    target_id = str(payload.target_id)
    if payload.kind == "grocery_update":
        item = _owned_grocery_item(db, user, target_id)
        if item.updated_at.isoformat() != payload.revision:
            raise HTTPException(
                409,
                "This grocery item changed on another device. Review your change.",
            )
        changes = GroceryEdit.model_validate(payload.values).model_dump(exclude_unset=True)
        if "is_checked" in changes and changes["is_checked"] is None:
            raise HTTPException(422, "Choose checked or unchecked.")
        for key, value in changes.items():
            setattr(item, key, value)
        db.flush()
        return {"id": item.id, "revision": item.updated_at.isoformat()}
    row = db.scalar(
        select(MealMacroConfirmation)
        .where(
            MealMacroConfirmation.id == target_id,
            MealMacroConfirmation.user_id == user.id,
        )
        .with_for_update()
    )
    if not row:
        raise HTTPException(409, "This macro entry was removed. Review your offline change.")
    if row.updated_at.isoformat() != payload.revision:
        raise HTTPException(409, "This macro entry changed on another device. Review your change.")
    if payload.kind == "macro_delete":
        delete_macro_entry(db, user, target_id, commit=False)
        return {"id": target_id, "status": "deleted"}
    return serialize_confirmation(
        db,
        update_macro_entry(
            db,
            user,
            target_id,
            MacroEntryUpdate.model_validate(payload.values),
            commit=False,
        ),
    )
