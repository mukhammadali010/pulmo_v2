from functools import lru_cache
from typing import Literal

from pydantic import Field, field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    env: Literal["development", "production", "test"] = "development"

    database_url: str = Field(
        default="postgresql+asyncpg://pulmoai:pulmoai@localhost:5432/pulmoai_dev"
    )

    @field_validator("database_url", mode="after")
    @classmethod
    def _coerce_async_driver(cls, value: str) -> str:
        # Managed providers (Railway, Heroku, Render) typically expose
        # `postgresql://` and `postgres://` URLs. SQLAlchemy with asyncpg
        # needs an explicit driver — coerce so the user can paste the URL
        # as-is from the provider's dashboard.
        if value.startswith("postgresql+asyncpg://"):
            return value
        if value.startswith("postgresql://"):
            return "postgresql+asyncpg://" + value[len("postgresql://") :]
        if value.startswith("postgres://"):
            return "postgresql+asyncpg://" + value[len("postgres://") :]
        return value

    jwt_secret: str = Field(default="change-me")
    jwt_algorithm: str = "HS256"
    access_token_expire_minutes: int = 30
    refresh_token_expire_days: int = 14

    cors_origins: str = "http://localhost:4200"

    # AI provider configuration. `auto` picks whichever key is set, preferring Gemini.
    ai_provider: Literal["auto", "anthropic", "gemini"] = "auto"
    anthropic_model: str = "claude-opus-4-7"
    anthropic_api_key: str | None = None
    gemini_model: str = "gemini-2.5-flash"
    google_api_key: str | None = None

    # Vertex AI mode — bypasses AI Studio's regional restrictions by routing
    # through the user's Google Cloud project. Authenticates via Application
    # Default Credentials (`gcloud auth application-default login`); GOOGLE_API_KEY
    # is ignored when this is enabled.
    google_genai_use_vertexai: bool = False
    google_cloud_project: str | None = None
    google_cloud_location: str = "us-central1"

    # On first startup, if no admin exists in the DB, an admin is provisioned from
    # these settings. Subsequent startups skip the bootstrap.
    initial_admin_email: str | None = None
    initial_admin_password: str | None = None
    initial_admin_name: str = "Administrator"

    @property
    def cors_origins_list(self) -> list[str]:
        return [origin.strip() for origin in self.cors_origins.split(",") if origin.strip()]


@lru_cache
def get_settings() -> Settings:
    return Settings()
