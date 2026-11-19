from __future__ import annotations

import base64
import hashlib
import json
import time
from datetime import datetime, timedelta
from typing import Any

from fastapi import HTTPException
from sqlalchemy import or_, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.core.config import settings
from app.models.entities import User
from app.models.native_billing import (
    NativeBillingAccount,
    NativeBillingNotification,
    NativePurchase,
)
from app.services import native_stores as stores


def digest(value: str) -> str:
    return hashlib.sha256(value.encode()).hexdigest()


def account_for_user(db: Session, user: User) -> NativeBillingAccount:
    active = db.scalar(
        select(User)
        .where(User.id == user.id)
        .with_for_update()
        .execution_options(populate_existing=True)
    )
    if not active or not active.is_active:
        raise HTTPException(401, "Account access was revoked.")
    row = db.scalar(select(NativeBillingAccount).where(NativeBillingAccount.user_id == user.id))
    if row is None:
        row = NativeBillingAccount(user_id=user.id)
        db.add(row)
        db.flush()
    if row.deleted_at:
        raise HTTPException(409, "Deleted billing accounts cannot be restored.")
    return row


def native_context(db: Session, user: User) -> dict[str, Any]:
    account = account_for_user(db, user)
    db.commit()
    return {
        "account_id": account.id,
        "apple": {
            "enabled": stores.configured("apple"),
            "product_id": settings.native_apple_product_id,
            "account_token": account.apple_token,
        },
        "google": {
            "enabled": stores.configured("google"),
            "product_id": settings.native_google_product_id,
            "base_plan_id": settings.native_google_base_plan_id,
            "account_token": account.google_token,
        },
    }


def native_history(db: Session, user: User) -> bool:
    return (
        db.scalar(
            select(NativePurchase.id)
            .join(NativeBillingAccount)
            .where(
                NativeBillingAccount.user_id == user.id,
                NativePurchase.state != "SUBSCRIPTION_STATE_PENDING",
            )
            .limit(1)
        )
        is not None
    )


def active_native_purchase(db: Session, user: User) -> NativePurchase | None:
    if not user.is_active:
        return None
    now = datetime.utcnow()
    return db.scalar(
        select(NativePurchase)
        .join(NativeBillingAccount)
        .where(
            NativeBillingAccount.user_id == user.id,
            NativeBillingAccount.deleted_at.is_(None),
            NativePurchase.superseded.is_(False),
            NativePurchase.valid_until > now,
            NativePurchase.verified_at
            > now - timedelta(hours=settings.native_verification_lease_hours),
        )
        .order_by(NativePurchase.valid_until.desc())
        .limit(1)
    )


def _existing(db: Session, snapshot: stores.StoreSnapshot) -> NativePurchase | None:
    return db.scalar(
        select(NativePurchase)
        .where(
            NativePurchase.provider == snapshot.provider,
            NativePurchase.environment == snapshot.environment,
            NativePurchase.chain_hash == digest(snapshot.chain),
        )
        .with_for_update()
    )


def _assert_owner(
    db: Session,
    snapshot: stores.StoreSnapshot,
    expected: NativeBillingAccount | None,
) -> NativeBillingAccount:
    existing = _existing(db, snapshot)
    if existing:
        account = db.scalar(
            select(NativeBillingAccount)
            .where(
                NativeBillingAccount.id == existing.account_id,
            )
            .execution_options(populate_existing=True)
        )
    else:
        token = (
            NativeBillingAccount.apple_token
            if snapshot.provider == "apple"
            else (NativeBillingAccount.google_token)
        )
        account = (
            db.scalar(
                select(NativeBillingAccount)
                .where(
                    token == snapshot.binding,
                )
                .execution_options(populate_existing=True)
            )
            if snapshot.binding
            else None
        )
    if not account or not account.user_id or account.deleted_at:
        raise HTTPException(409, "Purchase ownership could not be verified for this account.")
    owner = db.scalar(
        select(User)
        .where(User.id == account.user_id)
        .with_for_update()
        .execution_options(populate_existing=True)
    )
    if not owner or not owner.is_active or (expected and account.id != expected.id):
        raise HTTPException(409, "This purchase belongs to another or deleted account.")
    account = db.scalars(
        select(NativeBillingAccount)
        .where(
            NativeBillingAccount.id == account.id,
        )
        .with_for_update()
        .execution_options(populate_existing=True)
    ).one()
    if not account.user_id or account.deleted_at:
        raise HTTPException(409, "Deleted billing accounts cannot be restored.")
    binding = account.apple_token if snapshot.provider == "apple" else account.google_token
    if snapshot.binding and snapshot.binding.lower() != binding.lower():
        raise HTTPException(409, "Store account binding does not match.")
    return account


def _persist(
    db: Session,
    snapshot: stores.StoreSnapshot,
    account: NativeBillingAccount,
) -> NativePurchase:
    row = _existing(db, snapshot)
    if row is None:
        row = NativePurchase(
            account_id=account.id,
            provider=snapshot.provider,
            environment=snapshot.environment,
            chain_hash=digest(snapshot.chain),
            superseded=False,
        )
        db.add(row)
    now = datetime.utcnow()
    continuing_ack = bool(row.ack_pending and snapshot.ack_pending)
    row.reference_encrypted = stores.token_cipher().encrypt(snapshot.reference.encode()).decode()
    row.product_id = snapshot.product_id
    row.state = snapshot.state
    row.expires_at = snapshot.expires_at
    row.valid_until = snapshot.valid_until
    row.verified_at = now
    row.auto_renew = snapshot.auto_renew
    row.ack_pending = bool(
        snapshot.ack_pending
        and snapshot.valid_until
        and snapshot.valid_until > now
        and not row.superseded
    )
    row.attempts = (row.attempts or 0) if continuing_ack else 0
    row.next_check_at = now if row.ack_pending else now + timedelta(hours=1)
    db.flush()
    return row


def apply_snapshot(
    db: Session,
    snapshot: stores.StoreSnapshot,
    expected: NativeBillingAccount | None = None,
) -> NativePurchase:
    account = _assert_owner(db, snapshot, expected)
    # Re-read under the owner lock, so a slower earlier response cannot undo a refund/renewal.
    snapshot = stores.fetch_store(snapshot.provider, snapshot.reference)
    _assert_owner(db, snapshot, account)
    if snapshot.provider == "google" and snapshot.linked:
        if snapshot.linked == snapshot.chain:
            raise HTTPException(409, "Invalid replacement chain.")
        predecessor = db.scalar(
            select(NativePurchase)
            .where(
                NativePurchase.provider == "google",
                NativePurchase.chain_hash == digest(snapshot.linked),
            )
            .with_for_update()
        )
        if predecessor is None:
            old = stores.fetch_google(snapshot.linked)
            _assert_owner(db, old, account)
            predecessor = _persist(db, old, account)
        if predecessor.account_id != account.id:
            raise HTTPException(409, "Replacement purchase belongs to another account.")
        predecessor.superseded = True
        predecessor.ack_pending = False
        predecessor.valid_until = None
    return _persist(db, snapshot, account)


def verify_purchase(db: Session, user: User, provider: str, reference: str) -> dict[str, Any]:
    from app.services.billing import serialize_subscription_status

    stores.require_configured(provider)
    account = account_for_user(db, user)
    db.commit()
    snapshot = stores.fetch_store(provider, reference)
    try:
        row = apply_snapshot(db, snapshot, account)
        db.commit()
    except IntegrityError as exc:
        db.rollback()
        raise HTTPException(409, "Purchase ownership changed. Retry verification.") from exc
    if row.ack_pending:
        _acknowledge(db, row)
    return {
        "verified": True,
        "finish_transaction": provider == "apple",
        "subscription": serialize_subscription_status(db, user),
    }


def _backoff(attempts: int) -> timedelta:
    return timedelta(seconds=min(3600, 30 * 2 ** min(attempts, 7)))


def _acknowledge(db: Session, row: NativePurchase) -> None:
    # The grant and retry marker have committed before any acknowledgement is sent.
    account = db.get(NativeBillingAccount, row.account_id, populate_existing=True)
    if (
        not account
        or not account.user_id
        or account.deleted_at
        or row.superseded
        or not row.valid_until
        or row.valid_until <= datetime.utcnow()
    ):
        row.ack_pending = False
        db.commit()
        return
    try:
        stores.acknowledge_google(
            stores.token_cipher().decrypt(row.reference_encrypted.encode()).decode(),
            row.product_id,
        )
        row.ack_pending = False
        row.attempts = 0
        row.next_check_at = datetime.utcnow() + timedelta(hours=1)
    except Exception:
        row.attempts += 1
        row.next_check_at = datetime.utcnow() + _backoff(row.attempts)
    db.commit()


def enqueue_notification(db: Session, provider: str, event_id: str, reference: str | None) -> str:
    if not event_id or len(event_id) > 512:
        raise HTTPException(400, "Invalid notification identifier.")
    key = digest(event_id)
    if db.scalar(
        select(NativeBillingNotification.id).where(
            NativeBillingNotification.provider == provider,
            NativeBillingNotification.event_hash == key,
        )
    ):
        return "duplicate"
    try:
        db.add(
            NativeBillingNotification(
                provider=provider,
                event_hash=key,
                reference_encrypted=stores.token_cipher().encrypt(reference.encode()).decode()
                if reference
                else None,
                status="pending" if reference else "done",
                next_check_at=datetime.utcnow(),
            )
        )
        db.commit()
    except IntegrityError:
        db.rollback()
        return "duplicate"
    return "received"


def apple_notification(db: Session, signed_payload: str) -> str:
    try:
        verifier = stores.apple_verifier()
        notification = verifier.verify_and_decode_notification(signed_payload)
        data = notification.data
        reference = None
        if data and data.signedTransactionInfo:
            tx = verifier.verify_and_decode_signed_transaction(data.signedTransactionInfo)
            if tx.productId != settings.native_apple_product_id:
                raise HTTPException(400, "Unknown notification product.")
            reference = tx.transactionId
        if not notification.notificationUUID:
            raise ValueError("Missing notification identifier")
        return enqueue_notification(db, "apple", notification.notificationUUID, reference)
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(400, "Invalid signed store notification.") from exc


def google_notification(db: Session, authorization: str | None, body: bytes) -> str:
    stores.verify_google_push(authorization)
    try:
        envelope = json.loads(body)
        message = envelope["message"]
        payload = json.loads(base64.b64decode(message["data"], validate=True))
        if payload.get("packageName") != stores.APP_ID:
            raise ValueError("Wrong application")
        details = payload.get("subscriptionNotification") or payload.get(
            "voidedPurchaseNotification"
        )
        reference = details["purchaseToken"] if details else None
        if not details and not payload.get("testNotification"):
            raise ValueError("Unsupported notification")
        if reference and (not isinstance(reference, str) or len(reference) > 4096):
            raise ValueError("Invalid reference")
        return enqueue_notification(db, "google", message["messageId"], reference)
    except (KeyError, TypeError, ValueError) as exc:
        raise HTTPException(400, "Invalid Google notification.") from exc


def process_native_billing(db: Session) -> None:
    deadline = time.monotonic() + settings.native_reconcile_budget_seconds
    now = datetime.utcnow()
    notifications = list(
        db.scalars(
            select(NativeBillingNotification)
            .where(
                NativeBillingNotification.status == "pending",
                NativeBillingNotification.next_check_at <= now,
            )
            .order_by(NativeBillingNotification.next_check_at)
            .limit(settings.native_reconcile_batch)
        )
    )
    for event in notifications:
        if time.monotonic() >= deadline:
            break
        try:
            if event.reference_encrypted is None:
                raise HTTPException(400, "Missing purchase reference.")
            reference = stores.token_cipher().decrypt(event.reference_encrypted.encode()).decode()
            snapshot = stores.fetch_store(event.provider, reference)
            row = apply_snapshot(db, snapshot)
            event.status = "done"
            db.commit()
            if row.ack_pending:
                _acknowledge(db, row)
        except HTTPException as exc:
            db.rollback()
            event.attempts += 1
            if exc.status_code in {400, 409}:
                event.status = "rejected"
            event.next_check_at = datetime.utcnow() + _backoff(event.attempts)
            db.commit()
        except Exception:
            db.rollback()
            event.attempts += 1
            event.next_check_at = datetime.utcnow() + _backoff(event.attempts)
            db.commit()
    purchases = list(
        db.scalars(
            select(NativePurchase)
            .join(NativeBillingAccount)
            .where(
                NativeBillingAccount.user_id.is_not(None),
                NativeBillingAccount.deleted_at.is_(None),
                NativePurchase.superseded.is_(False),
                NativePurchase.next_check_at <= now,
                or_(
                    NativePurchase.expires_at > now - timedelta(days=60),
                    NativePurchase.ack_pending.is_(True),
                ),
            )
            .order_by(NativePurchase.next_check_at)
            .limit(settings.native_reconcile_batch)
        )
    )
    for purchase in purchases:
        if time.monotonic() >= deadline:
            break
        try:
            reference = (
                stores.token_cipher().decrypt(purchase.reference_encrypted.encode()).decode()
            )
            snapshot = stores.fetch_store(purchase.provider, reference)
            row = apply_snapshot(db, snapshot)
            db.commit()
            if row.ack_pending:
                _acknowledge(db, row)
        except Exception:
            db.rollback()
            purchase.attempts += 1
            purchase.next_check_at = datetime.utcnow() + _backoff(purchase.attempts)
            db.commit()
