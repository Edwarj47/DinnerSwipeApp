from __future__ import annotations

import hashlib
import math
import secrets
from datetime import datetime
from typing import Any, Literal, cast

import structlog
from fastapi import HTTPException
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.config import settings
from app.core.rate_limit import auth_rate_limiter
from app.models.entities import AuditEvent, User, UserSubscription

stripe_client: Any | None
try:  # pragma: no cover - exercised only when Stripe is configured.
    import stripe as _stripe
except ImportError:  # pragma: no cover
    stripe_client = None
else:  # pragma: no cover
    stripe_client = _stripe


logger = structlog.get_logger()
ACTIVE_STATUSES = {"active", "trialing"}
SubscriptionTier = Literal["basic", "premium"]
CurrentTier = Literal["none", "trial", "basic", "premium"]
BASIC_TIER: SubscriptionTier = "basic"
PREMIUM_TIER: SubscriptionTier = "premium"
BASIC_PLAN_KEY = "basic_monthly"
PREMIUM_PLAN_KEY = "premium_macros_monthly"
LEGACY_PREMIUM_PLAN_KEY = "macro_tracker_monthly"
PLAN_KEY_BY_TIER: dict[SubscriptionTier, str] = {
    BASIC_TIER: BASIC_PLAN_KEY,
    PREMIUM_TIER: PREMIUM_PLAN_KEY,
}
PLAN_RANK = {
    BASIC_PLAN_KEY: 1,
    PREMIUM_PLAN_KEY: 2,
    LEGACY_PREMIUM_PLAN_KEY: 2,
}


def waiver_code_hash(code: str) -> str:
    return hashlib.sha256(code.strip().lower().encode("utf-8")).hexdigest()


def subscription_for_user(db: Session, user: User) -> UserSubscription | None:
    return db.scalar(select(UserSubscription).where(UserSubscription.user_id == user.id))


def basic_trial_eligible(subscription: UserSubscription | None) -> bool:
    return settings.basic_free_trial_days > 0 and not (
        subscription
        and (subscription.stripe_subscription_id or subscription.metadata_json.get("trial_used"))
    )


def is_subscription_active(subscription: UserSubscription | None) -> bool:
    if not subscription:
        return False
    if subscription.source == "waiver_code" and subscription.status == "active":
        return (
            not subscription.current_period_end
            or subscription.current_period_end > datetime.utcnow()
        )
    return subscription.status in ACTIVE_STATUSES


def subscription_plan_rank(subscription: UserSubscription | None) -> int:
    if subscription is None or not is_subscription_active(subscription):
        return 0
    return PLAN_RANK.get(subscription.plan_key, 0)


def is_premium_active(subscription: UserSubscription | None) -> bool:
    return subscription_plan_rank(subscription) >= PLAN_RANK[PREMIUM_PLAN_KEY]


def subscription_days_remaining(
    subscription: UserSubscription | None, now: datetime | None = None
) -> int:
    if not subscription or not subscription.current_period_end:
        return 0
    now = now or datetime.utcnow()
    remaining_seconds = (subscription.current_period_end - now).total_seconds()
    if remaining_seconds <= 0:
        return 0
    return max(1, math.ceil(remaining_seconds / 86_400))


def is_basic_access_active(db: Session, user: User) -> bool:
    subscription = subscription_for_user(db, user)
    return subscription_plan_rank(subscription) >= PLAN_RANK[BASIC_PLAN_KEY]


def require_basic_access(db: Session, user: User) -> User:
    if not is_basic_access_active(db, user):
        raise HTTPException(
            status_code=402,
            detail="Start Basic with a card on file to keep using Dinner Swipe.",
        )
    return user


def serialize_premium_status(db: Session, user: User) -> dict[str, Any]:
    return serialize_subscription_status(db, user)


def serialize_subscription_status(db: Session, user: User) -> dict[str, Any]:
    subscription = subscription_for_user(db, user)
    plan_rank = subscription_plan_rank(subscription)
    premium_active = plan_rank >= PLAN_RANK[PREMIUM_PLAN_KEY]
    subscribed_basic = plan_rank >= PLAN_RANK[BASIC_PLAN_KEY]
    trial_active = bool(
        subscription
        and subscription.status == "trialing"
        and plan_rank >= PLAN_RANK[BASIC_PLAN_KEY]
    )
    trial_end = subscription.current_period_end if trial_active and subscription else None
    remaining_trial_days = subscription_days_remaining(subscription) if trial_active else 0
    basic_active = subscribed_basic
    current_tier: CurrentTier = (
        "premium"
        if premium_active
        else "trial"
        if trial_active
        else "basic"
        if subscribed_basic
        else "none"
    )
    active_plan_key = subscription.plan_key if subscription else None
    return {
        # Backward compatible fields for the existing premium macro UI.
        "active": premium_active,
        "plan_key": active_plan_key or (BASIC_PLAN_KEY if trial_active else ""),
        "status": subscription.status if subscription else "inactive",
        "source": subscription.source if subscription else None,
        "monthly_price_cents": settings.premium_monthly_price_cents,
        "stripe_configured": settings.stripe_premium_configured,
        "billing_management_available": bool(
            subscription
            and subscription.source == "stripe"
            and subscription.stripe_customer_id
            and settings.stripe_configured
        ),
        "current_period_end": subscription.current_period_end if subscription else None,
        "cancel_at_period_end": subscription.cancel_at_period_end if subscription else False,
        # New tier-aware fields.
        "current_tier": current_tier,
        "basic_active": basic_active,
        "basic_subscription_active": subscribed_basic,
        "premium_active": premium_active,
        "trial_active": trial_active,
        "trial_ends_at": trial_end,
        "trial_days_remaining": remaining_trial_days,
        "basic_trial_eligible": basic_trial_eligible(subscription),
        "basic_monthly_price_cents": settings.basic_monthly_price_cents,
        "premium_monthly_price_cents": settings.premium_monthly_price_cents,
        "basic_stripe_configured": settings.stripe_basic_configured,
        "premium_stripe_configured": settings.stripe_premium_configured,
        "plans": [
            {
                "tier": BASIC_TIER,
                "plan_key": BASIC_PLAN_KEY,
                "display_name": "Basic",
                "description": "Meal planning, recipe saving, group voting, and grocery lists.",
                "monthly_price_cents": settings.basic_monthly_price_cents,
                "stripe_configured": settings.stripe_basic_configured,
                "active": basic_active and not premium_active,
            },
            {
                "tier": PREMIUM_TIER,
                "plan_key": PREMIUM_PLAN_KEY,
                "display_name": "Premium",
                "description": "Everything in Basic plus macro tracking.",
                "monthly_price_cents": settings.premium_monthly_price_cents,
                "stripe_configured": settings.stripe_premium_configured,
                "active": premium_active,
            },
        ],
    }


def require_premium(db: Session, user: User) -> UserSubscription:
    subscription = subscription_for_user(db, user)
    if not is_premium_active(subscription):
        raise HTTPException(status_code=402, detail="Premium macro tracking is required")
    assert subscription is not None
    return subscription


def redeem_waiver_code(db: Session, user: User, code: str) -> dict[str, Any]:
    auth_rate_limiter.check(f"access-code:{user.id}", 10, 60)
    db.scalar(select(User).where(User.id == user.id).with_for_update())
    normalized = code.strip().lower()
    tier = _tier_for_waiver_code(normalized)
    if not tier:
        raise HTTPException(status_code=400, detail="Invalid access code")
    code_hash = waiver_code_hash(normalized)
    subscription = subscription_for_user(db, user)
    if (
        subscription
        and subscription.source == "stripe"
        and subscription.status not in {"canceled", "cancelled", "incomplete_expired"}
    ):
        raise HTTPException(
            409, "Manage your existing billing before redeeming a free-access coupon."
        )
    if not subscription:
        subscription = UserSubscription(user_id=user.id)
        db.add(subscription)
    subscription.plan_key = PLAN_KEY_BY_TIER[tier]
    subscription.status = "active"
    subscription.source = "waiver_code"
    subscription.stripe_price_id = None
    subscription.current_period_end = None
    subscription.cancel_at_period_end = False
    subscription.fee_waiver_code_hash = code_hash
    subscription.metadata_json = {
        **(subscription.metadata_json or {}),
        "waiver": "uat",
        "tier": tier,
    }
    event_type = "premium_waiver_redeemed" if tier == PREMIUM_TIER else "basic_waiver_redeemed"
    db.add(
        AuditEvent(
            user_id=user.id,
            event_type=event_type,
            entity_type="user_subscription",
            entity_id=subscription.id,
            payload={"plan_key": subscription.plan_key, "tier": tier},
        )
    )
    db.commit()
    return serialize_subscription_status(db, user)


def create_checkout_session(
    db: Session,
    user: User,
    tier: SubscriptionTier = PREMIUM_TIER,
    promotion_code_id: str | None = None,
) -> str:
    auth_rate_limiter.check(f"checkout:{user.id}", 10, 60)
    tier = _normalize_tier(tier)
    client = _configured_stripe_client(tier)
    db.scalar(select(User).where(User.id == user.id).with_for_update())
    subscription = subscription_for_user(db, user)
    if subscription and subscription.source == "stripe" and subscription.stripe_subscription_id:
        if subscription.status not in {"canceled", "cancelled", "incomplete_expired"}:
            raise HTTPException(409, "Open Manage billing to change your existing subscription.")
    if (
        tier == BASIC_TIER
        and subscription
        and subscription_plan_rank(subscription) >= PLAN_RANK[PREMIUM_PLAN_KEY]
    ):
        raise HTTPException(status_code=409, detail="Premium already includes Basic access.")
    if (
        tier == PREMIUM_TIER
        and subscription
        and subscription.source == "stripe"
        and subscription.stripe_subscription_id
        and subscription_plan_rank(subscription) == PLAN_RANK[BASIC_PLAN_KEY]
    ):
        raise HTTPException(
            status_code=409,
            detail="Open Manage billing to upgrade an existing Basic subscription.",
        )
    success_url = f"{settings.app_public_url.rstrip('/')}/profile?subscription=success&tier={tier}"
    cancel_url = f"{settings.app_public_url.rstrip('/')}/profile?subscription=cancelled&tier={tier}"
    plan_key = PLAN_KEY_BY_TIER[tier]
    metadata = {"user_id": user.id, "plan_key": plan_key, "tier": tier}
    subscription_data: dict[str, Any] = {"metadata": metadata}
    trial_eligible = basic_trial_eligible(subscription)
    if tier == BASIC_TIER and trial_eligible:
        trial_days = max(0, settings.basic_free_trial_days)
        if trial_days > 0:
            subscription_data["trial_period_days"] = trial_days
            subscription_data["trial_settings"] = {
                "end_behavior": {"missing_payment_method": "cancel"}
            }
    params: dict[str, Any] = {
        "mode": "subscription",
        "line_items": [{"price": settings.stripe_price_id_for_tier(tier), "quantity": 1}],
        "allow_promotion_codes": True,
        "success_url": success_url,
        "cancel_url": cancel_url,
        "client_reference_id": user.id,
        "metadata": metadata,
        "subscription_data": subscription_data,
        "integration_identifier": f"dinner_swipe_{tier}_{user.id[:8]}",
    }
    if tier == BASIC_TIER and trial_eligible:
        params["payment_method_collection"] = "always"
    if promotion_code_id:
        params.pop("allow_promotion_codes")
        params["discounts"] = [{"promotion_code": promotion_code_id}]
    if subscription and subscription.stripe_customer_id:
        params["customer"] = subscription.stripe_customer_id
    else:
        params["customer_email"] = user.email
    if not subscription:
        subscription = UserSubscription(user_id=user.id, status="inactive", metadata_json={})
        db.add(subscription)
    pending = subscription.metadata_json.get("pending_checkout")
    try:
        if isinstance(pending, dict) and pending.get("id"):
            previous = stripe_object_dict(client.v1.checkout.sessions.retrieve(pending["id"]))
            if previous.get("status") == "complete":
                raise HTTPException(409, "Your payment is being confirmed. Please refresh shortly.")
            if previous.get("status") == "open":
                if pending.get("tier") == tier and pending.get("promotion") == promotion_code_id:
                    return str(previous["url"])
                client.v1.checkout.sessions.expire(pending["id"])
        # Persist the attempt before contacting Stripe so a network retry reuses its key.
        attempt_hash = hashlib.sha256(repr(params).encode()).hexdigest()
        attempt = subscription.metadata_json.get("checkout_attempt")
        now = int(datetime.utcnow().timestamp())
        if not (
            isinstance(attempt, dict)
            and attempt.get("hash") == attempt_hash
            and now - int(attempt.get("created", 0)) < 1800
            and not pending
        ):
            attempt = {"hash": attempt_hash, "created": now, "key": secrets.token_hex(16)}
        subscription.metadata_json = {
            **subscription.metadata_json,
            "checkout_attempt": attempt,
            "pending_checkout": None,
        }
        db.commit()
        session = client.v1.checkout.sessions.create(
            params, options={"idempotency_key": f"checkout-{user.id}-{attempt['key']}"}
        )
    except HTTPException:
        raise
    except Exception as exc:
        logger.warning("stripe_checkout_failed", error_type=type(exc).__name__)
        raise HTTPException(503, "Checkout is temporarily unavailable. Please try again.") from exc
    url = _stripe_object_value(session, "url")
    if not url:
        raise HTTPException(status_code=502, detail="Stripe did not return a checkout URL")
    db.scalar(select(User).where(User.id == user.id).with_for_update())
    db.refresh(subscription)
    subscription.metadata_json = {
        **subscription.metadata_json,
        "pending_checkout": {
            "id": _stripe_object_value(session, "id"),
            "tier": tier,
            "promotion": promotion_code_id,
        },
    }
    db.commit()
    return str(url)


def create_customer_portal_session(db: Session, user: User) -> str:
    client = _configured_stripe_client()
    subscription = subscription_for_user(db, user)
    if not subscription or subscription.source != "stripe" or not subscription.stripe_customer_id:
        raise HTTPException(status_code=409, detail="No Stripe billing account is linked")
    return_url = f"{settings.app_public_url.rstrip('/')}/profile?subscription=manage"
    params = {"customer": subscription.stripe_customer_id, "return_url": return_url}
    if settings.stripe_portal_configuration_id:
        params["configuration"] = settings.stripe_portal_configuration_id
    session = client.v1.billing_portal.sessions.create(params)
    url = getattr(session, "url", None)
    if not url:
        raise HTTPException(status_code=502, detail="Stripe did not return a portal URL")
    return str(url)


def verify_stripe_event(payload: bytes, signature: str | None) -> dict[str, Any]:
    if not settings.stripe_configured:
        raise HTTPException(status_code=503, detail="Stripe billing is not configured yet")
    if stripe_client is None:
        raise HTTPException(status_code=503, detail="Stripe dependency is not installed")
    if not signature:
        raise HTTPException(status_code=400, detail="Missing Stripe signature")
    try:
        event = stripe_client.Webhook.construct_event(
            payload=payload,
            sig_header=signature,
            secret=settings.stripe_webhook_secret,
        )
    except Exception as exc:
        logger.warning("stripe_webhook_verification_failed", error_type=type(exc).__name__)
        raise HTTPException(status_code=400, detail="Invalid Stripe webhook signature") from exc
    result = stripe_object_dict(event)
    live_key = settings.stripe_secret_key.startswith(("sk_live_", "rk_live_"))
    if result.get("livemode") is not live_key:
        raise HTTPException(400, "Stripe event mode does not match billing configuration")
    return result


def handle_stripe_event(db: Session, event: dict[str, Any]) -> dict[str, str]:
    event_type = str(event.get("type", ""))
    data = event.get("data", {})
    obj = data.get("object", {}) if isinstance(data, dict) else {}
    if not isinstance(obj, dict):
        return {"status": "ignored"}
    if event_type in {"checkout.session.completed", "checkout.session.async_payment_succeeded"}:
        if obj.get("mode") != "subscription" or obj.get("payment_status") not in {
            "paid",
            "no_payment_required",
        }:
            return {"status": "ignored"}
        stripe_id = _nullable_str(obj.get("subscription"))
    elif event_type in {
        "customer.subscription.created",
        "customer.subscription.updated",
        "customer.subscription.deleted",
        "customer.subscription.paused",
        "customer.subscription.resumed",
    }:
        stripe_id = _nullable_str(obj.get("id"))
    elif event_type in {
        "invoice.paid",
        "invoice.payment_failed",
        "invoice.payment_action_required",
    }:
        stripe_id = _nullable_str(obj.get("subscription")) or _nullable_str(
            (obj.get("parent") or {}).get("subscription_details", {}).get("subscription")
        )
    else:
        return {"status": "ignored"}
    if not stripe_id or not event.get("id"):
        return {"status": "ignored"}
    linked = db.scalar(
        select(UserSubscription).where(UserSubscription.stripe_subscription_id == stripe_id)
    )
    metadata = obj.get("metadata") or {}
    user_id = linked.user_id if linked else metadata.get("user_id")
    user = db.scalar(select(User).where(User.id == user_id).with_for_update()) if user_id else None
    if not user:
        return {"status": "ignored"}
    event_hash = hashlib.sha256(str(event["id"]).encode()).hexdigest()[:32]
    if db.scalar(
        select(AuditEvent.id).where(
            AuditEvent.user_id == user.id,
            AuditEvent.event_type == "stripe_event_processed",
            AuditEvent.entity_id == event_hash,
        )
    ):
        return {"status": "duplicate"}
    # Fetch inside the account lock: delayed events must not undo newer billing state.
    try:
        current = stripe_object_dict(
            _configured_stripe_client().v1.subscriptions.retrieve(stripe_id)
        )
    except Exception as exc:
        logger.warning("stripe_subscription_sync_failed", error_type=type(exc).__name__)
        raise HTTPException(503, "Subscription confirmation will be retried") from exc
    current_metadata = current.get("metadata") or {}
    if current_metadata.get("user_id") != user.id:
        return {"status": "ignored"}
    price_id = _price_id_from_subscription_event(current)
    tier = next(
        (
            tier
            for tier in PLAN_KEY_BY_TIER
            if price_id and price_id == settings.stripe_price_id_for_tier(tier)
        ),
        None,
    )
    subscription = subscription_for_user(db, user)
    customer_id = _nullable_str(current.get("customer"))
    if (
        subscription
        and subscription.stripe_customer_id
        and subscription.stripe_customer_id != customer_id
    ):
        return {"status": "ignored"}
    if subscription and subscription.stripe_subscription_id != stripe_id:
        if current.get("status") not in ACTIVE_STATUSES:
            return {"status": "ignored"}
        if subscription.source == "stripe" and is_subscription_active(subscription):
            logger.error("stripe_duplicate_subscription", user_id=user.id)
            raise HTTPException(409, "A different subscription is already active")
    if (
        subscription
        and subscription.source == "waiver_code"
        and current.get("status") not in ACTIVE_STATUSES
    ):
        return {"status": "ignored"}
    if tier is None and not linked:
        return {"status": "ignored"}
    if not subscription:
        subscription = UserSubscription(user_id=user.id, metadata_json={})
        db.add(subscription)
    subscription.plan_key = PLAN_KEY_BY_TIER[tier] if tier else "unsupported"
    subscription.status = str(current.get("status", "inactive")) if tier else "inactive"
    subscription.source = "stripe"
    subscription.stripe_customer_id = customer_id
    subscription.stripe_subscription_id = stripe_id
    subscription.stripe_price_id = price_id
    subscription.cancel_at_period_end = bool(current.get("cancel_at_period_end", False))
    items = (current.get("items") or {}).get("data", [])
    period_end = current.get("current_period_end") or next(
        (
            item.get("current_period_end")
            for item in items
            if (item.get("price") or {}).get("id") == price_id
        ),
        None,
    )
    if subscription.status == "trialing":
        period_end = current.get("trial_end") or period_end
    subscription.current_period_end = (
        datetime.utcfromtimestamp(period_end) if isinstance(period_end, int) else None
    )
    subscription.metadata_json = {
        **(subscription.metadata_json or {}),
        "stripe_status": subscription.status,
        "trial_used": True,
        "pending_checkout": None,
        "checkout_attempt": None,
    }
    db.add(
        AuditEvent(
            user_id=user.id,
            event_type="stripe_event_processed",
            entity_type="stripe_event",
            entity_id=event_hash,
            payload={"type": event_type, "status": subscription.status},
        )
    )
    db.commit()
    return {"status": "processed"}


def stripe_object_dict(obj: Any) -> dict[str, Any]:
    if isinstance(obj, dict):
        return obj
    return cast(dict[str, Any], obj.to_dict())


def _nullable_str(value: object) -> str | None:
    return str(value) if value else None


def _configured_stripe_client(tier: SubscriptionTier | None = None) -> Any:
    if tier and not settings.stripe_configured_for_tier(tier):
        raise HTTPException(
            status_code=503,
            detail=f"Stripe {tier.title()} billing is not configured yet",
        )
    if not tier and not settings.stripe_configured:
        raise HTTPException(status_code=503, detail="Stripe billing is not configured yet")
    if stripe_client is None:
        raise HTTPException(status_code=503, detail="Stripe dependency is not installed")
    client = stripe_client.StripeClient(
        settings.stripe_secret_key,
        stripe_version=settings.stripe_api_version,
    )
    _assert_expected_stripe_account(client)
    return client


def _assert_expected_stripe_account(client: Any) -> None:
    expected_account_id = settings.stripe_expected_account_id.strip()
    if not expected_account_id:
        return
    try:
        account = client.v1.accounts.retrieve_current()
    except Exception as exc:
        logger.warning("stripe_account_verification_failed", error_type=type(exc).__name__)
        raise HTTPException(status_code=503, detail="Stripe account verification failed") from exc
    actual_account_id = _stripe_object_value(account, "id")
    if actual_account_id != expected_account_id:
        logger.error(
            "stripe_account_mismatch",
            expected_account_id=expected_account_id,
            actual_account_id=actual_account_id,
        )
        raise HTTPException(status_code=503, detail="Stripe account mismatch")


def _stripe_object_value(obj: object, key: str) -> str | None:
    if isinstance(obj, dict):
        value = obj.get(key)
    else:
        value = getattr(obj, key, None)
    return str(value) if value else None


def _normalize_tier(tier: str) -> SubscriptionTier:
    normalized = tier.strip().lower()
    if normalized == BASIC_TIER:
        return BASIC_TIER
    if normalized == PREMIUM_TIER:
        return PREMIUM_TIER
    raise HTTPException(status_code=422, detail="Subscription tier must be basic or premium")


def _tier_for_waiver_code(normalized: str) -> SubscriptionTier | None:
    if any(secrets.compare_digest(normalized, valid) for valid in settings.basic_waiver_code_list):
        return BASIC_TIER
    if any(
        secrets.compare_digest(normalized, valid) for valid in settings.premium_waiver_code_list
    ):
        return PREMIUM_TIER
    return None


def _tier_from_plan_key(plan_key: str | None) -> SubscriptionTier | None:
    if plan_key == BASIC_PLAN_KEY:
        return BASIC_TIER
    if plan_key in {PREMIUM_PLAN_KEY, LEGACY_PREMIUM_PLAN_KEY}:
        return PREMIUM_TIER
    return None


def _price_id_from_subscription_event(subscription_event: dict[str, Any]) -> str | None:
    items = subscription_event.get("items")
    if not isinstance(items, dict):
        return None
    data = items.get("data")
    if not isinstance(data, list) or not data:
        return None
    first = data[0]
    if not isinstance(first, dict):
        return None
    price = first.get("price")
    if not isinstance(price, dict):
        return None
    return _nullable_str(price.get("id"))
