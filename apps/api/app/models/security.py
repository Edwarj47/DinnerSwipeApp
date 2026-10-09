from datetime import datetime

from sqlalchemy import Boolean, DateTime, ForeignKey, Integer, String
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base
from app.models.entities import uuid_str


class RateLimitCounter(Base):
    __tablename__ = "security_rate_counters"
    key: Mapped[str] = mapped_column(String(64), primary_key=True)
    count: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    reset_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, index=True)


class MediaObject(Base):
    __tablename__ = "recipe_media_objects"
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=uuid_str)
    owner_user_id: Mapped[str] = mapped_column(ForeignKey("users.id"), nullable=False, index=True)
    storage_key: Mapped[str] = mapped_column(String(512), nullable=False, unique=True)
    backend: Mapped[str] = mapped_column(String(30), nullable=False)
    content_type: Mapped[str] = mapped_column(String(80), nullable=False)
    size_bytes: Mapped[int] = mapped_column(Integer, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, default=datetime.utcnow)
    claimed_at: Mapped[datetime | None] = mapped_column(DateTime)
    orphaned_at: Mapped[datetime | None] = mapped_column(DateTime)
    managed: Mapped[bool] = mapped_column(
        Boolean, default=True, server_default="true", nullable=False
    )
    deleted_at: Mapped[datetime | None] = mapped_column(DateTime)
