"""Config contract: required secrets, master-key validation, CORS policy.

Spec acceptance criterion #2: "App refuses to boot without JWT_SECRET and
ENCRYPTION_MASTER_KEY; CORS is an explicit list ('*' rejected in prod)."
"""

from __future__ import annotations

import base64

import pytest
from pydantic import ValidationError

from tests.conftest import make_settings


def test_missing_jwt_secret_refuses_boot() -> None:
    with pytest.raises(ValidationError, match=r"(?i)jwt_secret"):
        make_settings(JWT_SECRET=None)


def test_missing_encryption_master_key_refuses_boot() -> None:
    with pytest.raises(ValidationError, match=r"(?i)encryption_master_key"):
        make_settings(ENCRYPTION_MASTER_KEY=None)


def test_master_key_must_decode_to_32_bytes() -> None:
    short = base64.b64encode(b"too-short").decode("ascii")
    with pytest.raises(ValidationError, match="32 bytes"):
        make_settings(ENCRYPTION_MASTER_KEY=short)


def test_master_key_must_be_valid_base64() -> None:
    with pytest.raises(ValidationError, match="base64"):
        make_settings(ENCRYPTION_MASTER_KEY="!!not base64!!")


def test_valid_secrets_construct_settings() -> None:
    settings = make_settings()
    assert settings.jwt_secret
    assert base64.b64decode(settings.encryption_master_key) == b"0" * 32


def test_prod_rejects_wildcard_cors() -> None:
    with pytest.raises(ValidationError, match="explicit origin list"):
        make_settings(env="prod", CORS_ORIGINS="*")


def test_prod_accepts_explicit_origins() -> None:
    settings = make_settings(
        env="prod", CORS_ORIGINS="https://app.example.com, https://www.example.com"
    )
    assert settings.cors_origins == [
        "https://app.example.com",
        "https://www.example.com",
    ]


def test_dev_gets_safe_default_origins() -> None:
    settings = make_settings()
    assert "http://localhost:3000" in settings.cors_origins
    assert "*" not in settings.cors_origins


def test_mongo_url_is_required() -> None:
    with pytest.raises(ValidationError, match=r"(?i)mongo_url"):
        make_settings(MONGO_URL=None)


def test_server_default_keys_are_optional() -> None:
    settings = make_settings()
    assert settings.openai_api_key is None
    assert settings.anthropic_api_key is None
    assert settings.tavily_api_key is None
