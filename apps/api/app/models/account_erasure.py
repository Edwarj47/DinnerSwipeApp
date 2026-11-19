"""Durable erasure receipts and minimal, detached cleanup/billing records."""

from datetime import datetime

from sqlalchemy import JSON, DateTime, ForeignKey, Integer, String
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base
from app.models.entities import TimestampMixin, uuid_str


class AccountErasure(Base, TimestampMixin):
    __tablename__ = "account_erasures"
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=uuid_str)
    # Cleared after the account row is erased; the receipt does not retain email.
    user_id: Mapped[str | None] = mapped_column(String(36), unique=True, nullable=True)
    subject_hash: Mapped[str] = mapped_column(String(64), index=True)
    status: Mapped[str] = mapped_column(String(32), default="pending", index=True)
    attempts: Mapped[int] = mapped_column(Integer, default=0)
    next_attempt_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, index=True)
    last_error_code: Mapped[str | None] = mapped_column(String(40), nullable=True)
    report: Mapped[dict[str, object]] = mapped_column(JSON, default=dict)
    completed_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)


class ErasureMediaTask(Base, TimestampMixin):
    __tablename__ = "account_erasure_media_tasks"
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=uuid_str)
    erasure_id: Mapped[str] = mapped_column(ForeignKey("account_erasures.id"), index=True)
    kind: Mapped[str] = mapped_column(String(16), default="media")
    object_id: Mapped[str | None] = mapped_column(String(36), nullable=True)
    storage_key: Mapped[str] = mapped_column(String(2048))
    backend: Mapped[str] = mapped_column(String(30))


class DetachedBillingReference(Base, TimestampMixin):
    __tablename__ = "detached_billing_references"
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=uuid_str)
    erasure_id: Mapped[str] = mapped_column(ForeignKey("account_erasures.id"), index=True)
    provider: Mapped[str] = mapped_column(String(16))
    subscription_id: Mapped[str | None] = mapped_column(String(255), nullable=True)
    customer_id: Mapped[str | None] = mapped_column(String(255), nullable=True)
    status: Mapped[str] = mapped_column(String(32))
