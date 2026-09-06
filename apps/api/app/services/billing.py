from __future__ import annotations

import hashlib
import math
import random
import secrets
import string
from datetime import datetime, timedelta
from typing import Any, Literal, cast

import structlog
from fastapi import HTTPException
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.config import settings
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


def is_subscription_active(subscription: UserSubscription | None) -> bool:
    if not subscription:
        return False
    if subscription.source == "waiver_code" and subscription.status == "active":
        return True
    return subscription.status in ACTIVE_STATUSES


def subscription_plan_rank(subscription: UserSubscription | None) -> int:
    if subscription is None or not is_subscription_active(subscription):
        return 0
    return PLAN_RANK.get(subscription.plan_key, 0)


def is_premium_active(subscription: UserSubscription | None) -> bool:
    return subscription_plan_rank(subscription) >= PLAN_RANK[PREMIUM_PLAN_KEY]


def basic_trial_ends_at(user: User) -> datetime | None:
    trial_days = max(0, settings.basic_free_trial_days)
    if trial_days == 0:
        return None
    return user.created_at + timedelta(days=trial_days)


def trial_days_remaining(user: User, now: datetime | None = None) -> int:
    trial_end = basic_trial_ends_at(user)
    if not trial_end:
        return 0
    now = now or datetime.utcnow()
    remaining_seconds = (trial_end - now).total_seconds()
    if remaining_seconds <= 0:
        return 0
    return max(1, math.ceil(remaining_seconds / 86_400))


def is_basic_access_active(db: Session, user: User) -> bool:
    subscription = subscription_for_user(db, user)
    if subscription_plan_rank(subscription) >= PLAN_RANK[BASIC_PLAN_KEY]:
        return True
    return trial_days_remaining(user) > 0


def require_basic_access(db: Session, user: User) -> User:
    if not is_basic_access_active(db, user):
        raise HTTPException(
            status_code=402,
            detail="Your free month has ended. Subscribe to Basic to keep using Dinner Swipe.",
        )
    return user


def serialize_premium_status(db: Session, user: User) -> dict[str, Any]:
    return serialize_subscription_status(db, user)


def serialize_subscription_status(db: Session, user: User) -> dict[str, Any]:
    subscription = subscription_for_user(db, user)
    plan_rank = subscription_plan_rank(subscription)
    premium_active = plan_rank >= PLAN_RANK[PREMIUM_PLAN_KEY]
    subscribed_basic = plan_rank >= PLAN_RANK[BASIC_PLAN_KEY]
    remaining_trial_days = 0 if subscribed_basic else trial_days_remaining(user)
    trial_end = basic_trial_ends_at(user)
    trial_active = remaining_trial_days > 0
    basic_active = subscribed_basic or trial_active
    current_tier: CurrentTier = (
        "premium"
        if premium_active
        else "basic"
        if subscribed_basic
        else "trial"
        if trial_active
        else "none"
    )
    active_plan_key = subscription.plan_key if subscription else None
    return {
        # Backward compatible fields for the existing premium macro UI.
        "active": premium_active,
        "plan_key": active_plan_key or (BASIC_PLAN_KEY if trial_active else ""),
        "status": (
            subscription.status if subscription else ("trialing" if trial_active else "inactive")
        ),
        "source": subscription.source if subscription else ("free_trial" if trial_active else None),
        "monthly_price_cents": settings.premium_monthly_price_cents,
        "stripe_configured": settings.stripe_premium_configured,
        "billing_management_available": bool(
            subscription
            and subscription.source == "stripe"
            and subscription.stripe_customer_id
            and settings.stripe_configured
        ),
        "current_period_end": subscription.current_period_end if subscription else trial_end,
        "cancel_at_period_end": subscription.cancel_at_period_end if subscription else False,
        # New tier-aware fields.
        "current_tier": current_tier,
        "basic_active": basic_active,
        "basic_subscription_active": subscribed_basic,
        "premium_active": premium_active,
        "trial_active": trial_active,
        "trial_ends_at": trial_end,
        "trial_days_remaining": remaining_trial_days,
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
    normalized = code.strip().lower()
    tier = _tier_for_waiver_code(normalized)
    if not tier:
        raise HTTPException(status_code=400, detail="Invalid access code")
    code_hash = waiver_code_hash(normalized)
    subscription = subscription_for_user(db, user)
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
    subscription.metadata_json = {"waiver": "uat", "tier": tier}
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


def create_checkout_session(db: Session, user: User, tier: SubscriptionTier = PREMIUM_TIER) -> str:
    tier = _normalize_tier(tier)
    client = _configured_stripe_client(tier)
    subscription = subscription_for_user(db, user)
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
    success_url = (
        f"{settings.app_public_url.rstrip('/')}/profile?subscription=success&tier={tier}"
    )
    cancel_url = (
        f"{settings.app_public_url.rstrip('/')}/profile?subscription=cancelled&tier={tier}"
    )
    plan_key = PLAN_KEY_BY_TIER[tier]
    metadata = {"user_id": user.id, "plan_key": plan_key, "tier": tier}
    subscription_data: dict[str, Any] = {"metadata": metadata}
    if tier == BASIC_TIER:
        remaining_days = trial_days_remaining(user)
        if remaining_days > 0:
            subscription_data["trial_period_days"] = remaining_days
    params: dict[str, Any] = {
        "mode": "subscription",
        "line_items": [{"price": settings.stripe_price_id_for_tier(tier), "quantity": 1}],
        "allow_promotion_codes": True,
        "success_url": success_url,
        "cancel_url": cancel_url,
        "client_reference_id": user.id,
        "metadata": metadata,
        "subscription_data": subscription_data,
        "integration_identifier": f"dinner_swipe_{tier}_{_random_letters(8)}",
    }
    if subscription and subscription.stripe_customer_id:
        params["customer"] = subscription.stripe_customer_id
    else:
        params["customer_email"] = user.email
    session = client.v1.checkout.sessions.create(params)
    url = getattr(session, "url", None)
    if not url:
        raise HTTPException(status_code=502, detail="Stripe did not return a checkout URL")
    return str(url)


def create_customer_portal_session(db: Session, user: User) -> str:
    client = _configured_stripe_client()
    subscription = subscription_for_user(db, user)
    if not subscription or subscription.source != "stripe" or not subscription.stripe_customer_id:
        raise HTTPException(status_code=409, detail="No Stripe billing account is linked")
    return_url = f"{settings.app_public_url.rstrip('/')}/profile?subscription=manage"
    session = client.v1.billing_portal.sessions.create(
        {"customer": subscription.stripe_customer_id, "return_url": return_url}
    )
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
    if hasattr(event, "to_dict"):
        return cast(dict[str, Any], event.to_dict())
    if hasattr(event, "_to_dict_recursive"):
        return cast(dict[str, Any], event._to_dict_recursive())
    return cast(dict[str, Any], event)


def handle_stripe_event(db: Session, event: dict[str, Any]) -> dict[str, str]:
    event_type = str(event.get("type", ""))
    data = event.get("data", {})
    obj = data.get("object", {}) if isinstance(data, dict) else {}
    if not isinstance(obj, dict):
        return {"status": "ignored"}
    if event_type == "checkout.session.completed":
        _handle_checkout_completed(db, obj)
    elif event_type in {"customer.subscription.created", "customer.subscription.updated"}:
        _handle_subscription_update(db, obj)
    elif event_type == "customer.subscription.deleted":
        _handle_subscription_update(db, obj, deleted=True)
    else:
        return {"status": "ignored"}
    db.commit()
    return {"status": "processed"}


def _handle_checkout_completed(db: Session, session: dict[str, Any]) -> None:
    user_id = session.get("client_reference_id") or session.get("metadata", {}).get("user_id")
    if not user_id:
        return
    user = db.get(User, str(user_id))
    if not user:
        return
    metadata = session.get("metadata", {})
    plan_key = _plan_key_from_metadata(metadata if isinstance(metadata, dict) else {})
    tier = _tier_from_plan_key(plan_key) or PREMIUM_TIER
    subscription = subscription_for_user(db, user)
    if not subscription:
        subscription = UserSubscription(user_id=user.id)
        db.add(subscription)
    subscription.plan_key = plan_key
    subscription.status = "active"
    subscription.source = "stripe"
    subscription.stripe_customer_id = _nullable_str(session.get("customer"))
    subscription.stripe_subscription_id = _nullable_str(session.get("subscription"))
    subscription.stripe_price_id = settings.stripe_price_id_for_tier(tier)
    subscription.metadata_json = {"checkout_session_id": session.get("id"), "tier": tier}


def _handle_subscription_update(
    db: Session, subscription_event: dict[str, Any], deleted: bool = False
) -> None:
    stripe_subscription_id = _nullable_str(subscription_event.get("id"))
    if not stripe_subscription_id:
        return
    subscription = db.scalar(
        select(UserSubscription).where(
            UserSubscription.stripe_subscription_id == stripe_subscription_id
        )
    )
    metadata = subscription_event.get("metadata", {})
    metadata = metadata if isinstance(metadata, dict) else {}
    user_id = metadata.get("user_id")
    if not subscription and user_id:
        user = db.get(User, str(user_id))
        if not user:
            return
        subscription = UserSubscription(user_id=user.id)
        db.add(subscription)
    if not subscription:
        return
    price_id = _price_id_from_subscription_event(subscription_event)
    plan_key = _plan_key_from_metadata(metadata, price_id, subscription.plan_key)
    subscription.plan_key = plan_key
    subscription.status = (
        "cancelled" if deleted else str(subscription_event.get("status", "inactive"))
    )
    subscription.source = "stripe"
    subscription.stripe_customer_id = _nullable_str(subscription_event.get("customer"))
    subscription.stripe_subscription_id = stripe_subscription_id
    subscription.stripe_price_id = price_id or subscription.stripe_price_id
    subscription.cancel_at_period_end = bool(subscription_event.get("cancel_at_period_end", False))
    period_end = subscription_event.get("current_period_end")
    subscription.current_period_end = (
        datetime.utcfromtimestamp(period_end) if isinstance(period_end, int) else None
    )
    subscription.metadata_json = {"stripe_status": subscription.status, "plan_key": plan_key}


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


def _plan_key_from_metadata(
    metadata: dict[str, Any],
    price_id: str | None = None,
    fallback: str | None = None,
) -> str:
    metadata_plan_key = str(metadata.get("plan_key") or "")
    if metadata_plan_key in PLAN_RANK:
        return metadata_plan_key
    metadata_tier = str(metadata.get("tier") or "")
    if metadata_tier == BASIC_TIER:
        return BASIC_PLAN_KEY
    if metadata_tier == PREMIUM_TIER:
        return PREMIUM_PLAN_KEY
    if price_id == settings.stripe_basic_price_id:
        return BASIC_PLAN_KEY
    if price_id == settings.stripe_premium_price_id:
        return PREMIUM_PLAN_KEY
    if fallback in PLAN_RANK:
        return str(fallback)
    return PREMIUM_PLAN_KEY


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


def _random_letters(length: int) -> str:
    return "".join(random.SystemRandom().choice(string.ascii_lowercase) for _ in range(length))
