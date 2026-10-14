from __future__ import annotations

from datetime import date
from typing import Any

from sqlalchemy import (
    JSON,
    Boolean,
    CheckConstraint,
    Date,
    ForeignKey,
    Integer,
    String,
    Text,
    UniqueConstraint,
    false,
)
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base
from app.models.entities import TimestampMixin, uuid_str


class WorkoutTemplate(Base, TimestampMixin):
    __tablename__ = "workout_templates"
    __table_args__ = (
        CheckConstraint(
            "category IN ('upper', 'lower', 'cardio', 'full_body')",
            name="ck_workout_template_category",
        ),
    )
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=uuid_str)
    owner_id: Mapped[str] = mapped_column(ForeignKey("users.id"), index=True)
    title: Mapped[str] = mapped_column(String(160))
    category: Mapped[str] = mapped_column(String(16))
    photo_url: Mapped[str | None] = mapped_column(String(2048), nullable=True)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    exercises: Mapped[list[dict[str, Any]]] = mapped_column(JSON)


class WorkoutTemplateShare(Base, TimestampMixin):
    __tablename__ = "workout_template_shares"
    __table_args__ = (UniqueConstraint("household_id", "template_id"),)
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=uuid_str)
    household_id: Mapped[str] = mapped_column(ForeignKey("households.id"), index=True)
    template_id: Mapped[str] = mapped_column(ForeignKey("workout_templates.id"), index=True)
    discover_enabled: Mapped[bool] = mapped_column(Boolean, default=False, server_default=false())
    snapshot: Mapped[dict[str, Any]] = mapped_column(JSON)


class WorkoutPlanningPreference(Base, TimestampMixin):
    __tablename__ = "workout_planning_preferences"
    __table_args__ = (
        UniqueConstraint("user_id"),
        UniqueConstraint("household_id"),
        CheckConstraint(
            "(user_id IS NULL) <> (household_id IS NULL)", name="ck_workout_preference_scope"
        ),
        CheckConstraint("mode IN ('manual', 'automatic')", name="ck_workout_preference_mode"),
        CheckConstraint("reset_day BETWEEN 0 AND 6", name="ck_workout_preference_reset_day"),
    )
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=uuid_str)
    user_id: Mapped[str | None] = mapped_column(ForeignKey("users.id"), nullable=True, index=True)
    household_id: Mapped[str | None] = mapped_column(
        ForeignKey("households.id"), nullable=True, index=True
    )
    mode: Mapped[str] = mapped_column(String(16), default="manual")
    reset_day: Mapped[int] = mapped_column(Integer, default=0)
    notify: Mapped[bool] = mapped_column(Boolean, default=True)
    time_zone: Mapped[str] = mapped_column(String(80))
    cursor: Mapped[date | None] = mapped_column(Date, nullable=True)


class WorkoutPlan(Base, TimestampMixin):
    __tablename__ = "workout_plans"
    __table_args__ = (
        UniqueConstraint("user_id", "week_start"),
        UniqueConstraint("household_id", "week_start"),
        CheckConstraint(
            "(user_id IS NULL) <> (household_id IS NULL)", name="ck_workout_plan_scope"
        ),
    )
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=uuid_str)
    user_id: Mapped[str | None] = mapped_column(ForeignKey("users.id"), index=True, nullable=True)
    household_id: Mapped[str | None] = mapped_column(
        ForeignKey("households.id"), index=True, nullable=True
    )
    week_start: Mapped[date] = mapped_column(Date)


class WorkoutPlanSlot(Base, TimestampMixin):
    __tablename__ = "workout_plan_slots"
    __table_args__ = (CheckConstraint("sort_order >= 0", name="ck_workout_slot_order"),)
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=uuid_str)
    plan_id: Mapped[str] = mapped_column(ForeignKey("workout_plans.id"), index=True)
    template_id: Mapped[str] = mapped_column(ForeignKey("workout_templates.id"), index=True)
    slot_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    sort_order: Mapped[int] = mapped_column(Integer)
    snapshot: Mapped[dict[str, Any]] = mapped_column(JSON)


class WorkoutProposal(Base, TimestampMixin):
    __tablename__ = "workout_proposals"
    __table_args__ = (
        UniqueConstraint("household_id", "week_start", "template_id"),
        CheckConstraint(
            "status IN ('pending', 'approved', 'rejected')", name="ck_workout_proposal_status"
        ),
    )
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=uuid_str)
    household_id: Mapped[str] = mapped_column(ForeignKey("households.id"), index=True)
    template_id: Mapped[str] = mapped_column(ForeignKey("workout_templates.id"), index=True)
    week_start: Mapped[date] = mapped_column(Date)
    status: Mapped[str] = mapped_column(String(16), default="pending")
    snapshot: Mapped[dict[str, Any]] = mapped_column(JSON)
    planned_slot_id: Mapped[str | None] = mapped_column(
        ForeignKey("workout_plan_slots.id", ondelete="SET NULL"), nullable=True
    )


class WorkoutProposalMember(Base, TimestampMixin):
    __tablename__ = "workout_proposal_members"
    __table_args__ = (UniqueConstraint("proposal_id", "user_id"),)
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=uuid_str)
    proposal_id: Mapped[str] = mapped_column(ForeignKey("workout_proposals.id"), index=True)
    user_id: Mapped[str] = mapped_column(ForeignKey("users.id"), index=True)


class WorkoutLog(Base, TimestampMixin):
    __tablename__ = "workout_logs"
    __table_args__ = (UniqueConstraint("user_id", "request_uuid"),)
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=uuid_str)
    user_id: Mapped[str] = mapped_column(ForeignKey("users.id"), index=True)
    request_uuid: Mapped[str] = mapped_column(String(36))
    template_id: Mapped[str] = mapped_column(ForeignKey("workout_templates.id"), index=True)
    performed_on: Mapped[date] = mapped_column(Date, index=True)
    completed: Mapped[bool] = mapped_column(Boolean, default=False)
    notes: Mapped[str | None] = mapped_column(Text, nullable=True)
    sets: Mapped[list[dict[str, Any]]] = mapped_column(JSON)
    exercise_details: Mapped[list[dict[str, Any]]] = mapped_column(JSON, default=list)
    snapshot: Mapped[dict[str, Any]] = mapped_column(JSON)
