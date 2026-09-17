"""Post routes: generate, regenerate, tweak.

Regenerate remains a pass-through to the same generation function until the
real variant engine (spec deliverable #4) replaces it — flagged in the PR, not
silently shipped as "variants". Generation goes through the LLM seam: no key →
400, provider failure → typed error, never a canned post with HTTP 200.
"""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Depends

from app.deps import get_current_user, get_db, get_llm, get_settings_dep, get_vault
from app.models.posts import GeneratePostRequest, TweakPostRequest
from app.services.llm.prompts import GPT_POST_WRITING_PROMPT

router = APIRouter()


def _insights_context(insights: dict[str, Any] | None) -> str:
    if not insights:
        return ""
    aspects = ", ".join(insights.get("key_aspects", []))
    return (
        f"\nTarget Audience: {insights.get('targeted_audience', '')}"
        f"\nWhy It Matters: {insights.get('why_it_matters', '')}"
        f"\nKey Aspects to Cover: {aspects}\n"
    )


async def _generate_post(
    data: GeneratePostRequest,
    *,
    db: Any,
    vault: Any,
    settings: Any,
    user_id: str,
) -> dict[str, str]:
    llm = await get_llm(user_id, "openai", db=db, vault=vault, settings=settings)
    custom = (
        f"\n\nAdditional instructions: {data.custom_instructions}"
        if data.custom_instructions
        else ""
    )
    prompt = (
        f"Write a LinkedIn post about: {data.idea.get('title', '')}\n\n"
        f"Tone: {data.tone}\n"
        f"Format: {data.format}\n"
        f"{_insights_context(data.insights)}\n"
        f"{custom}\n\n"
        "Write the post now."
    )
    response = await llm.complete(system=GPT_POST_WRITING_PROMPT, prompt=prompt)
    return {"post": response.strip()}


@router.post("/generate-post")
async def generate_post(
    data: GeneratePostRequest,
    current_user: dict[str, str] = Depends(get_current_user),
    db: Any = Depends(get_db),
    vault: Any = Depends(get_vault),
    settings: Any = Depends(get_settings_dep),
) -> dict[str, str]:
    return await _generate_post(
        data, db=db, vault=vault, settings=settings, user_id=current_user["user_id"]
    )


@router.post("/regenerate-post")
async def regenerate_post(
    data: GeneratePostRequest,
    current_user: dict[str, str] = Depends(get_current_user),
    db: Any = Depends(get_db),
    vault: Any = Depends(get_vault),
    settings: Any = Depends(get_settings_dep),
) -> dict[str, str]:
    # Real variants (distinct angle/hook/energy) land with the variants PR.
    return await _generate_post(
        data, db=db, vault=vault, settings=settings, user_id=current_user["user_id"]
    )


@router.post("/tweak-post")
async def tweak_post(
    data: TweakPostRequest,
    current_user: dict[str, str] = Depends(get_current_user),
    db: Any = Depends(get_db),
    vault: Any = Depends(get_vault),
    settings: Any = Depends(get_settings_dep),
) -> dict[str, str]:
    llm = await get_llm(
        current_user["user_id"],
        "openai",
        db=db,
        vault=vault,
        settings=settings,
    )
    prompt = (
        f"Here is the original LinkedIn post:\n\n{data.original_post}\n\n"
        f"Please modify it based on this instruction: {data.tweak_instruction}\n\n"
        f"Keep the same format ({data.format}) and maintain the core message about "
        f"\"{data.idea.get('title', '')}\".\n\n"
        "Write the updated post now."
    )
    response = await llm.complete(system=GPT_POST_WRITING_PROMPT, prompt=prompt)
    return {"post": response.strip()}
