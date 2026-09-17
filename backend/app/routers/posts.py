"""Post routes: variant generation, real regeneration, versioned tweaks.

The audited defect (backend audit §1.3 route 9) was regenerate re-calling
generate_post and returning identical output. This router replaces that with
the variation-instruction engine: each variant carries a distinct angle/hook/
energy brief (AI craft pack §2, verbatim), regeneration rotates the brief set
so instructions are never repeated, tweaks are versioned (previous drafts are
kept, never silently overwritten), and every generation response carries a
cost hint (§6 BYOK rule) plus a usage event per provider call.

Fail-loud: no key → 400, provider failure → typed error, model refusal →
GENERATION_REFUSED on its own column while siblings stand — never a canned
post with HTTP 200.
"""

from __future__ import annotations

import logging
import uuid
from datetime import UTC, datetime
from typing import Any

from fastapi import APIRouter, Depends, HTTPException

from app.config import Settings
from app.deps import get_current_user, get_db, get_llm, get_settings_dep, get_vault
from app.models.posts import (
    GeneratePostRequest,
    GenerateVariantsRequest,
    TweakPostRequest,
    TweakVariantRequest,
)
from app.services.cost_hints import build_cost_hint
from app.services.llm.provider import (
    GenerationError,
    GenerationRefusedError,
    complete_json_with_retry,
    last_usage_of,
)
from app.services.usage import (
    POST_DRAFTED,
    POST_TWEAKED,
    VARIANT_GENERATED,
    VARIANT_TWEAKED,
    record_usage_event,
)
from app.services.variants import (
    FORMAT_CONTRACTS,
    MASTER_SYSTEM_PROMPT,
    VARIATION_BRIEFS,
    VariantBrief,
    assemble_user_message,
    assign_briefs,
    brief_block,
    brief_intent,
    build_idea_block,
    build_trend_block,
    build_voice_block,
    estimate_output_tokens,
    normalize_format,
    parse_variant_output,
)

logger = logging.getLogger("app.posts")

router = APIRouter()


def _utc_now() -> datetime:
    return datetime.now(UTC)


def _insight_evidence_gaps(insights: dict[str, Any] | None) -> list[str]:
    """§5.3: the card's evidence_gaps feed the TREND block's no-source lines."""
    if not insights:
        return []
    gaps = insights.get("evidence_gaps")
    if not isinstance(gaps, list):
        return []
    return [str(gap) for gap in gaps if str(gap).strip()][:5]


async def _voice_block(db: Any, user_id: str) -> str:
    profile = await db.voice_profiles.find_one({"user_id": user_id}, {"_id": 0})
    return build_voice_block(profile)


def _failed_variant(brief: VariantBrief, exc: GenerationError) -> dict[str, Any]:
    """A failed column: honest typed state, never synthetic content (§6.4)."""
    return {
        "brief_id": brief.brief_id,
        "brief_name": brief.name,
        "intent": brief_intent(brief),
        "status": "failed",
        "error_kind": getattr(exc, "kind", "GENERATION_FAILED"),
        "error": str(exc),
    }


def _ready_variant(
    brief: VariantBrief, draft: dict[str, Any], *, variant_id: str
) -> dict[str, Any]:
    return {
        "id": variant_id,
        "brief_id": brief.brief_id,
        "brief_name": brief.name,
        "intent": brief_intent(brief),
        "status": "ready",
        "post_text": draft["post_text"],
        "hook_pattern_id": draft.get("hook_pattern_id"),
        "sourced_claims": draft.get("sourced_claims") or [],
        "own_claims": draft.get("own_claims") or [],
        "speculative_claims": draft.get("speculative_claims") or [],
        "notes": draft.get("notes") or "",
        "generated_at": _utc_now().isoformat(),
    }


def _public_set(set_doc: dict[str, Any]) -> dict[str, Any]:
    """Response projection: everything except ownership internals."""
    return {k: v for k, v in set_doc.items() if k not in ("_id", "user_id")}


async def _load_parent(
    db: Any, user_id: str, parent_set_id: str | None
) -> dict[str, Any] | None:
    if not parent_set_id:
        return None
    parent = await db.variant_sets.find_one(
        {"id": parent_set_id, "user_id": user_id}
    )
    if parent is None:
        raise HTTPException(
            status_code=404, detail="That variant set no longer exists."
        )
    return parent


async def _run_variant_generation(
    data: GenerateVariantsRequest,
    *,
    db: Any,
    vault: Any,
    settings: Settings,
    user_id: str,
    generation_round: int,
) -> dict[str, Any]:
    """Generate one variant set: N briefs, N calls, honest partial failures.

    Auth/quota/rate-limit failures propagate immediately (the whole request
    fails — no key state differs per column); refusal and malformed-output
    failures mark their own column failed while the others complete (§6.4:
    partial success is shown as partial, never collapsed into total failure).
    """
    try:
        format_code = normalize_format(data.format)
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from None

    llm = await get_llm(user_id, "openai", db=db, vault=vault, settings=settings)
    voice_block = await _voice_block(db, user_id)
    idea_block = build_idea_block(
        data.idea, data.insights, custom_instructions=data.custom_instructions
    )
    trend_block = build_trend_block(
        data.trends, evidence_gaps=_insight_evidence_gaps(data.insights)
    )
    format_contract = FORMAT_CONTRACTS[format_code]
    briefs = assign_briefs(format_code, 3, generation_round)

    variants: list[dict[str, Any]] = []
    first_failure: GenerationError | None = None
    last_prompt_chars = 0
    for brief in briefs:
        # Per-variant identity: usage events carry it so analytics can join
        # generation and tweak events back to the column that produced them.
        variant_id = str(uuid.uuid4())
        user_message = assemble_user_message(
            idea_block=idea_block,
            format_contract=format_contract,
            variant_block=brief_block(brief),
            trend_block=trend_block,
            voice_block=voice_block,
        )
        try:
            parsed = await complete_json_with_retry(
                llm,
                system=MASTER_SYSTEM_PROMPT,
                prompt=user_message,
                provider="openai",
                max_tokens=4000,
            )
            draft = parse_variant_output(parsed, provider="openai")
        except GenerationRefusedError as exc:
            # §4.4: a refusal is truthful input feedback — never retried
            # silently, never substituted. Its column shows the typed state.
            variants.append(_failed_variant(brief, exc))
            first_failure = first_failure or exc
            logger.info("variant refused: %s %s (%s)", brief.brief_id, exc, user_id)
            continue
        except GenerationError as exc:
            variants.append(_failed_variant(brief, exc))
            first_failure = first_failure or exc
            logger.warning("variant failed: %s %s (%s)", brief.brief_id, exc, user_id)
            continue
        variants.append(_ready_variant(brief, draft, variant_id=variant_id))
        last_prompt_chars = len(user_message)
        usage = last_usage_of(llm)
        await record_usage_event(
            db,
            user_id,
            VARIANT_GENERATED,
            provider="openai",
            tokens_in=usage.tokens_in if usage else None,
            tokens_out=usage.tokens_out if usage else None,
            variant_id=variant_id,
            hook_pattern_id=draft.get("hook_pattern_id"),
        )

    if not any(v["status"] == "ready" for v in variants):
        # Nothing was produced — nothing is persisted or returned as content.
        assert first_failure is not None
        raise first_failure

    set_doc = {
        "id": str(uuid.uuid4()),
        "user_id": user_id,
        "idea": data.idea,
        "insights": data.insights,
        "format": format_code,
        "format_raw": data.format,
        "tone": data.tone,
        "trends": [t.model_dump() for t in data.trends],
        "researched_at": data.researched_at,
        "custom_instructions": data.custom_instructions,
        "parent_set_id": data.parent_set_id,
        "generation_round": generation_round,
        "variants": variants,
        "created_at": _utc_now().isoformat(),
        "updated_at": _utc_now().isoformat(),
    }
    await db.variant_sets.insert_one(set_doc)

    # §6: the response carries the hint for the NEXT variant generation.
    cost_hint = build_cost_hint(
        "generate_variant",
        settings=settings,
        provider="openai",
        model=settings.openai_model,
        prompt_chars=last_prompt_chars or 6000,
        output_tokens=estimate_output_tokens(format_code),
        k=len([v for v in variants if v["status"] == "ready"]),
    )
    return {"variant_set": _public_set(set_doc), "cost_hint": cost_hint}


def _next_generation_round(parent: dict[str, Any] | None) -> int:
    if not parent:
        return 0
    return int(parent.get("generation_round", 0)) + 1


@router.post("/generate-variants")
async def generate_variants(
    data: GenerateVariantsRequest,
    current_user: dict[str, str] = Depends(get_current_user),
    db: Any = Depends(get_db),
    vault: Any = Depends(get_vault),
    settings: Any = Depends(get_settings_dep),
) -> dict[str, Any]:
    parent = await _load_parent(db, current_user["user_id"], data.parent_set_id)
    return await _run_variant_generation(
        data,
        db=db,
        vault=vault,
        settings=settings,
        user_id=current_user["user_id"],
        generation_round=_next_generation_round(parent),
    )


@router.post("/regenerate-post")
async def regenerate_post(
    data: GenerateVariantsRequest,
    current_user: dict[str, str] = Depends(get_current_user),
    db: Any = Depends(get_db),
    vault: Any = Depends(get_vault),
    settings: Any = Depends(get_settings_dep),
) -> dict[str, Any]:
    """Regeneration = a new variant set with rotated briefs.

    The old behavior (re-calling generate_post, identical output every time —
    backend audit §1.3 route 9) is gone: the generation round increments and
    the brief rotation guarantees a different instruction set.
    """
    parent = await _load_parent(db, current_user["user_id"], data.parent_set_id)
    return await _run_variant_generation(
        data,
        db=db,
        vault=vault,
        settings=settings,
        user_id=current_user["user_id"],
        generation_round=_next_generation_round(parent) or 1,
    )


@router.get("/cost-estimate")
async def cost_estimate(
    action: str,
    format: str | None = None,
    current_user: dict[str, str] = Depends(get_current_user),
    settings: Any = Depends(get_settings_dep),
) -> dict[str, Any]:
    """Cost-hint preview for the banner that precedes an action (AI pack §6).

    Estimated from the format's band midpoint (prompt size is unknowable
    before assembly; the estimate says "about" for a reason). Unpriced models
    return estimated_usd: null — the UI gates with Run anyway, per §6.5.
    """
    provider = "openai"
    model = settings.openai_model
    format_code = ""
    output_tokens: int | None = None
    if format:
        try:
            format_code = normalize_format(format)
            output_tokens = estimate_output_tokens(format_code)
        except ValueError:
            format_code = ""
    try:
        hint = build_cost_hint(
            action,
            settings=settings,
            provider=provider,
            model=model,
            prompt_chars=6000,
            output_tokens=output_tokens,
            n=6 if action == "forge_ideas" else None,
            k=4 if action == "generate_variant" else None,
        )
    except KeyError as exc:
        raise HTTPException(
            status_code=422, detail=f"Unknown cost-hint action '{action}'."
        ) from exc
    hint["format"] = format_code or None
    return hint


@router.post("/tweak-variant")
async def tweak_variant(
    data: TweakVariantRequest,
    current_user: dict[str, str] = Depends(get_current_user),
    db: Any = Depends(get_db),
    vault: Any = Depends(get_vault),
    settings: Any = Depends(get_settings_dep),
) -> dict[str, Any]:
    """Apply a user instruction to one variant — versioned, never destructive.

    The previous draft moves into the variant's version trail (§6.4: the
    tweaked draft replaces the column's draft; the previous draft is kept
    under Previous attempt — no silent overwrite).
    """
    set_doc = await db.variant_sets.find_one(
        {"id": data.set_id, "user_id": current_user["user_id"]}
    )
    if set_doc is None:
        raise HTTPException(status_code=404, detail="That variant set no longer exists.")
    index = data.variant_index
    if not 0 <= index < len(set_doc["variants"]):
        raise HTTPException(status_code=422, detail="That variant does not exist.")
    variant = set_doc["variants"][index]
    if variant.get("status") != "ready":
        raise HTTPException(
            status_code=409,
            detail="That variant failed to generate, so it can't be tweaked — generate a new set.",
        )

    try:
        format_code = normalize_format(set_doc["format"])
    except ValueError as exc:  # stored docs are engine-written; defensive
        raise HTTPException(status_code=422, detail=str(exc)) from None

    llm = await get_llm(
        current_user["user_id"], "openai", db=db, vault=vault, settings=settings
    )
    voice_block = await _voice_block(db, current_user["user_id"])
    briefs = {b.brief_id: b for b in VARIATION_BRIEFS[format_code]}
    brief = briefs.get(variant.get("brief_id", ""))
    if brief is None:
        raise HTTPException(
            status_code=409,
            detail="That variant's brief is no longer available — generate a new set.",
        )
    trends = [t for t in (set_doc.get("trends") or [])]
    user_message = assemble_user_message(
        idea_block=build_idea_block(
            set_doc["idea"],
            set_doc.get("insights"),
            tweak_instruction=data.instruction,
        ),
        format_contract=FORMAT_CONTRACTS[format_code],
        variant_block=brief_block(brief),
        trend_block=build_trend_block(
            trends, evidence_gaps=_insight_evidence_gaps(set_doc.get("insights"))
        ),
        voice_block=voice_block,
    )
    parsed = await complete_json_with_retry(
        llm,
        system=MASTER_SYSTEM_PROMPT,
        prompt=user_message,
        provider="openai",
        max_tokens=4000,
    )
    draft = parse_variant_output(parsed, provider="openai")
    usage = last_usage_of(llm)
    await record_usage_event(
        db,
        current_user["user_id"],
        VARIANT_TWEAKED,
        provider="openai",
        tokens_in=usage.tokens_in if usage else None,
        tokens_out=usage.tokens_out if usage else None,
        variant_id=f"{set_doc['id']}:{index}",
    )

    previous = {
        "version": len(variant.get("versions") or []) + 1,
        "post_text": variant["post_text"],
        "instruction": None,
        "tweaked_at": variant.get("generated_at"),
    }
    versions = [*variant.get("versions", []), previous]
    updated = {
        **variant,
        "post_text": draft["post_text"],
        "hook_pattern_id": draft.get("hook_pattern_id"),
        "sourced_claims": draft.get("sourced_claims") or [],
        "own_claims": draft.get("own_claims") or [],
        "speculative_claims": draft.get("speculative_claims") or [],
        "notes": draft.get("notes") or "",
        "versions": versions,
        "generated_at": _utc_now().isoformat(),
    }
    await db.variant_sets.update_one(
        {"id": set_doc["id"], "user_id": current_user["user_id"]},
        {
            "$set": {
                f"variants.{index}": updated,
                "updated_at": _utc_now().isoformat(),
            }
        },
    )
    cost_hint = build_cost_hint(
        "generate_variant",
        settings=settings,
        provider="openai",
        model=settings.openai_model,
        prompt_chars=len(user_message),
        output_tokens=estimate_output_tokens(format_code),
        k=index + 1,
    )
    return {"variant": updated, "cost_hint": cost_hint}


# --- legacy single-post routes (compatibility) -------------------------------
# Kept for pre-variant clients and smoke tests; they run through the same
# master engine (one call, no set persistence) so no route still ships the
# superseded scaffold prompt.


@router.post("/generate-post")
async def generate_post(
    data: GeneratePostRequest,
    current_user: dict[str, str] = Depends(get_current_user),
    db: Any = Depends(get_db),
    vault: Any = Depends(get_vault),
    settings: Any = Depends(get_settings_dep),
) -> dict[str, Any]:
    try:
        format_code = normalize_format(data.format)
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from None
    llm = await get_llm(
        current_user["user_id"], "openai", db=db, vault=vault, settings=settings
    )
    voice_block = await _voice_block(db, current_user["user_id"])
    user_message = assemble_user_message(
        idea_block=build_idea_block(
            data.idea, data.insights, custom_instructions=data.custom_instructions
        ),
        format_contract=FORMAT_CONTRACTS[format_code],
        variant_block=brief_block(VARIATION_BRIEFS[format_code][0]),
        trend_block=build_trend_block(
            [], evidence_gaps=_insight_evidence_gaps(data.insights)
        ),
        voice_block=voice_block,
    )
    parsed = await complete_json_with_retry(
        llm,
        system=MASTER_SYSTEM_PROMPT,
        prompt=user_message,
        provider="openai",
        max_tokens=4000,
    )
    draft = parse_variant_output(parsed, provider="openai")
    usage = last_usage_of(llm)
    await record_usage_event(
        db,
        current_user["user_id"],
        POST_DRAFTED,
        provider="openai",
        tokens_in=usage.tokens_in if usage else None,
        tokens_out=usage.tokens_out if usage else None,
    )
    cost_hint = build_cost_hint(
        "generate_post",
        settings=settings,
        provider="openai",
        model=settings.openai_model,
        prompt_chars=len(user_message),
        output_tokens=estimate_output_tokens(format_code),
    )
    return {"post": draft["post_text"], "cost_hint": cost_hint}


@router.post("/tweak-post")
async def tweak_post(
    data: TweakPostRequest,
    current_user: dict[str, str] = Depends(get_current_user),
    db: Any = Depends(get_db),
    vault: Any = Depends(get_vault),
    settings: Any = Depends(get_settings_dep),
) -> dict[str, Any]:
    try:
        format_code = normalize_format(data.format)
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from None
    llm = await get_llm(
        current_user["user_id"], "openai", db=db, vault=vault, settings=settings
    )
    voice_block = await _voice_block(db, current_user["user_id"])
    user_message = assemble_user_message(
        idea_block=build_idea_block(
            data.idea,
            None,
            tweak_instruction=(
                f"{data.tweak_instruction}\n\nCurrent draft to revise:\n\n{data.original_post}"
            ),
        ),
        format_contract=FORMAT_CONTRACTS[format_code],
        variant_block=brief_block(VARIATION_BRIEFS[format_code][0]),
        trend_block=build_trend_block([]),
        voice_block=voice_block,
    )
    parsed = await complete_json_with_retry(
        llm,
        system=MASTER_SYSTEM_PROMPT,
        prompt=user_message,
        provider="openai",
        max_tokens=4000,
    )
    draft = parse_variant_output(parsed, provider="openai")
    usage = last_usage_of(llm)
    await record_usage_event(
        db,
        current_user["user_id"],
        POST_TWEAKED,
        provider="openai",
        tokens_in=usage.tokens_in if usage else None,
        tokens_out=usage.tokens_out if usage else None,
    )
    cost_hint = build_cost_hint(
        "generate_post",
        settings=settings,
        provider="openai",
        model=settings.openai_model,
        prompt_chars=len(user_message),
        output_tokens=estimate_output_tokens(format_code),
    )
    return {"post": draft["post_text"], "cost_hint": cost_hint}
