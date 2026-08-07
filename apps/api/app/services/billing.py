from __future__ import annotations

import hashlib
import secrets
from datetime import datetime
from typing import Any, cast

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
PLAN_KEY = "macro_tracker_monthly"


def waiver_code_hash(code: str) -> str:
    return hashlib.sha256(code.strip().lower().encode("utf-8")).hexdigest()


def subscription_for_user(db: Session, user: User) -> UserSubscription | None:
    return db.scalar(select(UserSubscription).where(UserSubscription.user_id == user.id))


def is_premium_active(subscription: UserSubscription | None) -> bool:
    if not subscription:
        return False
    if subscription.source == "waiver_code" and subscription.status == "active":
        return True
    return subscription.status in ACTIVE_STATUSES


def serialize_premium_status(db: Session, user: User) -> dict[str, Any]:
    subscription = subscription_for_user(db, user)
    return {
        "active": is_premium_active(subscription),
        "plan_key": subscription.plan_key if subscription else PLAN_KEY,
        "status": subscription.status if subscription else "inactive",
        "source": subscription.source if subscription else None,
        "monthly_price_cents": settings.premium_monthly_price_cents,
        "stripe_configured": settings.stripe_configured,
        "billing_management_available": bool(
            subscription
            and subscription.source == "stripe"
            and subscription.stripe_customer_id
            and settings.stripe_configured
        ),
        "current_period_end": subscription.current_period_end if subscription else None,
        "cancel_at_period_end": subscription.cancel_at_period_end if subscription else False,
    }


def require_premium(db: Session, user: User) -> UserSubscription:
    subscription = subscription_for_user(db, user)
    if not is_premium_active(subscription):
        raise HTTPException(status_code=402, detail="Premium macro tracking is required")
    assert subscription is not None
    return subscription


def redeem_waiver_code(db: Session, user: User, code: str) -> dict[str, Any]:
    normalized = code.strip().lower()
    valid_codes = settings.premium_waiver_code_list
    if not any(secrets.compare_digest(normalized, valid) for valid in valid_codes):
        raise HTTPException(status_code=400, detail="Invalid waiver code")
    code_hash = waiver_code_hash(normalized)
    subscription = subscription_for_user(db, user)
    if not subscription:
        subscription = UserSubscription(user_id=user.id)
        db.add(subscription)
    subscription.plan_key = PLAN_KEY
    subscription.status = "active"
    subscription.source = "waiver_code"
    subscription.stripe_price_id = None
    subscription.current_period_end = None
    subscription.cancel_at_period_end = False
    subscription.fee_waiver_code_hash = code_hash
    subscription.metadata_json = {"waiver": "friend_beta"}
    db.add(
        AuditEvent(
            user_id=user.id,
            event_type="premium_waiver_redeemed",
            entity_type="user_subscription",
            entity_id=subscription.id,
            payload={"plan_key": PLAN_KEY},
        )
    )
    db.commit()
    return serialize_premium_status(db, user)


def create_checkout_session(db: Session, user: User) -> str:
    client = _configured_stripe_client()
    subscription = subscription_for_user(db, user)
    success_url = f"{settings.app_public_url.rstrip('/')}/profile?premium=success"
    cancel_url = f"{settings.app_public_url.rstrip('/')}/profile?premium=cancelled"
    params: dict[str, Any] = {
        "mode": "subscription",
        "line_items": [{"price": settings.stripe_premium_price_id, "quantity": 1}],
        "allow_promotion_codes": True,
        "success_url": success_url,
        "cancel_url": cancel_url,
        "client_reference_id": user.id,
        "metadata": {"user_id": user.id, "plan_key": PLAN_KEY},
        "subscription_data": {"metadata": {"user_id": user.id, "plan_key": PLAN_KEY}},
    }
    if subscription and subscription.stripe_customer_id:
        params["customer"] = subscription.stripe_customer_id
    else:
        params["customer_email"] = user.email
    session = client.checkout.Session.create(**params)
    url = getattr(session, "url", None)
    if not url:
        raise HTTPException(status_code=502, detail="Stripe did not return a checkout URL")
    return str(url)


def create_customer_portal_session(db: Session, user: User) -> str:
    client = _configured_stripe_client()
    subscription = subscription_for_user(db, user)
    if not subscription or subscription.source != "stripe" or not subscription.stripe_customer_id:
        raise HTTPException(status_code=409, detail="No Stripe billing account is linked")
    session = client.billing_portal.Session.create(
        customer=subscription.stripe_customer_id,
        return_url=f"{settings.app_public_url.rstrip('/')}/profile?premium=manage",
    )
    url = getattr(session, "url", None)
    if not url:
        raise HTTPException(status_code=502, detail="Stripe did not return a portal URL")
    return str(url)


def verify_stripe_event(payload: bytes, signature: str | None) -> dict[str, Any]:
    client = _configured_stripe_client()
    if not signature:
        raise HTTPException(status_code=400, detail="Missing Stripe signature")
    try:
        event = client.Webhook.construct_event(
            payload=payload,
            sig_header=signature,
            secret=settings.stripe_webhook_secret,
        )
    except Exception as exc:
        logger.warning("stripe_webhook_verification_failed", error_type=type(exc).__name__)
        raise HTTPException(status_code=400, detail="Invalid Stripe webhook signature") from exc
    if hasattr(event, "to_dict_recursive"):
        return cast(dict[str, Any], event.to_dict_recursive())
    return cast(dict[str, Any], dict(event))


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
    subscription = subscription_for_user(db, user)
    if not subscription:
        subscription = UserSubscription(user_id=user.id)
        db.add(subscription)
    subscription.plan_key = PLAN_KEY
    subscription.status = "active"
    subscription.source = "stripe"
    subscription.stripe_customer_id = _nullable_str(session.get("customer"))
    subscription.stripe_subscription_id = _nullable_str(session.get("subscription"))
    subscription.stripe_price_id = settings.stripe_premium_price_id
    subscription.metadata_json = {"checkout_session_id": session.get("id")}


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
    user_id = metadata.get("user_id") if isinstance(metadata, dict) else None
    if not subscription and user_id:
        user = db.get(User, str(user_id))
        if not user:
            return
        subscription = UserSubscription(user_id=user.id)
        db.add(subscription)
    if not subscription:
        return
    subscription.plan_key = PLAN_KEY
    subscription.status = (
        "cancelled" if deleted else str(subscription_event.get("status", "inactive"))
    )
    subscription.source = "stripe"
    subscription.stripe_customer_id = _nullable_str(subscription_event.get("customer"))
    subscription.stripe_subscription_id = stripe_subscription_id
    subscription.stripe_price_id = settings.stripe_premium_price_id
    subscription.cancel_at_period_end = bool(subscription_event.get("cancel_at_period_end", False))
    period_end = subscription_event.get("current_period_end")
    subscription.current_period_end = (
        datetime.utcfromtimestamp(period_end) if isinstance(period_end, int) else None
    )
    subscription.metadata_json = {"stripe_status": subscription.status}


def _nullable_str(value: object) -> str | None:
    return str(value) if value else None


def _configured_stripe_client() -> Any:
    if not settings.stripe_configured:
        raise HTTPException(status_code=503, detail="Stripe billing is not configured yet")
    if stripe_client is None:
        raise HTTPException(status_code=503, detail="Stripe dependency is not installed")
    stripe_client.api_key = settings.stripe_secret_key
    _assert_expected_stripe_account(stripe_client)
    return stripe_client


def _assert_expected_stripe_account(client: Any) -> None:
    expected_account_id = settings.stripe_expected_account_id.strip()
    if not expected_account_id:
        return
    try:
        account = client.Account.retrieve()
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
