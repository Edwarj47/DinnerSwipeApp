from __future__ import annotations

import secrets
from datetime import datetime

from sqlalchemy import Boolean, DateTime, ForeignKey, Integer, String, Text, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base
from app.models.entities import TimestampMixin, uuid_str


class NativeBillingAccount(Base, TimestampMixin):
    __tablename__ = "native_billing_accounts"
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=uuid_str)
    user_id: Mapped[str | None] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL"), unique=True, nullable=True
    )
    apple_token: Mapped[str] = mapped_column(String(36), unique=True, default=uuid_str)
    google_token: Mapped[str] = mapped_column(
        String(64), unique=True, default=lambda: secrets.token_hex(32)
    )
    deleted_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)


class NativePurchase(Base, TimestampMixin):
    __tablename__ = "native_purchases"
    __table_args__ = (UniqueConstraint("provider", "environment", "chain_hash"),)
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=uuid_str)
    account_id: Mapped[str] = mapped_column(ForeignKey("native_billing_accounts.id"), index=True)
    provider: Mapped[str] = mapped_column(String(16))
    environment: Mapped[str] = mapped_column(String(16))
    chain_hash: Mapped[str] = mapped_column(String(64))
    reference_encrypted: Mapped[str] = mapped_column(Text)
    product_id: Mapped[str] = mapped_column(String(255))
    state: Mapped[str] = mapped_column(String(40))
    expires_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    valid_until: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    verified_at: Mapped[datetime] = mapped_column(DateTime)
    auto_renew: Mapped[bool] = mapped_column(Boolean, default=False)
    ack_pending: Mapped[bool] = mapped_column(Boolean, default=False)
    superseded: Mapped[bool] = mapped_column(Boolean, default=False)
    attempts: Mapped[int] = mapped_column(Integer, default=0)
    next_check_at: Mapped[datetime] = mapped_column(DateTime, index=True)


class NativeBillingNotification(Base, TimestampMixin):
    __tablename__ = "native_billing_notifications"
    __table_args__ = (UniqueConstraint("provider", "event_hash"),)
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=uuid_str)
    provider: Mapped[str] = mapped_column(String(16))
    event_hash: Mapped[str] = mapped_column(String(64))
    reference_encrypted: Mapped[str | None] = mapped_column(Text, nullable=True)
    status: Mapped[str] = mapped_column(String(16), default="pending")
    attempts: Mapped[int] = mapped_column(Integer, default=0)
    next_check_at: Mapped[datetime] = mapped_column(DateTime, index=True)
