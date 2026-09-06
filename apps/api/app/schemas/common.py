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
    terms_accepted: bool = False
    privacy_accepted: bool = False
    legal_document_version: str = Field(default="2026-08-03", min_length=1, max_length=40)


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


class SubscriptionPlanStatus(ApiModel):
    tier: Literal["basic", "premium"]
    plan_key: str
    display_name: str
    description: str
    monthly_price_cents: int
    stripe_configured: bool
    active: bool


class PremiumStatus(ApiModel):
    active: bool
    plan_key: str = "macro_tracker_monthly"
    status: str = "inactive"
    source: str | None = None
    monthly_price_cents: int = 999
    stripe_configured: bool = False
    billing_management_available: bool = False
    current_period_end: datetime | None = None
    cancel_at_period_end: bool = False
    current_tier: Literal["none", "trial", "basic", "premium"] = "none"
    basic_active: bool = False
    basic_subscription_active: bool = False
    premium_active: bool = False
    trial_active: bool = False
    trial_ends_at: datetime | None = None
    trial_days_remaining: int = 0
    basic_monthly_price_cents: int = 599
    premium_monthly_price_cents: int = 999
    basic_stripe_configured: bool = False
    premium_stripe_configured: bool = False
    plans: list[SubscriptionPlanStatus] = Field(default_factory=list)


class PremiumWaiverRequest(ApiModel):
    code: str = Field(min_length=3, max_length=80)


class SubscriptionCheckoutRequest(ApiModel):
    tier: Literal["basic", "premium"] = "premium"


class CheckoutSessionOut(ApiModel):
    checkout_url: str


class BillingPortalSessionOut(ApiModel):
    portal_url: str


class MacroTargetIn(ApiModel):
    daily_calories: int | None = Field(default=None, ge=0, le=20000)
    daily_protein_g: float | None = Field(default=None, ge=0, le=1000)
    daily_carbs_g: float | None = Field(default=None, ge=0, le=2000)
    daily_fat_g: float | None = Field(default=None, ge=0, le=1000)
    goal: str | None = Field(default=None, max_length=80)


class MacroTargetOut(MacroTargetIn):
    id: str | None = None


class MealMacroConfirmationIn(ApiModel):
    recipe_id: str | None = None
    weekly_plan_slot_id: str | None = None
    meal_date: date | None = None
    status: Literal["ate", "skipped"] = "ate"
    servings_consumed: float = Field(default=1, ge=0, le=20)
    calories: float | None = Field(default=None, ge=0, le=20000)
    protein_g: float | None = Field(default=None, ge=0, le=1000)
    carbs_g: float | None = Field(default=None, ge=0, le=2000)
    fat_g: float | None = Field(default=None, ge=0, le=1000)
    fiber_g: float | None = Field(default=None, ge=0, le=500)
    notes: str | None = Field(default=None, max_length=500)


class MealMacroConfirmationOut(ApiModel):
    id: str
    recipe_id: str | None
    recipe_name: str | None
    weekly_plan_slot_id: str | None
    meal_date: date
    status: str
    servings_consumed: float
    calories: float | None
    protein_g: float | None
    carbs_g: float | None
    fat_g: float | None
    fiber_g: float | None
    macro_source: str
    notes: str | None
    created_at: datetime


class MacroSummary(ApiModel):
    days: int
    start_date: date
    end_date: date
    active: bool
    targets: MacroTargetOut
    totals: dict[str, float]
    eaten_meals: int
    skipped_meals: int
    unmatched_meals: int
    recent_confirmations: list[MealMacroConfirmationOut]


class OnboardingUpdate(ApiModel):
    action: Literal["complete_onboarding", "complete_tutorial", "dismiss_tutorial"]
    tutorial_version: str = Field(default="2026-08-09", min_length=1, max_length=40)


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


GroceryRetailer = Literal["walmart", "publix", "kroger", "instacart"]


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
    preferred_grocery_retailer: GroceryRetailer = "walmart"
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
    retailer_name: str
    retailer_display_name: str
    retailer_search_url: str | None
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
    allergen_filter_mode: Literal["off", "warn", "block"] = "warn"
    dislike_filter_mode: Literal["off", "warn", "block"] = "warn"
    current_user_role: str
    members: list[dict[str, str]]


class HouseholdJoinRequest(ApiModel):
    invite_code: str = Field(min_length=4, max_length=16)


class HouseholdSettingsUpdate(ApiModel):
    allergen_filter_mode: Literal["off", "warn", "block"]
    dislike_filter_mode: Literal["off", "warn", "block"]


class HouseholdOwnerTransferRequest(ApiModel):
    user_id: str = Field(min_length=1, max_length=36)


class HouseholdVoteOptionOut(ApiModel):
    recipe: RecipeOut
    is_blocked: bool
    warning_labels: list[str] = Field(default_factory=list)
    blocked_labels: list[str] = Field(default_factory=list)
    safety_notes: list[str] = Field(default_factory=list)


class VoteRequest(ApiModel):
    recipe_id: str
    vote: Literal["yes", "no", "maybe"] = "yes"
