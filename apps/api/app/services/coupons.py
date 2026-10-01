from __future__ import annotations

import calendar
from datetime import datetime
from typing import Any

from fastapi import HTTPException
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.config import settings
from app.core.rate_limit import auth_rate_limiter
from app.models.entities import AuditEvent, User, UserSubscription
from app.services.billing import (
    PLAN_KEY_BY_TIER,
    SubscriptionTier,
    _configured_stripe_client,
    _tier_for_waiver_code,
    create_checkout_session,
    is_subscription_active,
    redeem_waiver_code,
    serialize_subscription_status,
    stripe_object_dict,
    subscription_for_user,
    waiver_code_hash,
)


def apply_coupon(db: Session, user: User, code: str, tier: SubscriptionTier) -> dict[str, Any]:
    auth_rate_limiter.check(f"coupon:{user.id}", 10, 60)
    db.scalar(select(User).where(User.id == user.id).with_for_update())
    normalized = code.strip().lower()
    if _tier_for_waiver_code(normalized):
        status = redeem_waiver_code(db, user, normalized)
        return {"message": "Access coupon applied. No payment is required.", "subscription": status}
    code_hash = waiver_code_hash(normalized)
    grant = settings.access_coupon_grants.get(code_hash)
    if grant:
        # Serialize redemptions per account; only hashes, never coupon text, enter the audit log.
        subscription = subscription_for_user(db, user)
        if (
            subscription
            and subscription.source == "stripe"
            and subscription.status not in {"canceled", "cancelled", "incomplete_expired"}
        ):
            raise HTTPException(
                409, "Manage existing billing before redeeming a free-access coupon."
            )
        redeemed = db.scalar(
            select(AuditEvent).where(
                AuditEvent.user_id == user.id,
                AuditEvent.event_type == "access_coupon_redeemed",
                AuditEvent.entity_id == code_hash[:32],
            )
        )
        if redeemed:
            raise HTTPException(409, "This access coupon has already been used on your account.")
        if (
            subscription
            and subscription.source == "waiver_code"
            and subscription.status == "active"
        ):
            end = subscription.current_period_end
            if end is None and grant.months is not None:
                raise HTTPException(
                    409, "Your current access has no expiry. This coupon is not needed."
                )
            if (
                is_subscription_active(subscription)
                and subscription.plan_key == PLAN_KEY_BY_TIER["premium"]
                and grant.tier == "basic"
            ):
                raise HTTPException(409, "Premium already includes Basic access.")
        expires = None
        if grant.months is not None:
            now = datetime.utcnow()
            month_index = now.month - 1 + grant.months
            year, month = now.year + month_index // 12, month_index % 12 + 1
            expires = now.replace(
                year=year, month=month, day=min(now.day, calendar.monthrange(year, month)[1])
            )
            if (
                subscription
                and subscription.current_period_end
                and subscription.plan_key == PLAN_KEY_BY_TIER[grant.tier]
            ):
                expires = max(expires, subscription.current_period_end)
        if not subscription:
            subscription = UserSubscription(user_id=user.id)
            db.add(subscription)
        subscription.plan_key = PLAN_KEY_BY_TIER[grant.tier]
        subscription.status = "active"
        subscription.source = "waiver_code"
        subscription.current_period_end = expires
        subscription.cancel_at_period_end = False
        subscription.stripe_price_id = None
        subscription.fee_waiver_code_hash = code_hash
        db.add(
            AuditEvent(
                user_id=user.id,
                event_type="access_coupon_redeemed",
                entity_type="coupon",
                entity_id=code_hash[:32],
                payload={
                    "tier": grant.tier,
                    "expires_at": expires.isoformat() if expires else None,
                },
            )
        )
        db.commit()
        duration = f"until {expires.date().isoformat()}" if expires else "with no expiry"
        return {
            "message": f"{grant.tier.title()} access granted {duration}. No payment is required.",
            "subscription": serialize_subscription_status(db, user),
        }
    return _apply_billing_coupon(db, user, code.strip(), tier)


def _apply_billing_coupon(
    db: Session, user: User, code: str, tier: SubscriptionTier
) -> dict[str, Any]:
    client = _configured_stripe_client()
    subscription = subscription_for_user(db, user)
    if (
        subscription
        and subscription.source == "waiver_code"
        and is_subscription_active(subscription)
    ):
        raise HTTPException(409, "Free access is already active. There is no bill to discount.")
    try:
        promotions = client.v1.promotion_codes.list({"code": code, "active": True, "limit": 1})
        if not promotions.data:
            raise HTTPException(400, "This coupon is invalid or has expired.")
        promotion = stripe_object_dict(promotions.data[0])
        customer = promotion.get("customer")
        if customer and (not subscription or customer != subscription.stripe_customer_id):
            raise HTTPException(400, "This coupon is not available for your account.")
        if subscription and subscription.source == "stripe" and subscription.stripe_subscription_id:
            current = stripe_object_dict(
                client.v1.subscriptions.retrieve(subscription.stripe_subscription_id)
            )
            if current.get("customer") != subscription.stripe_customer_id:
                raise HTTPException(409, "Unable to verify your billing account.")
            if current.get("status") not in {"active", "trialing"}:
                raise HTTPException(409, "Open Manage billing to resolve your subscription first.")
            if current.get("discounts") or current.get("discount"):
                raise HTTPException(
                    409, "A discount is already attached. Contact support to change it."
                )
            idempotency_key = f"coupon-{subscription.stripe_subscription_id}-{promotion['id']}"
            client.v1.subscriptions.update(
                subscription.stripe_subscription_id,
                {
                    "discounts": [{"promotion_code": promotion["id"]}],
                    "proration_behavior": "none",
                },
                options={"idempotency_key": idempotency_key},
            )
            return {
                "message": "Coupon applied to eligible invoices. See Manage billing for details."
            }
        checkout = create_checkout_session(db, user, tier, promotion_code_id=promotion["id"])
        return {
            "message": "Review the discount and billing terms in checkout before subscribing.",
            "checkout_url": checkout,
        }
    except HTTPException:
        raise
    except Exception as exc:
        # Provider errors can contain billing details. Expose only a safe, actionable message.
        raise HTTPException(
            400, "Unable to apply this coupon. Check its terms or try again later."
        ) from exc
