"""Preferences + BYOK key management.

Contract preserved from the scaffold (GET/PUT /api/preferences with
``has_*_key`` booleans). Hardened: incoming keys are envelope-encrypted via the
vault (nonce + ciphertext + provider subkey + owner-bound AAD), only the masked
hint is persisted alongside, and every key write is audit-logged. A response
can no longer contain key material even by accident.
"""

from __future__ import annotations

from datetime import UTC, datetime
from typing import Any

from fastapi import APIRouter, Depends, HTTPException

from app.deps import get_current_user, get_db, get_vault
from app.models.preferences import PreferencesUpdate
from app.services.vault import Vault

router = APIRouter()


def _build_prefs_response(prefs: dict[str, Any]) -> dict[str, Any]:
    keys = prefs.get("keys", {}) or {}
    return {
        "default_tone": prefs.get("default_tone", "professional"),
        "default_niche": prefs.get("default_niche", "AI"),
        "has_tavily_key": "tavily" in keys,
        "has_anthropic_key": "anthropic" in keys,
        "has_openai_key": "openai" in keys,
    }


@router.get("/preferences")
async def get_preferences(
    current_user: dict[str, str] = Depends(get_current_user),
    db: Any = Depends(get_db),
) -> dict[str, Any]:
    prefs = await db.user_preferences.find_one(
        {"user_id": current_user["user_id"]}, {"_id": 0}
    )
    if not prefs:
        return _build_prefs_response({})
    return _build_prefs_response(prefs)


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
        await db.key_audit.insert_one(
            {
                "user_id": user_id,
                "provider": provider,
                "event": "stored",
                "at": datetime.now(UTC),
            }
        )

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
