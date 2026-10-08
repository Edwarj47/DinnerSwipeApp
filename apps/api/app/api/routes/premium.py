from __future__ import annotations

from datetime import UTC, date, datetime, timedelta
from typing import Annotated

from fastapi import APIRouter, Depends, Header, Query, Request, Response

from app.api.deps import CurrentUser, DbDep
from app.schemas.common import (
    BillingPortalSessionOut,
    CheckoutSessionOut,
    CouponRequest,
    CouponResult,
    MacroAnalytics,
    MacroEntryUpdate,
    MacroExport,
    MacroSummary,
    MacroTargetIn,
    MacroTargetOut,
    MealMacroConfirmationIn,
    MealMacroConfirmationOut,
    PremiumStatus,
    PremiumWaiverRequest,
    SubscriptionCheckoutRequest,
)
from app.services.billing import (
    PREMIUM_TIER,
    create_checkout_session,
    create_customer_portal_session,
    handle_stripe_event,
    redeem_waiver_code,
    serialize_premium_status,
    serialize_subscription_status,
    verify_stripe_event,
)
from app.services.coupons import apply_coupon
from app.services.macros import (
    MAX_SUMMARY_DAYS,
    create_confirmation,
    delete_macro_entry,
    get_or_create_targets,
    list_macro_entries,
    macro_analytics,
    macro_export,
    macro_summary,
    serialize_confirmation,
    serialize_targets,
    update_macro_entry,
    update_targets,
)


def private_response(response: Response) -> None:
    response.headers["Cache-Control"] = "no-store"


router = APIRouter(tags=["premium"], dependencies=[Depends(private_response)])


@router.post("/subscription/coupon-code", response_model=CouponResult)
def redeem_coupon(
    payload: CouponRequest, db: DbDep, current_user: CurrentUser
) -> dict[str, object]:
    return apply_coupon(db, current_user, payload.code, payload.tier)


@router.get("/premium/status", response_model=PremiumStatus)
def premium_status(db: DbDep, current_user: CurrentUser) -> dict[str, object]:
    return serialize_premium_status(db, current_user)


@router.get("/subscription/status", response_model=PremiumStatus)
def subscription_status(db: DbDep, current_user: CurrentUser) -> dict[str, object]:
    status = serialize_subscription_status(db, current_user)
    until = datetime.now(UTC).replace(tzinfo=None) + timedelta(hours=72)
    period_end = status.get("current_period_end")
    if isinstance(period_end, datetime):
        until = min(until, period_end.replace(tzinfo=None))
    return status | {
        "offline_until": until.replace(tzinfo=UTC) if status.get("basic_active") else None,
        "offline_sync_version": 1,
    }


@router.post("/subscription/waiver-code", response_model=PremiumStatus)
def apply_subscription_waiver_code(
    payload: PremiumWaiverRequest, db: DbDep, current_user: CurrentUser
) -> dict[str, object]:
    return redeem_waiver_code(db, current_user, payload.code)


@router.post("/premium/waiver-code", response_model=PremiumStatus)
def apply_waiver_code(
    payload: PremiumWaiverRequest, db: DbDep, current_user: CurrentUser
) -> dict[str, object]:
    return redeem_waiver_code(db, current_user, payload.code)


@router.post("/subscription/checkout-session", response_model=CheckoutSessionOut)
def subscription_checkout_session(
    payload: SubscriptionCheckoutRequest, db: DbDep, current_user: CurrentUser
) -> dict[str, str]:
    return {"checkout_url": create_checkout_session(db, current_user, payload.tier)}


@router.post("/premium/checkout-session", response_model=CheckoutSessionOut)
def checkout_session(db: DbDep, current_user: CurrentUser) -> dict[str, str]:
    return {"checkout_url": create_checkout_session(db, current_user, PREMIUM_TIER)}


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
    db: DbDep,
    current_user: CurrentUser,
    days: int = Query(default=7, ge=1, le=MAX_SUMMARY_DAYS),
    end_date: date | None = None,
) -> dict[str, object]:
    return macro_summary(db, current_user, days, end_date)


@router.get("/macros/entries", response_model=list[MealMacroConfirmationOut])
def get_macro_entries(
    db: DbDep,
    current_user: CurrentUser,
    days: int = Query(default=7, ge=1, le=366),
    start_date: date | None = None,
    end_date: date | None = None,
) -> list[dict[str, object]]:
    return [
        serialize_confirmation(db, row)
        for row in list_macro_entries(db, current_user, days, start_date, end_date)
    ]


@router.post("/macros/entries", response_model=MealMacroConfirmationOut)
def create_macro_entry(
    payload: MealMacroConfirmationIn, db: DbDep, current_user: CurrentUser
) -> dict[str, object]:
    return serialize_confirmation(db, create_confirmation(db, current_user, payload))


@router.put("/macros/entries/{entry_id}", response_model=MealMacroConfirmationOut)
def put_macro_entry(
    entry_id: str, payload: MacroEntryUpdate, db: DbDep, current_user: CurrentUser
) -> dict[str, object]:
    return serialize_confirmation(db, update_macro_entry(db, current_user, entry_id, payload))


@router.delete("/macros/entries/{entry_id}")
def remove_macro_entry(entry_id: str, db: DbDep, current_user: CurrentUser) -> dict[str, str]:
    delete_macro_entry(db, current_user, entry_id)
    return {"status": "deleted"}


@router.get("/macros/analytics", response_model=MacroAnalytics)
def get_macro_analytics(
    db: DbDep,
    current_user: CurrentUser,
    days: int = Query(default=30, ge=1, le=366),
    start_date: date | None = None,
    end_date: date | None = None,
    all_time: bool = False,
) -> dict[str, object]:
    return macro_analytics(db, current_user, days, start_date, end_date, all_time)


@router.get("/macros/export", response_model=MacroExport)
def get_macro_export(
    db: DbDep,
    current_user: CurrentUser,
    days: int = Query(default=30, ge=1, le=366),
    start_date: date | None = None,
    end_date: date | None = None,
    all_time: bool = False,
) -> dict[str, object]:
    return macro_export(db, current_user, days, start_date, end_date, all_time)


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
