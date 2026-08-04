from __future__ import annotations

from datetime import date, datetime
from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, EmailStr, Field, HttpUrl


class ApiModel(BaseModel):
    model_config = ConfigDict(from_attributes=True)


class TokenPair(ApiModel):
    access_token: str
    refresh_token: str
    token_type: str = "bearer"


class RegisterRequest(ApiModel):
    email: EmailStr
    password: str = Field(min_length=8, max_length=128)


class LoginRequest(ApiModel):
    email: EmailStr
    password: str


class RefreshRequest(ApiModel):
    refresh_token: str


class LogoutRequest(ApiModel):
    refresh_token: str | None = None


class AuthStatus(ApiModel):
    email: EmailStr
    email_verified: bool
    smtp_configured: bool


class VerifyEmailRequest(ApiModel):
    token: str = Field(min_length=20, max_length=300)


class PasswordResetRequest(ApiModel):
    email: EmailStr


class PasswordResetConfirm(ApiModel):
    token: str = Field(min_length=20, max_length=300)
    password: str = Field(min_length=8, max_length=128)


class ChangePasswordRequest(ApiModel):
    current_password: str = Field(min_length=8, max_length=128)
    new_password: str = Field(min_length=8, max_length=128)


class AccountDeletionRequest(ApiModel):
    current_password: str = Field(min_length=8, max_length=128)
    confirmation: str = Field(pattern="^DELETE$")


class IngredientIn(ApiModel):
    original_text: str
    normalized_name: str | None = None
    quantity: float | None = None
    unit: str | None = None
    preparation_note: str | None = None
    is_optional: bool = False
    section: str | None = None
    sort_order: int = 0


class InstructionIn(ApiModel):
    step_number: int
    text: str
    section: str | None = None
    timer_minutes: int | None = None


class RecipeCreate(ApiModel):
    name: str = Field(min_length=2, max_length=240)
    description: str | None = None
    photo_url: str | None = None
    servings: int = Field(default=4, ge=1, le=30)
    prep_minutes: int | None = Field(default=None, ge=0, le=1440)
    cook_minutes: int | None = Field(default=None, ge=0, le=1440)
    total_minutes: int | None = Field(default=None, ge=0, le=1440)
    difficulty: str = "easy"
    tags: list[str] = Field(default_factory=list)
    cuisine: str | None = None
    meal_type: str = "dinner"
    source_type: str = "manual"
    source_url: str | None = None
    source_title: str | None = None
    ingredients: list[IngredientIn]
    instructions: list[InstructionIn]
    accept_placeholder_photo: bool = False


class RecipeOut(ApiModel):
    id: str
    name: str
    description: str | None
    photo_url: str | None
    servings: int
    prep_minutes: int | None
    cook_minutes: int | None
    total_minutes: int | None
    difficulty: str
    cuisine: str | None
    meal_type: str
    source_type: str
    source_url: str | None
    source_title: str | None
    validation_status: str
    validation_warnings: list[str]
    duplicate_status: str
    image_status: str
    created_at: datetime
    updated_at: datetime
    ingredients: list[IngredientIn] = Field(default_factory=list)
    instructions: list[InstructionIn] = Field(default_factory=list)
    tags: list[str] = Field(default_factory=list)
    is_favorite: bool = False
    is_hidden: bool = False
    last_selected_date: date | None = None


class SwipeRequest(ApiModel):
    recipe_id: str
    action: Literal["add", "skip", "favorite", "hide"]
    session_id: str


class WeeklySlotIn(ApiModel):
    slot_date: date | None = None
    slot_type: Literal["meal", "leftovers", "dining_out", "flexible"] = "meal"
    recipe_id: str | None = None
    servings: int = Field(default=4, ge=1, le=30)
    is_locked: bool = False
    sort_order: int = 0


class WeeklySlotUpdate(ApiModel):
    slot_date: date | None = None
    slot_type: Literal["meal", "leftovers", "dining_out", "flexible"] | None = None
    recipe_id: str | None = None
    servings: int | None = Field(default=None, ge=1, le=30)
    is_locked: bool | None = None
    sort_order: int | None = None


class WeeklyPlanOut(ApiModel):
    id: str
    week_start: date
    meal_target: int
    slots: list[dict[str, Any]]


class ProfileUpdate(ApiModel):
    household_size: int = Field(default=2, ge=1, le=20)
    weekly_meal_target: int = Field(default=5, ge=1, le=14)
    max_cook_minutes: int | None = None
    difficulty_preference: str | None = None
    dietary_preferences: list[str] = Field(default_factory=list)
    allergens: list[str] = Field(default_factory=list)
    disliked_ingredients: list[str] = Field(default_factory=list)
    favorite_proteins: list[str] = Field(default_factory=list)
    budget_preference: str | None = None
    walmart_zip: str | None = None
    notification_preferences: dict[str, Any] = Field(default_factory=dict)


class PantryItemIn(ApiModel):
    normalized_name: str
    category: str = "pantry"


class GroceryManualItemIn(ApiModel):
    display_name: str = Field(min_length=1, max_length=180)
    quantity: float | None = Field(default=None, ge=0, le=9999)
    unit: str | None = Field(default=None, max_length=32)
    category: str = Field(default="household", max_length=80)
    notes: str | None = Field(default=None, max_length=500)


class GroceryItemOut(ApiModel):
    id: str
    normalized_name: str
    display_name: str
    quantity: float | None
    unit: str | None
    category: str
    is_checked: bool
    walmart_search_url: str | None
    match_status: str
    notes: str | None


class ImportMappingRequest(ApiModel):
    mapping: dict[str, str | None]
    accept_missing_photo: bool = False
    save_template_name: str | None = None


class UrlIngestRequest(ApiModel):
    urls: list[HttpUrl]


class UrlApprovalRequest(ApiModel):
    accept_placeholder_photo: bool = False
    edits: RecipeCreate | None = None


class HouseholdOut(ApiModel):
    id: str
    name: str
    invite_code: str
    members: list[dict[str, str]]


class HouseholdJoinRequest(ApiModel):
    invite_code: str = Field(min_length=4, max_length=16)


class VoteRequest(ApiModel):
    recipe_id: str
    vote: Literal["yes", "no", "maybe"] = "yes"
