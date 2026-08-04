from __future__ import annotations

import hashlib
import secrets
from datetime import datetime, timedelta

from fastapi import Request
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.config import settings
from app.core.rate_limit import client_identifier
from app.models.entities import AuditEvent, RefreshToken, User


def hash_refresh_token(token: str) -> str:
    return hashlib.sha256(token.encode("utf-8")).hexdigest()


def _new_refresh_token() -> str:
    return secrets.token_urlsafe(64)


def _request_metadata(request: Request | None) -> tuple[str | None, str | None]:
    if not request:
        return None, None
    user_agent = request.headers.get("user-agent")
    if user_agent and len(user_agent) > 255:
        user_agent = user_agent[:255]
    return client_identifier(request), user_agent


def issue_refresh_token(db: Session, user: User, request: Request | None = None) -> str:
    raw_token = _new_refresh_token()
    ip_address, user_agent = _request_metadata(request)
    db.add(
        RefreshToken(
            user_id=user.id,
            token_hash=hash_refresh_token(raw_token),
            expires_at=datetime.utcnow() + timedelta(days=settings.refresh_token_days),
            ip_address=ip_address,
            user_agent=user_agent,
        )
    )
    db.flush()
    return raw_token


def rotate_refresh_token(
    db: Session, raw_token: str, request: Request | None = None
) -> tuple[User, str] | None:
    row = db.scalar(
        select(RefreshToken).where(RefreshToken.token_hash == hash_refresh_token(raw_token))
    )
    if not row:
        return None
    user = db.get(User, row.user_id)
    if not user or not user.is_active:
        return None
    now = datetime.utcnow()
    if row.revoked_at is not None:
        revoke_user_refresh_tokens(db, user)
        db.add(
            AuditEvent(
                user_id=user.id,
                event_type="refresh_token_reuse_detected",
                entity_type="refresh_token",
                entity_id=row.id,
                payload={"action": "revoked_all_user_refresh_tokens"},
            )
        )
        return None
    if row.expires_at < now:
        row.revoked_at = now
        return None
    row.revoked_at = now
    new_raw_token = issue_refresh_token(db, user, request)
    replacement = db.scalar(
        select(RefreshToken).where(RefreshToken.token_hash == hash_refresh_token(new_raw_token))
    )
    row.replaced_by_token_id = replacement.id if replacement else None
    return user, new_raw_token


def revoke_refresh_token(db: Session, raw_token: str, user: User) -> bool:
    row = db.scalar(
        select(RefreshToken).where(
            RefreshToken.user_id == user.id,
            RefreshToken.token_hash == hash_refresh_token(raw_token),
        )
    )
    if not row or row.revoked_at is not None:
        return False
    row.revoked_at = datetime.utcnow()
    return True


def revoke_user_refresh_tokens(db: Session, user: User) -> int:
    rows = db.scalars(
        select(RefreshToken).where(
            RefreshToken.user_id == user.id,
            RefreshToken.revoked_at.is_(None),
        )
    ).all()
    now = datetime.utcnow()
    for row in rows:
        row.revoked_at = now
    return len(rows)
