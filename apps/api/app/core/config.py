from __future__ import annotations

from functools import lru_cache

from pydantic import Field, field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


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
    ai_ingestion_enabled: bool = False
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
    email_from: str = "DSAsupport@dcss.dev"
    email_from_name: str = "Dinner Swipe"
    email_smtp_host: str = ""
    email_smtp_port: int = 587
    email_smtp_username: str = ""
    email_smtp_password: str = ""
    email_smtp_use_tls: bool = True
    email_smtp_use_ssl: bool = False
    email_token_minutes: int = 60
    password_reset_token_minutes: int = 30

    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    @field_validator("jwt_secret")
    @classmethod
    def require_real_secret_in_prod(cls, value: str, info: object) -> str:
        return value

    @property
    def allowed_origin_list(self) -> list[str]:
        return [origin.strip() for origin in self.allowed_origins.split(",") if origin.strip()]

    @property
    def smtp_configured(self) -> bool:
        return bool(self.email_smtp_host and self.email_smtp_username and self.email_smtp_password)


@lru_cache
def get_settings() -> Settings:
    loaded = Settings()
    if loaded.app_env == "production" and loaded.jwt_secret == "development-only-change-me":
        raise RuntimeError("JWT_SECRET must be changed in production")
    return loaded


settings = get_settings()
