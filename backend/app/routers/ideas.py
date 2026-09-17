"""Idea Forge routes: scored idea generation + structured insight cards.

Fail-loud: no key → 400 MISSING_KEYS; unparseable model JSON → 502
GENERATION_FAILED. The scaffold's fallback chain (Claude fails → GPT →
canned ideas with HTTP 200) is gone — canned ideas in particular were
fabricated data presented as real strategy.
"""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Depends

from app.deps import get_current_user, get_db, get_llm, get_settings_dep, get_vault
from app.models.ideas import GenerateIdeasRequest, IdeaInsightsRequest
from app.services.llm.prompts import (
    CLAUDE_IDEA_GENERATION_PROMPT,
    CLAUDE_INSIGHTS_PROMPT,
)
from app.services.llm.provider import parse_json_output

router = APIRouter()


def _trends_text(raw_trends: list[dict[str, Any]]) -> str:
    return "\n".join(
        f"- {trend['title']}: {trend['snippet']}" for trend in raw_trends[:8]
    )


@router.post("/generate-ideas")
async def generate_ideas(
    data: GenerateIdeasRequest,
    current_user: dict[str, str] = Depends(get_current_user),
    db: Any = Depends(get_db),
    vault: Any = Depends(get_vault),
    settings: Any = Depends(get_settings_dep),
) -> dict[str, Any]:
    llm = await get_llm(
        current_user["user_id"],
        "anthropic",
        db=db,
        vault=vault,
        settings=settings,
    )
    system = CLAUDE_IDEA_GENERATION_PROMPT.format(niche=data.niche, tone=data.tone)
    prompt = (
        f"Here are the current trends:\n{_trends_text(data.raw_trends)}\n\n"
        "Generate 5-6 LinkedIn post ideas based on these trends."
    )
    response = await llm.complete(system=system, prompt=prompt, json_mode=True)
    ideas = parse_json_output(response, provider="anthropic")
    return {"ideas": ideas}


@router.post("/idea-insights")
async def get_idea_insights(
    data: IdeaInsightsRequest,
    current_user: dict[str, str] = Depends(get_current_user),
    db: Any = Depends(get_db),
    vault: Any = Depends(get_vault),
    settings: Any = Depends(get_settings_dep),
) -> dict[str, Any]:
    llm = await get_llm(
        current_user["user_id"],
        "anthropic",
        db=db,
        vault=vault,
        settings=settings,
    )
    prompt = (
        f"Analyze this post idea for {data.niche} content with a {data.tone} tone:"
        f"\n\nTitle: {data.idea.get('title', '')}"
        f"\nRating: {data.idea.get('rating', 0)}"
        f"\nExplanation: {data.idea.get('rating_explanation', '')}"
    )
    response = await llm.complete(
        system=CLAUDE_INSIGHTS_PROMPT, prompt=prompt, json_mode=True
    )
    insights = parse_json_output(response, provider="anthropic")
    return insights
