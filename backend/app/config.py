"""Typed application settings.

Boot fails fast when required secrets are unset — the old scaffold silently
fell back to a known JWT secret; that is dead. Consumed via ``get_settings()``
(cached) or injected per-app in tests via ``create_app(settings=...)``.
"""

from __future__ import annotations

import base64
from functools import lru_cache
from pathlib import Path
from typing import Annotated, Literal

from pydantic import Field, field_validator, model_validator
from pydantic_settings import BaseSettings, NoDecode, SettingsConfigDict

_ENV_FILE = Path(__file__).resolve().parent.parent / ".env"

# Comma-separated env values (CORS_ORIGINS=a,b) — decoded by hand, not as JSON.
_CorsOrigins = Annotated[list[str], NoDecode]

_DEV_CORS_ORIGINS = [
    "http://localhost:3000",
    "http://127.0.0.1:3000",
    "http://localhost:5173",
    "http://127.0.0.1:5173",
]


class Settings(BaseSettings):
    env: Literal["dev", "prod"] = "dev"
    mongo_url: str = Field(validation_alias="MONGO_URL")
    db_name: str = Field(default="ideaforge", validation_alias="DB_NAME")
    jwt_secret: str = Field(validation_alias="JWT_SECRET")
    # 32 raw bytes, base64-encoded (``openssl rand -base64 32``). Consumed by the
    # BYOK vault; required at boot even before the vault is used so the secret
    # contract is fixed now.
    encryption_master_key: str = Field(validation_alias="ENCRYPTION_MASTER_KEY")

    # H2: short-lived access tokens. Revocation is enforced by token_version
    # (checked against the users doc on every authenticated call) — a stolen
    # access token dies at the next logout/compromise response, or within an
    # hour regardless.
    jwt_access_ttl_minutes: int = 60
    jwt_refresh_ttl_days: int = 30
    cors_origins: _CorsOrigins = []
    rate_limit_auth_per_minute: int = 10
    trusted_proxy: bool = False  # True when behind a proxy that sets X-Forwarded-For

    # Optional server-default keys. Resolution order is user BYOK first, then
    # these, then a typed MissingKeyError — there is no universal-key fallback.
    openai_api_key: str | None = None
    anthropic_api_key: str | None = None
    tavily_api_key: str | None = None

    openai_model: str = "gpt-5.2"
    anthropic_model: str = "claude-sonnet-4-5"

    redis_url: str | None = None  # set: rate limits share state across workers
    smtp_url: str | None = None  # set: email reminders enabled
    # LinkedIn feed char limit for the post-preview linter. Configurable
    # because feed policy drifts (UI pack §6.1 check 3, §9.2 #1).
    linkedin_char_limit: int = Field(default=3000, validation_alias="LINKEDIN_CHAR_LIMIT")
    log_level: str = "INFO"

    model_config = SettingsConfigDict(env_file=_ENV_FILE, extra="ignore")

    @field_validator("cors_origins", mode="before")
    @classmethod
    def _split_cors_origins(cls, value: object) -> object:
        if isinstance(value, str):
            return [origin.strip() for origin in value.split(",") if origin.strip()]
        return value

    @field_validator("encryption_master_key")
    @classmethod
    def _master_key_must_be_32_bytes(cls, value: str) -> str:
        try:
            raw = base64.b64decode(value, validate=True)
        except (ValueError, TypeError) as exc:
            raise ValueError(
                "ENCRYPTION_MASTER_KEY must be base64 for exactly 32 bytes "
                "(generate with: openssl rand -base64 32)"
            ) from exc
        if len(raw) != 32:
            raise ValueError(
                f"ENCRYPTION_MASTER_KEY must decode to 32 bytes, got {len(raw)}"
            )
        return value

    @model_validator(mode="after")
    def _validate_cors(self) -> Settings:
        if self.env == "prod" and "*" in self.cors_origins:
            raise ValueError(
                "CORS_ORIGINS must be an explicit origin list in prod — '*' is rejected"
            )
        if not self.cors_origins and self.env == "dev":
            self.cors_origins = list(_DEV_CORS_ORIGINS)
        return self


@lru_cache
def get_settings() -> Settings:
    """Cached settings for the module-level app. Tests inject Settings directly."""
    return Settings()
