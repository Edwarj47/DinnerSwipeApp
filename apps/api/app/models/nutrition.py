from __future__ import annotations

from datetime import date, datetime

from sqlalchemy import (
    JSON,
    CheckConstraint,
    Date,
    DateTime,
    Float,
    ForeignKey,
    ForeignKeyConstraint,
    Index,
    Integer,
    String,
)
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base
from app.models.entities import uuid_str


class NutritionFood(Base):
    __tablename__ = "nutrition_food_identifiers"
    food_id: Mapped[str] = mapped_column(String(20), primary_key=True)
    first_seen_at: Mapped[datetime] = mapped_column(DateTime, nullable=False)
    last_seen_at: Mapped[datetime] = mapped_column(DateTime, nullable=False)
    last_refreshed_at: Mapped[datetime | None] = mapped_column(DateTime, index=True)


class NutritionServing(Base):
    __tablename__ = "nutrition_serving_identifiers"
    food_id: Mapped[str] = mapped_column(ForeignKey(NutritionFood.food_id), primary_key=True)
    serving_id: Mapped[str] = mapped_column(String(20), primary_key=True)


class NutritionUsage(Base):
    __tablename__ = "nutrition_food_usage"
    __table_args__ = (
        ForeignKeyConstraint(
            ["food_id", "serving_id"],
            ["nutrition_serving_identifiers.food_id", "nutrition_serving_identifiers.serving_id"],
        ),
    )
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=uuid_str)
    user_id: Mapped[str] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    food_id: Mapped[str] = mapped_column(String(20), index=True)
    serving_id: Mapped[str] = mapped_column(String(20))
    portions: Mapped[float] = mapped_column(Float)
    used_at: Mapped[datetime] = mapped_column(DateTime, index=True)
    request_id: Mapped[str] = mapped_column(String(36), unique=True)


class NutritionProviderState(Base):
    __tablename__ = "nutrition_provider_state"
    provider: Mapped[str] = mapped_column(String(30), primary_key=True)
    next_request_at: Mapped[datetime | None] = mapped_column(DateTime)
    blocked_until: Mapped[datetime | None] = mapped_column(DateTime)
    block_reason: Mapped[str | None] = mapped_column(String(40))


class NutritionCall(Base):
    __tablename__ = "nutrition_api_calls"
    __table_args__ = (Index("ix_nutrition_calls_background_time", "background", "reserved_at"),)
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=uuid_str)
    reserved_at: Mapped[datetime] = mapped_column(DateTime, index=True)
    background: Mapped[int] = mapped_column(Integer)
    kind: Mapped[str] = mapped_column(String(20))
    outcome: Mapped[str] = mapped_column(String(30), default="reserved")
    user_id: Mapped[str | None] = mapped_column(String(36), nullable=True)


class NutritionRefreshRun(Base):
    __tablename__ = "nutrition_refresh_runs"
    run_date: Mapped[date] = mapped_column(Date, primary_key=True)
    lease_token: Mapped[str] = mapped_column(String(36))
    lease_until: Mapped[datetime] = mapped_column(DateTime)
    started_at: Mapped[datetime] = mapped_column(DateTime)
    finished_at: Mapped[datetime | None] = mapped_column(DateTime)
    status: Mapped[str] = mapped_column(String(30))
    refreshed: Mapped[int] = mapped_column(Integer, default=0)
    error_code: Mapped[str | None] = mapped_column(String(40))


class NutritionCalculation(Base):
    __tablename__ = "nutrition_calculations"
    __table_args__ = (
        CheckConstraint(
            "(recipe_id IS NULL AND entry_id IS NOT NULL) OR "
            "(recipe_id IS NOT NULL AND entry_id IS NULL)",
            name="nutrition_calculation_one_target",
        ),
    )
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=uuid_str)
    user_id: Mapped[str] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    recipe_id: Mapped[str | None] = mapped_column(
        ForeignKey("recipes.id", ondelete="CASCADE"), unique=True
    )
    entry_id: Mapped[str | None] = mapped_column(
        ForeignKey("meal_macro_confirmations.id", ondelete="CASCADE"), unique=True
    )
    servings: Mapped[float] = mapped_column(Float, default=1)
    # Provider items contain IDs/portions and user labels, never copied nutrition.
    items: Mapped[list[dict[str, object]]] = mapped_column(JSON, nullable=False)
    request_id: Mapped[str] = mapped_column(String(36), unique=True)
    request_hash: Mapped[str] = mapped_column(String(64), default="")
