"""Dependency-injection seams: settings, db, current user, vault, LLM provider.

Everything hangs off ``request.app.state`` so tests can build the app with a
fake database / injected settings via ``create_app(settings=..., db=...)``.
"""

from __future__ import annotations

from typing import Any

import jwt
from fastapi import Depends, HTTPException
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from starlette.requests import Request

from app.config import Settings
from app.services.llm.anthropic_client import AnthropicLLM
from app.services.llm.openai_client import OpenAILLM
from app.services.llm.provider import (
    LLMProvider,
    ProviderError,
    pick_provider,
    resolve_user_key,
)
from app.services.vault import Vault

_bearer = HTTPBearer(auto_error=True)


def get_settings_dep(request: Request) -> Settings:
    return request.app.state.settings


def get_db(request: Request) -> Any:
    return request.app.state.db


def get_vault(request: Request) -> Vault:
    return request.app.state.vault


def get_http_client(request: Request) -> Any:
    return request.app.state.http_client


async def get_current_user(
    credentials: HTTPAuthorizationCredentials = Depends(_bearer),
    settings: Settings = Depends(get_settings_dep),
    db: Any = Depends(get_db),
) -> dict[str, str]:
    try:
        payload = jwt.decode(
            credentials.credentials, settings.jwt_secret, algorithms=["HS256"]
        )
    except jwt.ExpiredSignatureError:
        raise HTTPException(status_code=401, detail="Token expired") from None
    except jwt.InvalidTokenError:
        raise HTTPException(status_code=401, detail="Invalid token") from None

    # Refresh tokens share the signing secret; they must never authenticate.
    if payload.get("type") != "access":
        raise HTTPException(status_code=401, detail="Invalid token")

    # H2: token_version revocation (the spec's mechanism). One indexed
    # find_one per authenticated request; a token whose ``ver`` claim lags
    # the users doc was issued before a logout/compromise response and is dead.
    user = await db.users.find_one(
        {"id": payload["user_id"]}, {"_id": 0, "token_version": 1}
    )
    if user is None or int(payload.get("ver", 0)) != int(
        user.get("token_version", 0)
    ):
        raise HTTPException(status_code=401, detail="Invalid token")
    return {"user_id": payload["user_id"], "email": payload["email"]}


async def get_llm(
    user_id: str,
    provider: str,
    *,
    db: Any,
    vault: Vault,
    settings: Settings,
) -> LLMProvider:
    """Resolve the caller's key (fail loud if absent), then return the provider.

    Every generation route resolves its key here — BYOK first, server env
    default second, typed MissingKeyError otherwise. No universal-key fallback.
    """
    if provider not in ("anthropic", "openai", "auto"):
        raise ProviderError(
            f"'{provider}' is not an LLM provider.", provider=provider
        )
    if provider == "auto":
        # "auto" = the connected key decides: BYOK presence first, server
        # env default second, typed MissingKeyError otherwise. Generation
        # routes never hardcode a provider their user may not have.
        provider = await pick_provider(user_id, None, db, settings)
    api_key = await resolve_user_key(db, vault, user_id, provider, settings)
    if provider == "anthropic":
        return AnthropicLLM(api_key=api_key, model=settings.anthropic_model)
    return OpenAILLM(api_key=api_key, model=settings.openai_model)
