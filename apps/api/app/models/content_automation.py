"""Owner-private, review-only content automation staging tables."""

from __future__ import annotations

from datetime import date, datetime
from typing import Any

from sqlalchemy import (
    JSON,
    CheckConstraint,
    Date,
    DateTime,
    ForeignKey,
    ForeignKeyConstraint,
    Integer,
    String,
    Text,
    UniqueConstraint,
)
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base
from app.models.entities import TimestampMixin, uuid_str


class ContentCampaign(Base, TimestampMixin):
    __tablename__ = "content_automation_campaigns"
    __table_args__ = (
        UniqueConstraint("user_id", name="uq_content_campaign_owner"),
        UniqueConstraint("id", "user_id", name="uq_content_campaign_scope"),
        CheckConstraint("days_total = 35", name="ck_content_campaign_days"),
        CheckConstraint("time_zone = 'America/New_York'", name="ck_content_campaign_zone"),
        CheckConstraint("end_date >= start_date", name="ck_content_campaign_dates"),
        CheckConstraint(
            "status IN ('active', 'paused', 'completed')", name="ck_content_campaign_status"
        ),
    )

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=uuid_str)
    user_id: Mapped[str] = mapped_column(ForeignKey("users.id"), nullable=False)
    status: Mapped[str] = mapped_column(String(16), default="active", nullable=False)
    time_zone: Mapped[str] = mapped_column(String(80), default="America/New_York")
    start_date: Mapped[date] = mapped_column(Date)
    end_date: Mapped[date] = mapped_column(Date)
    days_total: Mapped[int] = mapped_column(Integer, default=35)


class ContentDailyBatch(Base, TimestampMixin):
    __tablename__ = "content_automation_batches"
    __table_args__ = (
        ForeignKeyConstraint(
            ["campaign_id", "user_id"],
            ["content_automation_campaigns.id", "content_automation_campaigns.user_id"],
            name="fk_content_batch_scope",
        ),
        UniqueConstraint("campaign_id", "scheduled_date", name="uq_content_batch_date"),
        UniqueConstraint("id", "user_id", name="uq_content_batch_scope"),
        CheckConstraint(
            "status IN ('running', 'complete', 'partial', 'skipped')",
            name="ck_content_batch_status",
        ),
        CheckConstraint("attempts >= 0", name="ck_content_batch_attempts"),
    )

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=uuid_str)
    campaign_id: Mapped[str] = mapped_column(String(36), index=True)
    user_id: Mapped[str] = mapped_column(String(36), index=True)
    scheduled_date: Mapped[date] = mapped_column(Date)
    status: Mapped[str] = mapped_column(String(16), default="running")
    lease_token: Mapped[str | None] = mapped_column(String(36), nullable=True)
    lease_expires_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    attempts: Mapped[int] = mapped_column(Integer, default=0)
    report: Mapped[dict[str, Any]] = mapped_column(JSON, default=lambda: {"reasons": []})
    finished_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)


class ContentCandidate(Base, TimestampMixin):
    __tablename__ = "content_automation_candidates"
    __table_args__ = (
        ForeignKeyConstraint(
            ["batch_id", "user_id"],
            ["content_automation_batches.id", "content_automation_batches.user_id"],
            name="fk_content_candidate_scope",
        ),
        UniqueConstraint("batch_id", "kind", "slot", name="uq_content_candidate_slot"),
        UniqueConstraint("user_id", "kind", "source_hash", name="uq_content_candidate_source"),
        UniqueConstraint("user_id", "kind", "content_hash", name="uq_content_candidate_content"),
        CheckConstraint("slot BETWEEN 1 AND 5", name="ck_content_candidate_slot"),
        CheckConstraint("kind IN ('recipe', 'workout')", name="ck_content_candidate_kind"),
        CheckConstraint(
            "status IN ('pending', 'approved', 'dismissed')", name="ck_content_candidate_status"
        ),
        CheckConstraint(
            "(status = 'approved' AND ((kind = 'recipe' AND recipe_id IS NOT NULL "
            "AND workout_template_id IS NULL) OR (kind = 'workout' AND recipe_id IS NULL "
            "AND workout_template_id IS NOT NULL))) OR (status <> 'approved' "
            "AND recipe_id IS NULL AND workout_template_id IS NULL)",
            name="ck_content_candidate_result",
        ),
    )

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=uuid_str)
    batch_id: Mapped[str] = mapped_column(String(36), index=True)
    user_id: Mapped[str] = mapped_column(String(36), index=True)
    kind: Mapped[str] = mapped_column(String(16))
    slot: Mapped[int] = mapped_column(Integer)
    status: Mapped[str] = mapped_column(String(16), default="pending")
    title: Mapped[str] = mapped_column(String(240))
    payload: Mapped[dict[str, Any]] = mapped_column(JSON)
    source_url: Mapped[str] = mapped_column(Text)
    source_name: Mapped[str] = mapped_column(String(240))
    canonical_source_url: Mapped[str] = mapped_column(Text)
    source_hash: Mapped[str] = mapped_column(String(64))
    content_hash: Mapped[str] = mapped_column(String(64))
    provenance: Mapped[dict[str, Any]] = mapped_column(JSON)
    warnings: Mapped[list[str]] = mapped_column(JSON, default=list)
    recipe_id: Mapped[str | None] = mapped_column(ForeignKey("recipes.id"), nullable=True)
    workout_template_id: Mapped[str | None] = mapped_column(
        ForeignKey("workout_templates.id"), nullable=True
    )
    decided_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
