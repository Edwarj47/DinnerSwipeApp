from __future__ import annotations

from functools import lru_cache
from typing import Literal

from pydantic import BaseModel, Field, SecretStr, field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


class AccessCoupon(BaseModel):
    tier: Literal["basic", "premium"]
    months: int | None = Field(default=None, ge=1, le=36)


class Settings(BaseSettings):
    app_env: str = "development"
    app_public_url: str = "http://127.0.0.1:19006"
    public_api_url: str = "http://127.0.0.1:8108"
    database_url: str = "sqlite:///./dinner_swipe_dev.db"
    jwt_secret: str = Field(default="development-only-change-me", min_length=16)
    access_token_minutes: int = 30
    refresh_token_days: int = 30
    openai_api_key: str = ""
    openai_model: str = "gpt-5-mini"
    openai_fallback_models: str = "gpt-4.1-mini"
    ai_ingestion_enabled: bool = False
    ai_recipe_enabled: bool = False
    ai_recipe_model: str = "gpt-5.4-mini"
    max_upload_size_bytes: int = 10_485_760
    max_import_rows: int = 2_000
    max_cell_length: int = 10_000
    max_url_response_size_bytes: int = 2_097_152
    image_storage_path: str = "./media"
    max_image_upload_size_bytes: int = 5_242_880
    media_storage_backend: str = "local"
    media_public_base_url: str = ""
    azure_storage_connection_string: str = ""
    azure_storage_container: str = ""
    allowed_origins: str = "http://127.0.0.1:19006,http://localhost:19006"
    email_from: str = "dinnerswipe@dcss.dev"
    email_from_name: str = "Dinner Swipe"
    email_smtp_host: str = ""
    email_smtp_port: int = 587
    email_smtp_username: str = ""
    email_smtp_password: str = ""
    email_smtp_use_tls: bool = True
    email_smtp_use_ssl: bool = False
    email_token_minutes: int = 60
    password_reset_token_minutes: int = 30
    stripe_enabled: bool = False
    stripe_secret_key: str = ""
    stripe_webhook_secret: str = ""
    stripe_basic_price_id: str = ""
    stripe_premium_price_id: str = ""
    stripe_portal_configuration_id: str = ""
    stripe_expected_account_id: str = ""
    stripe_api_version: str = "2026-08-26.dahlia"
    basic_monthly_price_cents: int = 599
    basic_free_trial_days: int = 30
    premium_monthly_price_cents: int = 999
    basic_waiver_codes: str = ""
    premium_waiver_codes: str = ""
    access_coupon_grants: dict[str, AccessCoupon] = Field(default_factory=dict)
    fatsecret_enabled: bool = False
    fatsecret_client_id: SecretStr = SecretStr("")
    fatsecret_client_secret: SecretStr = SecretStr("")
    fatsecret_daily_budget: int = Field(default=1000, ge=1, le=4000)
    fatsecret_background_budget: int = Field(default=100, ge=0, le=500)
    fatsecret_min_interval_seconds: float = Field(default=1, ge=0.5, le=60)
    fatsecret_cache_seconds: int = Field(default=82800, ge=1, le=82800)
    fatsecret_refresh_enabled: bool = False

    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    @field_validator("jwt_secret")
    @classmethod
    def require_real_secret_in_prod(cls, value: str, info: object) -> str:
        return value

    @property
    def allowed_origin_list(self) -> list[str]:
        return [origin.strip() for origin in self.allowed_origins.split(",") if origin.strip()]

    @property
    def fatsecret_configured(self) -> bool:
        return bool(
            self.fatsecret_enabled
            and self.fatsecret_client_id.get_secret_value()
            and self.fatsecret_client_secret.get_secret_value()
        )

    @property
    def smtp_configured(self) -> bool:
        return bool(self.email_smtp_host and self.email_smtp_username and self.email_smtp_password)

    @property
    def stripe_configured(self) -> bool:
        return bool(
            self.stripe_enabled
            and self.stripe_secret_key
            and self.stripe_webhook_secret
            and (self.stripe_basic_price_id or self.stripe_premium_price_id)
        )

    @property
    def stripe_basic_configured(self) -> bool:
        return bool(
            self.stripe_enabled
            and self.stripe_secret_key
            and self.stripe_webhook_secret
            and self.stripe_basic_price_id
        )

    @property
    def stripe_premium_configured(self) -> bool:
        return bool(
            self.stripe_enabled
            and self.stripe_secret_key
            and self.stripe_webhook_secret
            and self.stripe_premium_price_id
        )

    def stripe_price_id_for_tier(self, tier: str) -> str:
        if tier == "basic":
            return self.stripe_basic_price_id
        if tier == "premium":
            return self.stripe_premium_price_id
        return ""

    def stripe_configured_for_tier(self, tier: str) -> bool:
        if tier == "basic":
            return self.stripe_basic_configured
        if tier == "premium":
            return self.stripe_premium_configured
        return False

    @property
    def basic_waiver_code_list(self) -> list[str]:
        return [
            code.strip().lower()
            for code in self.basic_waiver_codes.split(",")
            if code.strip()
        ]

    @property
    def premium_waiver_code_list(self) -> list[str]:
        return [
            code.strip().lower()
            for code in self.premium_waiver_codes.split(",")
            if code.strip()
        ]


@lru_cache
def get_settings() -> Settings:
    loaded = Settings()
    if loaded.app_env == "production" and loaded.jwt_secret == "development-only-change-me":
        raise RuntimeError("JWT_SECRET must be changed in production")
    return loaded


settings = get_settings()
