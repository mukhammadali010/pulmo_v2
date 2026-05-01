from functools import lru_cache
from typing import Literal

from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    env: Literal["development", "production", "test"] = "development"

    database_url: str = Field(
        default="postgresql+asyncpg://pulmoai:pulmoai@localhost:5432/pulmoai_dev"
    )

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

    @property
    def cors_origins_list(self) -> list[str]:
        return [origin.strip() for origin in self.cors_origins.split(",") if origin.strip()]


@lru_cache
def get_settings() -> Settings:
    return Settings()
