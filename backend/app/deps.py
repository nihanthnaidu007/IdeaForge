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
from app.services.llm.provider import LLMProvider, UnconfiguredLLM, resolve_user_key
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

    The direct-SDK provider layer lands in the next release PR; the seam keeps
    routes fully wired and returning typed errors in the meantime.
    """
    await resolve_user_key(db, vault, user_id, provider, settings)
    return UnconfiguredLLM(provider=provider)
