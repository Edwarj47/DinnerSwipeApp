from __future__ import annotations

from typing import Annotated

from fastapi import APIRouter, Header, Query, Request

from app.api.deps import CurrentUser, DbDep
from app.schemas.common import (
    BillingPortalSessionOut,
    CheckoutSessionOut,
    MacroSummary,
    MacroTargetIn,
    MacroTargetOut,
    MealMacroConfirmationIn,
    MealMacroConfirmationOut,
    PremiumStatus,
    PremiumWaiverRequest,
)
from app.services.billing import (
    create_checkout_session,
    create_customer_portal_session,
    handle_stripe_event,
    redeem_waiver_code,
    serialize_premium_status,
    verify_stripe_event,
)
from app.services.macros import (
    create_confirmation,
    get_or_create_targets,
    macro_summary,
    serialize_confirmation,
    serialize_targets,
    update_targets,
)

router = APIRouter(tags=["premium"])


@router.get("/premium/status", response_model=PremiumStatus)
def premium_status(db: DbDep, current_user: CurrentUser) -> dict[str, object]:
    return serialize_premium_status(db, current_user)


@router.post("/premium/waiver-code", response_model=PremiumStatus)
def apply_waiver_code(
    payload: PremiumWaiverRequest, db: DbDep, current_user: CurrentUser
) -> dict[str, object]:
    return redeem_waiver_code(db, current_user, payload.code)


@router.post("/premium/checkout-session", response_model=CheckoutSessionOut)
def checkout_session(db: DbDep, current_user: CurrentUser) -> dict[str, str]:
    return {"checkout_url": create_checkout_session(db, current_user)}


@router.post("/premium/billing-portal-session", response_model=BillingPortalSessionOut)
def billing_portal_session(db: DbDep, current_user: CurrentUser) -> dict[str, str]:
    return {"portal_url": create_customer_portal_session(db, current_user)}


@router.post("/premium/stripe/webhook")
async def stripe_webhook(
    request: Request,
    db: DbDep,
    stripe_signature: Annotated[str | None, Header(alias="Stripe-Signature")] = None,
) -> dict[str, str]:
    event = verify_stripe_event(await request.body(), stripe_signature)
    return handle_stripe_event(db, event)


@router.get("/macros/summary", response_model=MacroSummary)
def get_macro_summary(
    db: DbDep, current_user: CurrentUser, days: int = Query(default=7, ge=1, le=90)
) -> dict[str, object]:
    return macro_summary(db, current_user, days)


@router.get("/macros/targets", response_model=MacroTargetOut)
def get_macro_targets(db: DbDep, current_user: CurrentUser) -> dict[str, object]:
    return serialize_targets(get_or_create_targets(db, current_user))


@router.put("/macros/targets", response_model=MacroTargetOut)
def put_macro_targets(
    payload: MacroTargetIn, db: DbDep, current_user: CurrentUser
) -> dict[str, object]:
    return serialize_targets(update_targets(db, current_user, payload))


@router.post("/macros/confirmations", response_model=MealMacroConfirmationOut)
def confirm_macro_meal(
    payload: MealMacroConfirmationIn, db: DbDep, current_user: CurrentUser
) -> dict[str, object]:
    return serialize_confirmation(db, create_confirmation(db, current_user, payload))
