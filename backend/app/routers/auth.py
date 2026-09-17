"""Auth routes: register, login, me + refresh/logout with revocable refresh tokens.

Hardening vs the scaffold:
- duplicate registration is decided by the unique email index (DuplicateKeyError
  → 409), so concurrent signups can't both succeed (the find-then-insert race);
- passwords get a minimum length and are stored as bcrypt hashes only;
- refresh tokens are random, stored hashed, rotatable, and revocable;
- JWT_SECRET is required config — the known-default fallback is gone.
"""

from __future__ import annotations

import hashlib
import logging
import secrets
import uuid
from datetime import UTC, datetime, timedelta
from typing import Any

import bcrypt
import jwt
from fastapi import APIRouter, Depends, HTTPException
from pymongo.errors import DuplicateKeyError

from app.config import Settings
from app.deps import get_current_user, get_db, get_settings_dep
from app.models.auth import (
    LogoutRequest,
    RefreshRequest,
    TokenResponse,
    UserCreate,
    UserLogin,
)

router = APIRouter(prefix="/auth")

REFRESH_TOKEN_BYTES = 48

logger = logging.getLogger(__name__)


def _hash_password(password: str) -> str:
    return bcrypt.hashpw(password.encode("utf-8"), bcrypt.gensalt()).decode("utf-8")


def _verify_password(password: str, hashed: str) -> bool:
    return bcrypt.checkpw(password.encode("utf-8"), hashed.encode("utf-8"))


def _hash_refresh_token(raw: str) -> str:
    return hashlib.sha256(raw.encode("utf-8")).hexdigest()


def _create_access_token(
    user_id: str, email: str, token_version: int, settings: Settings
) -> str:
    now = datetime.now(UTC)
    payload = {
        "user_id": user_id,
        "email": email,
        "type": "access",
        "iat": now,
        "jti": uuid.uuid4().hex,  # per-token id (L3): log lines can name one
        # H2: the spec's revocation mechanism — get_current_user compares this
        # against the users doc and rejects stale versions.
        "ver": int(token_version),
        "exp": now + timedelta(minutes=settings.jwt_access_ttl_minutes),
    }
    return jwt.encode(payload, settings.jwt_secret, algorithm="HS256")


def _new_refresh_token_doc(user_id: str, settings: Settings) -> tuple[str, dict[str, Any]]:
    raw = secrets.token_urlsafe(REFRESH_TOKEN_BYTES)
    doc = {
        "token_hash": _hash_refresh_token(raw),
        "user_id": user_id,
        "created_at": datetime.now(UTC),
        "expires_at": datetime.now(UTC)
        + timedelta(days=settings.jwt_refresh_ttl_days),
        "revoked": False,
    }
    return raw, doc


async def _store_refresh_token(db: Any, doc: dict[str, Any]) -> None:
    await db.refresh_tokens.insert_one(doc)


def _public_user(user: dict[str, Any]) -> dict[str, Any]:
    return {
        "id": user.get("id", ""),
        "email": user.get("email", ""),
        "name": user.get("name", ""),
    }


async def _bump_token_version(db: Any, user_id: str) -> None:
    """H2: invalidate every outstanding access token for the user.

    get_current_user rejects any token whose ``ver`` claim lags the users doc,
    so one increment kills all previously issued access tokens.
    """
    await db.users.update_one({"id": user_id}, {"$inc": {"token_version": 1}})


async def _issue_tokens(
    db: Any, user: dict[str, Any], settings: Settings
) -> TokenResponse:
    access = _create_access_token(
        user["id"], user["email"], user.get("token_version", 0), settings
    )
    raw_refresh, refresh_doc = _new_refresh_token_doc(user["id"], settings)
    await _store_refresh_token(db, refresh_doc)
    return TokenResponse(
        token=access, user=_public_user(user), refresh_token=raw_refresh
    )


@router.post("/register", response_model=TokenResponse)
async def register(
    data: UserCreate,
    db: Any = Depends(get_db),
    settings: Settings = Depends(get_settings_dep),
) -> TokenResponse:
    existing = await db.users.find_one({"email": data.email}, {"_id": 0})
    if existing:
        raise HTTPException(status_code=409, detail="Email already registered")

    user_id = str(uuid.uuid4())
    user_doc = {
        "id": user_id,
        "email": data.email,
        "password": _hash_password(data.password),
        "name": data.name or data.email.split("@")[0],
        "created_at": datetime.now(UTC).isoformat(),
        "token_version": 0,  # H2: bumped on logout / compromise response
    }
    try:
        await db.users.insert_one(user_doc)
    except DuplicateKeyError:
        # The unique index is the race-safe authority — two concurrent
        # registrations for one email cannot both land.
        raise HTTPException(
            status_code=409, detail="Email already registered"
        ) from None
    return await _issue_tokens(db, user_doc, settings)


@router.post("/login", response_model=TokenResponse)
async def login(
    data: UserLogin,
    db: Any = Depends(get_db),
    settings: Settings = Depends(get_settings_dep),
) -> TokenResponse:
    user = await db.users.find_one({"email": data.email}, {"_id": 0})
    if not user or not _verify_password(data.password, user["password"]):
        raise HTTPException(status_code=401, detail="Invalid credentials")
    return await _issue_tokens(db, user, settings)


@router.get("/me")
async def get_me(
    current_user: dict[str, str] = Depends(get_current_user),
    db: Any = Depends(get_db),
) -> dict[str, Any]:
    user = await db.users.find_one(
        {"id": current_user["user_id"]}, {"_id": 0, "password": 0}
    )
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    return user


@router.post("/refresh", response_model=TokenResponse)
async def refresh(
    data: RefreshRequest,
    db: Any = Depends(get_db),
    settings: Settings = Depends(get_settings_dep),
) -> TokenResponse:
    token_hash = _hash_refresh_token(data.refresh_token)
    record = await db.refresh_tokens.find_one({"token_hash": token_hash}, {"_id": 0})
    if not record or record.get("revoked"):
        raise HTTPException(status_code=401, detail="Invalid or expired refresh token")

    expires_at = record.get("expires_at")
    now = datetime.now(UTC)
    if expires_at is not None:
        if expires_at.tzinfo is None:
            expires_at = expires_at.replace(tzinfo=UTC)
        if expires_at <= now:
            raise HTTPException(
                status_code=401, detail="Invalid or expired refresh token"
            )

    user = await db.users.find_one({"id": record["user_id"]}, {"_id": 0})
    if not user:
        raise HTTPException(status_code=401, detail="Invalid or expired refresh token")

    # Rotation: the presented token is single-use.
    await db.refresh_tokens.update_one(
        {"token_hash": token_hash}, {"$set": {"revoked": True}}
    )
    return await _issue_tokens(db, user, settings)


@router.post("/logout")
async def logout(
    data: LogoutRequest,
    db: Any = Depends(get_db),
) -> dict[str, str]:
    token_hash = _hash_refresh_token(data.refresh_token)
    record = await db.refresh_tokens.find_one(
        {"token_hash": token_hash}, {"_id": 0, "user_id": 1}
    )
    if record:
        await db.refresh_tokens.update_one(
            {"token_hash": token_hash}, {"$set": {"revoked": True}}
        )
        # H2: logout must kill live access tokens too, not only the refresh
        # token — otherwise a stolen bearer stays valid until its (short) TTL.
        await _bump_token_version(db, record["user_id"])
    return {"message": "Logged out"}
