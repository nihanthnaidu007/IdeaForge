"""Voice DNA routes: extraction, view/edit, version history.

Extraction runs one model call through the provider seam (BYOK → server
default → typed MissingKeyError), validates the output against the craft
pack's VoiceDNAProfile schema, and appends a version — the profile is
"editable and versioned per user" (spec, Voice DNA row). Every generation
route reads the active version into its prompt (services/voice.py). Edits
append a version too (source: manual_edit) — history is never rewritten
(UI pack §6.3's restore-is-a-save law).
"""

from __future__ import annotations

from datetime import UTC, datetime
from typing import Any

from fastapi import APIRouter, Depends, HTTPException

from app.deps import get_current_user, get_db, get_llm, get_settings_dep, get_vault
from app.models.voice import ExtractVoiceRequest, VoiceProfileEdit
from app.services import usage
from app.services.llm.provider import complete_json_with_retry
from app.services.voice import (
    EXTRACTION_SYSTEM_PROMPT,
    build_extraction_user_prompt,
    profile_version_response,
    validate_voice_profile,
    version_summaries,
)

router = APIRouter()

# Bounded history: old versions roll off the front so re-extraction can't
# grow a document without limit; 20 keeps months of real churn.
_MAX_VERSIONS = 20


async def get_active_voice_profile(db: Any, user_id: str) -> dict[str, Any] | None:
    """The user's active profile version, or None when they have none.

    Generation routes call this (retrieval-into-prompt); the active version is
    the highest version number. preferences.default_voice_id stays a future
    multi-profile pointer — one live profile per user in v1.
    """
    doc = await db.voice_profiles.find_one(
        {"user_id": user_id}, {"_id": 0, "versions": 1}
    )
    versions = (doc or {}).get("versions") or []
    if not versions:
        return None
    return max(versions, key=lambda v: v.get("version", 0))


async def _append_version(db: Any, user_id: str, version: dict[str, Any]) -> int:
    """Append a version and return the total kept. One document per user."""
    doc = await db.voice_profiles.find_one({"user_id": user_id})
    versions = (doc or {}).get("versions") or []
    next_version = max((v.get("version", 0) for v in versions), default=0) + 1
    # Explicit version last: the incoming dict may carry the old version number.
    version = {**version, "version": next_version}
    versions = [*versions, version][-_MAX_VERSIONS:]
    if doc is None:
        await db.voice_profiles.insert_one(
            {"user_id": user_id, "versions": versions, "updated_at": datetime.now(UTC)}
        )
    else:
        await db.voice_profiles.update_one(
            {"user_id": user_id},
            {"$set": {"versions": versions, "updated_at": datetime.now(UTC)}},
        )
    return next_version


@router.post("/voice/profile")
async def extract_voice_profile(
    data: ExtractVoiceRequest,
    current_user: dict[str, str] = Depends(get_current_user),
    db: Any = Depends(get_db),
    vault: Any = Depends(get_vault),
    settings: Any = Depends(get_settings_dep),
) -> dict[str, Any]:
    user_id = current_user["user_id"]
    samples = [s.strip() for s in data.samples if s.strip()]
    if len(samples) < 3:
        raise HTTPException(
            status_code=400,
            detail="Paste at least 3 non-empty posts — the analyst needs real material.",
        )

    llm = await get_llm(
        user_id, data.provider or "auto", db=db, vault=vault, settings=settings
    )
    prompt = build_extraction_user_prompt(
        samples, niche=data.niche, audience=data.audience
    )
    payload = await complete_json_with_retry(
        llm,
        system=EXTRACTION_SYSTEM_PROMPT,
        prompt=prompt,
        max_tokens=3_000,
        provider=llm.provider_name,
    )
    style = validate_voice_profile(payload)

    await _append_version(
        db,
        user_id,
        {
            "style": {
                "structure": style["structure"],
                "vocabulary": style["vocabulary"],
                "energy": style["energy"],
                "signature_moves": style["signature_moves"],
            },
            "sentence_rhythm": style["sentence_rhythm"],
            "do_list": style["do_list"],
            "dont_list": style["dont_list"],
            "notes": style["notes"],
            "confidence": style["confidence"],
            "sample_count": style["sample_count"],
            "source": "extraction",
            "extracted_at": datetime.now(UTC),
        },
    )

    # Honest-analytics substrate: extractions are a real usage event.
    await usage.record_usage_event(
        db,
        user_id,
        usage.VOICE_EXTRACTED,
        provider=llm.provider_name,
        count=len(samples),
    )

    doc = await db.voice_profiles.find_one({"user_id": user_id}, {"_id": 0})
    versions = (doc or {}).get("versions") or []
    active = max(versions, key=lambda v: v.get("version", 0))
    return profile_version_response(active, total_versions=len(versions))


@router.get("/voice/profile")
async def get_voice_profile(
    current_user: dict[str, str] = Depends(get_current_user),
    db: Any = Depends(get_db),
) -> dict[str, Any]:
    """The active profile, or {"profile": null} — absence is the normal
    first-run state, not an error."""
    user_id = current_user["user_id"]
    doc = await db.voice_profiles.find_one({"user_id": user_id}, {"_id": 0})
    versions = (doc or {}).get("versions") or []
    if not versions:
        return {"profile": None, "versions": []}
    active = max(versions, key=lambda v: v.get("version", 0))
    return profile_version_response(active, total_versions=len(versions))


@router.get("/voice/profile/versions")
async def list_voice_versions(
    current_user: dict[str, str] = Depends(get_current_user),
    db: Any = Depends(get_db),
) -> dict[str, Any]:
    doc = await db.voice_profiles.find_one({"user_id": current_user["user_id"]}, {"_id": 0})
    return {"versions": version_summaries((doc or {}).get("versions") or [])}


@router.put("/voice/profile")
async def edit_voice_profile(
    data: VoiceProfileEdit,
    current_user: dict[str, str] = Depends(get_current_user),
    db: Any = Depends(get_db),
) -> dict[str, Any]:
    active = await get_active_voice_profile(db, current_user["user_id"])
    if active is None:
        raise HTTPException(
            status_code=404,
            detail="No voice profile to edit yet — extract one from your past posts first.",
        )

    edited = {
        **active,
        "do_list": data.do_list if data.do_list is not None else active["do_list"],
        "dont_list": data.dont_list if data.dont_list is not None else active["dont_list"],
        "notes": data.notes if data.notes is not None else active.get("notes", ""),
        "source": "manual_edit",
        "extracted_at": datetime.now(UTC),
    }
    await _append_version(db, current_user["user_id"], edited)

    doc = await db.voice_profiles.find_one(
        {"user_id": current_user["user_id"]}, {"_id": 0}
    )
    versions = (doc or {}).get("versions") or []
    new_active = max(versions, key=lambda v: v.get("version", 0))
    return profile_version_response(new_active, total_versions=len(versions))
