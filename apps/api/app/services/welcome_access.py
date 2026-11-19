from __future__ import annotations

from datetime import datetime, timedelta

from fastapi import HTTPException
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models.entities import AuditEvent, ComplimentaryPremiumAccess, User, UserSubscription

WELCOME_OFFER = "premium_welcome_30d_v1"
WELCOME_DAYS = 30


def native_paid_history(db: Session, user: User) -> bool:
    from app.services.native_billing import native_history

    return native_history(db, user)


def welcome_for_user(db: Session, user: User) -> ComplimentaryPremiumAccess | None:
    return db.get(ComplimentaryPremiumAccess, user.id)


def paid_history(subscription: UserSubscription | None) -> bool:
    return bool(
        subscription
        and (
            subscription.stripe_subscription_id
            or subscription.metadata_json.get("trial_used")
            or subscription.status in {"active", "trialing", "past_due", "unpaid"}
        )
    )


def welcome_active(
    user: User, welcome: ComplimentaryPremiumAccess | None, now: datetime | None = None
) -> bool:
    now = now or datetime.utcnow()
    return bool(
        user.is_active
        and user.email_verified
        and welcome
        and welcome.started_at
        and welcome.ends_at
        and welcome.started_at <= now < welcome.ends_at
    )


def start_welcome(db: Session, user: User) -> ComplimentaryPremiumAccess:
    user = db.scalars(
        select(User)
        .where(User.id == user.id)
        .with_for_update()
        .execution_options(populate_existing=True)
    ).one()
    if not user.is_active or not user.email_verified:
        raise HTTPException(403, "Verify your email before starting complimentary Premium.")
    welcome = welcome_for_user(db, user)
    if welcome is None:
        raise HTTPException(409, "This account is not eligible for welcome access.")
    if welcome.started_at is not None:
        return welcome
    subscription = db.scalar(select(UserSubscription).where(UserSubscription.user_id == user.id))
    if subscription and (
        (subscription.metadata_json or {}).get("pending_checkout")
        or (subscription.metadata_json or {}).get("checkout_attempt")
    ):
        raise HTTPException(
            409, "An earlier checkout must be resolved before welcome access can start."
        )
    if paid_history(subscription) or native_paid_history(db, user):
        raise HTTPException(409, "Your existing subscription terms are unchanged.")
    now = datetime.utcnow()
    welcome.started_at = now
    welcome.ends_at = now + timedelta(days=WELCOME_DAYS)
    db.add(
        AuditEvent(
            user_id=user.id,
            event_type="complimentary_premium_started",
            entity_type="complimentary_premium_access",
            entity_id=user.id,
            payload={
                "offer_key": WELCOME_OFFER,
                "ends_at": welcome.ends_at.isoformat(),
                "automatic_charge": False,
            },
        )
    )
    db.commit()
    db.refresh(welcome)
    return welcome
