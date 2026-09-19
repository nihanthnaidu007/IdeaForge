"""Preferences + BYOK key management.

Contract preserved from the scaffold (GET/PUT /api/preferences with
``has_*_key`` booleans), extended with per-key delete and a test-key endpoint.
Hardened: incoming keys are envelope-encrypted via the vault (nonce + ciphertext
+ provider subkey + owner-bound AAD), only the masked hint is persisted
alongside, and every key write is audit-logged. A response can no longer
contain key material even by accident — the builders below return booleans and
``****last4`` hints, never blobs.
"""

from __future__ import annotations

from typing import Any

import httpx
from anthropic import AnthropicError, AsyncAnthropic
from fastapi import APIRouter, Depends, HTTPException
from openai import AsyncOpenAI, OpenAIError

from app.deps import get_current_user, get_db, get_settings_dep, get_vault
from app.models.preferences import PreferencesUpdate
from app.services.audit import build_key_audit_event
from app.services.llm.anthropic_client import map_anthropic_error
from app.services.llm.openai_client import map_openai_error
from app.services.llm.provider import (
    MissingKeyError,
    ProviderAuthError,
    ProviderError,
    ProviderRateLimitedError,
    ProviderUnavailableError,
)
from app.services.vault import Vault, VaultDecryptionError

router = APIRouter()

_KEY_PROVIDERS = ("tavily", "anthropic", "openai")
_TAVILY_PROBE_URL = "https://api.tavily.com/search"
_KEY_TEST_TIMEOUT_SECONDS = 10.0


def _build_prefs_response(prefs: dict[str, Any]) -> dict[str, Any]:
    keys = prefs.get("keys", {}) or {}
    # key_hints is the ONLY place key-derived data may appear: masked hints.
    return {
        "default_tone": prefs.get("default_tone", "professional"),
        "default_niche": prefs.get("default_niche", "AI"),
        "default_voice_id": prefs.get("default_voice_id"),
        "has_tavily_key": "tavily" in keys,
        "has_anthropic_key": "anthropic" in keys,
        "has_openai_key": "openai" in keys,
        "key_hints": {
            provider: blob["hint"]
            for provider, blob in keys.items()
            if isinstance(blob, dict) and blob.get("hint")
        },
    }


async def _audit(db: Any, user_id: str, provider: str, event: str) -> None:
    await db.key_audit.insert_one(build_key_audit_event(user_id, provider, event))


async def _probe_key(provider: str, api_key: str, settings: Any) -> None:
    """One cheap authenticated call per provider; raises typed errors on failure."""
    if provider == "anthropic":
        async with AsyncAnthropic(
            api_key=api_key,
            timeout=_KEY_TEST_TIMEOUT_SECONDS,
            base_url=settings.anthropic_base_url,
        ) as sdk:
            try:
                await sdk.models.list(limit=1)
            except AnthropicError as exc:
                raise map_anthropic_error(exc, provider) from exc
    elif provider == "openai":
        async with AsyncOpenAI(
            api_key=api_key,
            timeout=_KEY_TEST_TIMEOUT_SECONDS,
            base_url=settings.openai_base_url,
        ) as sdk:
            try:
                await sdk.models.list(limit=1)
            except OpenAIError as exc:
                raise map_openai_error(exc, provider) from exc
    else:  # tavily — no SDK; probe the search endpoint directly (mirrors research.py)
        try:
            async with httpx.AsyncClient(timeout=_KEY_TEST_TIMEOUT_SECONDS) as client:
                response = await client.post(
                    settings.tavily_base_url or _TAVILY_PROBE_URL,
                    json={
                        "query": "connectivity check",
                        "max_results": 1,
                    },
                    # L6: mirror research.py — Authorization header, not body.
                    headers={"Authorization": f"Bearer {api_key}"},
                )
        except httpx.TimeoutException as exc:
            raise ProviderUnavailableError(
                "Tavily timed out — please retry.", provider=provider
            ) from exc
        except httpx.HTTPError as exc:
            raise ProviderUnavailableError(
                "Could not reach Tavily — please retry.", provider=provider
            ) from exc
        if response.status_code in (401, 403):
            raise ProviderAuthError(
                "Tavily rejected the API key — please check Settings.",
                provider=provider,
            )
        if response.status_code == 429:
            raise ProviderRateLimitedError(
                "Tavily rate limit hit — please retry shortly.", provider=provider
            )
        if response.status_code >= 400:
            raise ProviderError(
                f"Tavily returned HTTP {response.status_code} during validation — "
                "please retry.",
                provider=provider,
            )


@router.get("/preferences")
async def get_preferences(
    current_user: dict[str, str] = Depends(get_current_user),
    db: Any = Depends(get_db),
) -> dict[str, Any]:
    prefs = await db.user_preferences.find_one(
        {"user_id": current_user["user_id"]}, {"_id": 0}
    )
    return _build_prefs_response(prefs or {})


@router.put("/preferences")
async def update_preferences(
    data: PreferencesUpdate,
    current_user: dict[str, str] = Depends(get_current_user),
    db: Any = Depends(get_db),
    vault: Vault = Depends(get_vault),
) -> dict[str, Any]:
    user_id = current_user["user_id"]

    update: dict[str, Any] = {}
    if data.default_tone is not None:
        update["default_tone"] = data.default_tone
    if data.default_niche is not None:
        update["default_niche"] = data.default_niche
    if data.default_voice_id is not None:
        update["default_voice_id"] = data.default_voice_id

    incoming = {
        "tavily": data.tavily_api_key,
        "anthropic": data.anthropic_api_key,
        "openai": data.openai_api_key,
    }
    for provider, plaintext in incoming.items():
        if plaintext is None:
            continue
        plaintext = plaintext.strip()
        if not plaintext:
            continue
        if len(plaintext) < 8:
            raise HTTPException(
                status_code=400, detail=f"{provider} API key is invalid"
            )
        blob = vault.encrypt(user_id, provider, plaintext)
        update[f"keys.{provider}"] = blob
        await _audit(db, user_id, provider, "stored")

    if not update:
        prefs = await db.user_preferences.find_one(
            {"user_id": user_id}, {"_id": 0}
        )
        return _build_prefs_response(prefs or {})

    doc = await db.user_preferences.find_one_and_update(
        {"user_id": user_id},
        {"$set": update, "$setOnInsert": {"user_id": user_id}},
        upsert=True,
        return_document=True,
    )
    return _build_prefs_response(doc or {})


@router.delete("/keys/{provider}")
async def delete_key(
    provider: str,
    current_user: dict[str, str] = Depends(get_current_user),
    db: Any = Depends(get_db),
) -> dict[str, Any]:
    if provider not in _KEY_PROVIDERS:
        raise HTTPException(status_code=404, detail=f"Unknown provider '{provider}'")
    user_id = current_user["user_id"]

    existing = await db.user_preferences.find_one({"user_id": user_id}, {"_id": 0})
    if not existing or not ((existing.get("keys") or {}).get(provider)):
        raise HTTPException(
            status_code=404, detail=f"No {provider} key stored for this account"
        )

    await db.user_preferences.update_one(
        {"user_id": user_id}, {"$unset": {f"keys.{provider}": ""}}
    )
    await _audit(db, user_id, provider, "removed")
    return {"provider": provider, "removed": True}


@router.post("/keys/{provider}/test")
async def test_key(
    provider: str,
    current_user: dict[str, str] = Depends(get_current_user),
    db: Any = Depends(get_db),
    vault: Vault = Depends(get_vault),
    settings: Any = Depends(get_settings_dep),
) -> dict[str, Any]:
    """Validate the stored key with one real, cheap call to the provider.

    Never returns key material — a masked hint at most. Failures surface as the
    typed provider errors (401/402/429/503) with product-neutral copy.
    """
    if provider not in _KEY_PROVIDERS:
        raise HTTPException(status_code=404, detail=f"Unknown provider '{provider}'")
    user_id = current_user["user_id"]

    prefs = await db.user_preferences.find_one({"user_id": user_id}, {"_id": 0})
    blob = ((prefs or {}).get("keys") or {}).get(provider)
    if not blob:
        raise MissingKeyError(
            f"No {provider} API key stored — add one in Settings first.",
            provider=provider,
        )
    try:
        api_key = vault.decrypt(user_id, provider, blob)
    except VaultDecryptionError as exc:
        await _audit(db, user_id, provider, "use_failure")
        raise ProviderAuthError(
            "Stored API key could not be decrypted — please re-save it in Settings.",
            provider=provider,
        ) from exc

    await _probe_key(provider, api_key, settings)
    # M5: use-success is an audit event too — the ledger records that this
    # stored key validated successfully, not only that it failed.
    await _audit(db, user_id, provider, "used")
    return {
        "provider": provider,
        "valid": True,
        "hint": blob.get("hint") or vault.masked(api_key),
    }
