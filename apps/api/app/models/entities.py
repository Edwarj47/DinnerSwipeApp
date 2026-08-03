from __future__ import annotations

import uuid
from datetime import date, datetime

from sqlalchemy import (
    JSON,
    Boolean,
    Date,
    DateTime,
    Float,
    ForeignKey,
    Index,
    Integer,
    String,
    Text,
    UniqueConstraint,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.models.base import Base


def uuid_str() -> str:
    return str(uuid.uuid4())


class TimestampMixin:
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, nullable=False)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime, default=datetime.utcnow, onupdate=datetime.utcnow, nullable=False
    )


class User(Base, TimestampMixin):
    __tablename__ = "users"
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=uuid_str)
    email: Mapped[str] = mapped_column(String(320), unique=True, index=True, nullable=False)
    password_hash: Mapped[str] = mapped_column(String(255), nullable=False)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    profile: Mapped[UserProfile] = relationship(back_populates="user", uselist=False)


class Household(Base, TimestampMixin):
    __tablename__ = "households"
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=uuid_str)
    name: Mapped[str] = mapped_column(String(120), nullable=False)
    invite_code: Mapped[str | None] = mapped_column(String(16), unique=True, nullable=True)


class HouseholdMember(Base, TimestampMixin):
    __tablename__ = "household_members"
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=uuid_str)
    household_id: Mapped[str] = mapped_column(ForeignKey("households.id"), index=True)
    user_id: Mapped[str] = mapped_column(ForeignKey("users.id"), index=True)
    role: Mapped[str] = mapped_column(String(32), default="owner")
    __table_args__ = (UniqueConstraint("household_id", "user_id"),)


class UserProfile(Base, TimestampMixin):
    __tablename__ = "user_profiles"
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=uuid_str)
    user_id: Mapped[str] = mapped_column(ForeignKey("users.id"), unique=True, index=True)
    household_id: Mapped[str | None] = mapped_column(ForeignKey("households.id"), nullable=True)
    household_size: Mapped[int] = mapped_column(Integer, default=2)
    weekly_meal_target: Mapped[int] = mapped_column(Integer, default=5)
    max_cook_minutes: Mapped[int | None] = mapped_column(Integer, nullable=True)
    difficulty_preference: Mapped[str | None] = mapped_column(String(32), nullable=True)
    dietary_preferences: Mapped[list[str]] = mapped_column(JSON, default=list)
    allergens: Mapped[list[str]] = mapped_column(JSON, default=list)
    disliked_ingredients: Mapped[list[str]] = mapped_column(JSON, default=list)
    favorite_proteins: Mapped[list[str]] = mapped_column(JSON, default=list)
    budget_preference: Mapped[str | None] = mapped_column(String(32), nullable=True)
    walmart_zip: Mapped[str | None] = mapped_column(String(16), nullable=True)
    notification_preferences: Mapped[dict[str, object]] = mapped_column(JSON, default=dict)
    user: Mapped[User] = relationship(back_populates="profile")


class Recipe(Base, TimestampMixin):
    __tablename__ = "recipes"
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=uuid_str)
    owner_user_id: Mapped[str | None] = mapped_column(
        ForeignKey("users.id"), nullable=True, index=True
    )
    household_id: Mapped[str | None] = mapped_column(
        ForeignKey("households.id"), nullable=True, index=True
    )
    name: Mapped[str] = mapped_column(String(240), nullable=False, index=True)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    photo_url: Mapped[str | None] = mapped_column(Text, nullable=True)
    photo_source_url: Mapped[str | None] = mapped_column(Text, nullable=True)
    photo_attribution: Mapped[str | None] = mapped_column(Text, nullable=True)
    servings: Mapped[int] = mapped_column(Integer, default=4)
    prep_minutes: Mapped[int | None] = mapped_column(Integer, nullable=True)
    cook_minutes: Mapped[int | None] = mapped_column(Integer, nullable=True)
    total_minutes: Mapped[int | None] = mapped_column(Integer, nullable=True)
    difficulty: Mapped[str] = mapped_column(String(32), default="easy")
    cuisine: Mapped[str | None] = mapped_column(String(80), nullable=True)
    meal_type: Mapped[str] = mapped_column(String(64), default="dinner")
    source_type: Mapped[str] = mapped_column(String(64), default="manual", index=True)
    source_url: Mapped[str | None] = mapped_column(Text, nullable=True)
    source_title: Mapped[str | None] = mapped_column(Text, nullable=True)
    original_imported_row: Mapped[dict[str, object] | None] = mapped_column(JSON, nullable=True)
    import_batch_id: Mapped[str | None] = mapped_column(String(36), nullable=True, index=True)
    validation_status: Mapped[str] = mapped_column(String(32), default="approved", index=True)
    validation_warnings: Mapped[list[str]] = mapped_column(JSON, default=list)
    duplicate_status: Mapped[str] = mapped_column(String(32), default="new")
    archived_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    created_by: Mapped[str] = mapped_column(String(64), default="seed")
    ai_confidence: Mapped[dict[str, object] | None] = mapped_column(JSON, nullable=True)
    content_hash: Mapped[str] = mapped_column(String(64), index=True, nullable=False)
    image_status: Mapped[str] = mapped_column(String(32), default="pending")
    ingredients: Mapped[list[RecipeIngredient]] = relationship(
        cascade="all, delete-orphan", order_by="RecipeIngredient.sort_order"
    )
    instructions: Mapped[list[RecipeInstructionStep]] = relationship(
        cascade="all, delete-orphan", order_by="RecipeInstructionStep.step_number"
    )
    tags: Mapped[list[RecipeTag]] = relationship(cascade="all, delete-orphan")


class RecipeIngredient(Base, TimestampMixin):
    __tablename__ = "recipe_ingredients"
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=uuid_str)
    recipe_id: Mapped[str] = mapped_column(ForeignKey("recipes.id"), index=True)
    original_text: Mapped[str] = mapped_column(Text, nullable=False)
    normalized_name: Mapped[str] = mapped_column(String(180), nullable=False, index=True)
    quantity: Mapped[float | None] = mapped_column(Float, nullable=True)
    unit: Mapped[str | None] = mapped_column(String(32), nullable=True)
    preparation_note: Mapped[str | None] = mapped_column(String(255), nullable=True)
    is_optional: Mapped[bool] = mapped_column(Boolean, default=False)
    section: Mapped[str | None] = mapped_column(String(120), nullable=True)
    sort_order: Mapped[int] = mapped_column(Integer, default=0)


class RecipeInstructionStep(Base, TimestampMixin):
    __tablename__ = "recipe_instruction_steps"
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=uuid_str)
    recipe_id: Mapped[str] = mapped_column(ForeignKey("recipes.id"), index=True)
    step_number: Mapped[int] = mapped_column(Integer, nullable=False)
    text: Mapped[str] = mapped_column(Text, nullable=False)
    section: Mapped[str | None] = mapped_column(String(120), nullable=True)
    timer_minutes: Mapped[int | None] = mapped_column(Integer, nullable=True)


class RecipeTag(Base, TimestampMixin):
    __tablename__ = "recipe_tags"
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=uuid_str)
    recipe_id: Mapped[str] = mapped_column(ForeignKey("recipes.id"), index=True)
    tag: Mapped[str] = mapped_column(String(80), index=True)
    __table_args__ = (UniqueConstraint("recipe_id", "tag"),)


class RecipePhoto(Base, TimestampMixin):
    __tablename__ = "recipe_photos"
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=uuid_str)
    recipe_id: Mapped[str] = mapped_column(ForeignKey("recipes.id"), index=True)
    url: Mapped[str] = mapped_column(Text, nullable=False)
    source_url: Mapped[str | None] = mapped_column(Text, nullable=True)
    attribution: Mapped[str | None] = mapped_column(Text, nullable=True)
    status: Mapped[str] = mapped_column(String(32), default="pending")


class RecipeSource(Base, TimestampMixin):
    __tablename__ = "recipe_sources"
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=uuid_str)
    recipe_id: Mapped[str] = mapped_column(ForeignKey("recipes.id"), index=True)
    source_type: Mapped[str] = mapped_column(String(64), nullable=False)
    source_url: Mapped[str | None] = mapped_column(Text, nullable=True)
    source_title: Mapped[str | None] = mapped_column(Text, nullable=True)
    provenance: Mapped[dict[str, object]] = mapped_column(JSON, default=dict)


class RecipeVersion(Base, TimestampMixin):
    __tablename__ = "recipe_versions"
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=uuid_str)
    recipe_id: Mapped[str] = mapped_column(ForeignKey("recipes.id"), index=True)
    version_number: Mapped[int] = mapped_column(Integer, nullable=False)
    snapshot: Mapped[dict[str, object]] = mapped_column(JSON, nullable=False)


class WeeklyPlan(Base, TimestampMixin):
    __tablename__ = "weekly_plans"
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=uuid_str)
    user_id: Mapped[str] = mapped_column(ForeignKey("users.id"), index=True)
    week_start: Mapped[date] = mapped_column(Date, index=True)
    meal_target: Mapped[int] = mapped_column(Integer, default=5)
    __table_args__ = (UniqueConstraint("user_id", "week_start"),)


class WeeklyPlanSlot(Base, TimestampMixin):
    __tablename__ = "weekly_plan_slots"
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=uuid_str)
    weekly_plan_id: Mapped[str] = mapped_column(ForeignKey("weekly_plans.id"), index=True)
    slot_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    slot_type: Mapped[str] = mapped_column(String(32), default="meal")
    recipe_id: Mapped[str | None] = mapped_column(ForeignKey("recipes.id"), nullable=True)
    servings: Mapped[int] = mapped_column(Integer, default=4)
    is_locked: Mapped[bool] = mapped_column(Boolean, default=False)
    sort_order: Mapped[int] = mapped_column(Integer, default=0)


class MealSwipe(Base, TimestampMixin):
    __tablename__ = "meal_swipes"
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=uuid_str)
    user_id: Mapped[str] = mapped_column(ForeignKey("users.id"), index=True)
    recipe_id: Mapped[str] = mapped_column(ForeignKey("recipes.id"), index=True)
    action: Mapped[str] = mapped_column(String(32), nullable=False)
    session_id: Mapped[str] = mapped_column(String(36), index=True)


class WeeklyPlanVote(Base, TimestampMixin):
    __tablename__ = "weekly_plan_votes"
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=uuid_str)
    weekly_plan_id: Mapped[str] = mapped_column(ForeignKey("weekly_plans.id"), index=True)
    user_id: Mapped[str] = mapped_column(ForeignKey("users.id"), index=True)
    recipe_id: Mapped[str] = mapped_column(ForeignKey("recipes.id"), index=True)
    vote: Mapped[str] = mapped_column(String(16), default="yes")
    __table_args__ = (UniqueConstraint("weekly_plan_id", "user_id", "recipe_id"),)


class Favorite(Base, TimestampMixin):
    __tablename__ = "favorites"
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=uuid_str)
    user_id: Mapped[str] = mapped_column(ForeignKey("users.id"), index=True)
    recipe_id: Mapped[str] = mapped_column(ForeignKey("recipes.id"), index=True)
    __table_args__ = (UniqueConstraint("user_id", "recipe_id"),)


class HiddenRecipe(Base, TimestampMixin):
    __tablename__ = "hidden_recipes"
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=uuid_str)
    user_id: Mapped[str] = mapped_column(ForeignKey("users.id"), index=True)
    recipe_id: Mapped[str] = mapped_column(ForeignKey("recipes.id"), index=True)
    __table_args__ = (UniqueConstraint("user_id", "recipe_id"),)


class PantryItem(Base, TimestampMixin):
    __tablename__ = "pantry_items"
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=uuid_str)
    user_id: Mapped[str] = mapped_column(ForeignKey("users.id"), index=True)
    normalized_name: Mapped[str] = mapped_column(String(180), nullable=False)
    category: Mapped[str] = mapped_column(String(80), default="pantry")
    __table_args__ = (UniqueConstraint("user_id", "normalized_name"),)


class GroceryList(Base, TimestampMixin):
    __tablename__ = "grocery_lists"
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=uuid_str)
    user_id: Mapped[str] = mapped_column(ForeignKey("users.id"), index=True)
    weekly_plan_id: Mapped[str] = mapped_column(ForeignKey("weekly_plans.id"), index=True)


class GroceryListItem(Base, TimestampMixin):
    __tablename__ = "grocery_list_items"
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=uuid_str)
    grocery_list_id: Mapped[str] = mapped_column(ForeignKey("grocery_lists.id"), index=True)
    normalized_name: Mapped[str] = mapped_column(String(180), nullable=False)
    display_name: Mapped[str] = mapped_column(String(180), nullable=False)
    quantity: Mapped[float | None] = mapped_column(Float, nullable=True)
    unit: Mapped[str | None] = mapped_column(String(32), nullable=True)
    category: Mapped[str] = mapped_column(String(80), default="uncategorized")
    is_checked: Mapped[bool] = mapped_column(Boolean, default=False)
    walmart_search_url: Mapped[str | None] = mapped_column(Text, nullable=True)
    match_status: Mapped[str] = mapped_column(String(32), default="unmatched")
    notes: Mapped[str | None] = mapped_column(Text, nullable=True)


class RetailerProductPreference(Base, TimestampMixin):
    __tablename__ = "retailer_product_preferences"
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=uuid_str)
    user_id: Mapped[str] = mapped_column(ForeignKey("users.id"), index=True)
    normalized_name: Mapped[str] = mapped_column(String(180), nullable=False)
    retailer: Mapped[str] = mapped_column(String(64), nullable=False)
    product_id: Mapped[str | None] = mapped_column(String(120), nullable=True)
    product_url: Mapped[str | None] = mapped_column(Text, nullable=True)


class ImportBatch(Base, TimestampMixin):
    __tablename__ = "import_batches"
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=uuid_str)
    user_id: Mapped[str] = mapped_column(ForeignKey("users.id"), index=True)
    status: Mapped[str] = mapped_column(String(32), default="file_uploaded")
    source_type: Mapped[str] = mapped_column(String(16), nullable=False)
    summary: Mapped[dict[str, object]] = mapped_column(JSON, default=dict)


class ImportFile(Base, TimestampMixin):
    __tablename__ = "import_files"
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=uuid_str)
    import_batch_id: Mapped[str] = mapped_column(ForeignKey("import_batches.id"), index=True)
    original_filename: Mapped[str] = mapped_column(String(255), nullable=False)
    content_type: Mapped[str] = mapped_column(String(120), nullable=False)
    size_bytes: Mapped[int] = mapped_column(Integer, nullable=False)
    stored_path: Mapped[str] = mapped_column(Text, nullable=False)
    headers: Mapped[list[str]] = mapped_column(JSON, default=list)


class ImportMappingTemplate(Base, TimestampMixin):
    __tablename__ = "import_mapping_templates"
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=uuid_str)
    user_id: Mapped[str] = mapped_column(ForeignKey("users.id"), index=True)
    name: Mapped[str] = mapped_column(String(120), nullable=False)
    mapping: Mapped[dict[str, str]] = mapped_column(JSON, nullable=False)


class ImportRow(Base, TimestampMixin):
    __tablename__ = "import_rows"
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=uuid_str)
    import_batch_id: Mapped[str] = mapped_column(ForeignKey("import_batches.id"), index=True)
    row_number: Mapped[int] = mapped_column(Integer, nullable=False)
    raw_data: Mapped[dict[str, object]] = mapped_column(JSON, nullable=False)
    normalized_data: Mapped[dict[str, object] | None] = mapped_column(JSON, nullable=True)
    status: Mapped[str] = mapped_column(String(32), default="parsed")
    duplicate_status: Mapped[str] = mapped_column(String(32), default="new")
    warnings: Mapped[list[str]] = mapped_column(JSON, default=list)
    committed_recipe_id: Mapped[str | None] = mapped_column(String(36), nullable=True)


class ImportRowError(Base, TimestampMixin):
    __tablename__ = "import_row_errors"
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=uuid_str)
    import_row_id: Mapped[str] = mapped_column(ForeignKey("import_rows.id"), index=True)
    field: Mapped[str] = mapped_column(String(80), nullable=False)
    message: Mapped[str] = mapped_column(Text, nullable=False)
    severity: Mapped[str] = mapped_column(String(16), default="error")


class IngestionJob(Base, TimestampMixin):
    __tablename__ = "ingestion_jobs"
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=uuid_str)
    user_id: Mapped[str] = mapped_column(ForeignKey("users.id"), index=True)
    job_type: Mapped[str] = mapped_column(String(64), nullable=False)
    status: Mapped[str] = mapped_column(String(32), default="queued", index=True)
    progress: Mapped[dict[str, object]] = mapped_column(JSON, default=dict)
    error_message: Mapped[str | None] = mapped_column(Text, nullable=True)
    idempotency_key: Mapped[str | None] = mapped_column(String(120), nullable=True, index=True)


class UrlIngestionCandidate(Base, TimestampMixin):
    __tablename__ = "url_ingestion_candidates"
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=uuid_str)
    user_id: Mapped[str] = mapped_column(ForeignKey("users.id"), index=True)
    job_id: Mapped[str | None] = mapped_column(ForeignKey("ingestion_jobs.id"), nullable=True)
    source_url: Mapped[str] = mapped_column(Text, nullable=False)
    extracted_data: Mapped[dict[str, object]] = mapped_column(JSON, default=dict)
    raw_snapshot: Mapped[dict[str, object]] = mapped_column(JSON, default=dict)
    confidence: Mapped[dict[str, object]] = mapped_column(JSON, default=dict)
    status: Mapped[str] = mapped_column(String(32), default="requires_review")
    validation_warnings: Mapped[list[str]] = mapped_column(JSON, default=list)
    approved_recipe_id: Mapped[str | None] = mapped_column(String(36), nullable=True)


class ValidationResult(Base, TimestampMixin):
    __tablename__ = "validation_results"
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=uuid_str)
    entity_type: Mapped[str] = mapped_column(String(64), nullable=False)
    entity_id: Mapped[str] = mapped_column(String(36), nullable=False, index=True)
    errors: Mapped[list[str]] = mapped_column(JSON, default=list)
    warnings: Mapped[list[str]] = mapped_column(JSON, default=list)
    can_approve: Mapped[bool] = mapped_column(Boolean, default=False)


class AuditEvent(Base, TimestampMixin):
    __tablename__ = "audit_events"
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=uuid_str)
    user_id: Mapped[str | None] = mapped_column(ForeignKey("users.id"), nullable=True, index=True)
    event_type: Mapped[str] = mapped_column(String(80), nullable=False, index=True)
    entity_type: Mapped[str | None] = mapped_column(String(64), nullable=True)
    entity_id: Mapped[str | None] = mapped_column(String(36), nullable=True)
    payload: Mapped[dict[str, object]] = mapped_column(JSON, default=dict)


Index("ix_recipes_owner_status", Recipe.owner_user_id, Recipe.validation_status, Recipe.archived_at)
