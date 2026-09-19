"""Idea Forge routes: scored idea generation + structured insight cards.

Fail-loud: no key → 400 MISSING_KEYS; unparseable model JSON → 502
GENERATION_FAILED; a trend context that cannot support the idea → 502
INSUFFICIENT_EVIDENCE (§5.2 — the fix is better research, not a retry);
an unknown/expired per-trend forge id → 404 TRENDS_NOT_FOUND, never a
silent fallback to unscoped generation.
The scaffold's fallback chain (Claude fails → GPT → canned ideas with HTTP
200) is gone — canned ideas in particular were fabricated data presented as
real strategy.
"""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Depends
from pydantic import ValidationError

from app.deps import get_current_user, get_db, get_llm, get_settings_dep, get_vault
from app.models.ideas import GenerateIdeasRequest, IdeaInsightsRequest, InsightCard
from app.models.research import TrendItem
from app.services.cost_hints import build_cost_hint
from app.services.llm.prompts import (
    CLAUDE_IDEA_GENERATION_PROMPT,
    INSIGHT_CARD_OUTPUT_SCHEMA,
    INSIGHT_CARD_SYSTEM_PROMPT,
    INSIGHT_CARD_USER_TEMPLATE,
)
from app.services.llm.provider import (
    GenerationError,
    InsufficientEvidenceError,
    last_usage_of,
    parse_json_output,
)
from app.services.onboarding import STEP_FIRST_FORGE, advance_on_event
from app.services.trend_cache import load_trends_for_forge
from app.services.usage import (
    IDEAS_GENERATED,
    INSIGHT_CARD_GENERATED,
    record_usage_event,
)
from app.services.variants import build_trend_block, estimate_output_tokens

router = APIRouter()


def _trends_text(raw_trends: list[TrendItem]) -> str:
    # M4: rows are validated TrendItems, so direct attribute access is safe —
    # raw dict indexing here turned a missing client key into a 500 KeyError.
    # why_now and the source label ride along when present: per-trend forge
    # scopes generation to the cached trends' content, which includes the
    # enrichment the research run produced.
    lines: list[str] = []
    for trend in raw_trends[:8]:
        line = f"- {trend.title}: {trend.snippet}"
        if trend.why_now:
            line += f" Why now: {trend.why_now}"
        if trend.url:
            label = trend.source or trend.url
            line += f" [source: {label}]({trend.url})"
        lines.append(line)
    return "\n".join(lines)


@router.post("/generate-ideas")
async def generate_ideas(
    data: GenerateIdeasRequest,
    current_user: dict[str, str] = Depends(get_current_user),
    db: Any = Depends(get_db),
    vault: Any = Depends(get_vault),
    settings: Any = Depends(get_settings_dep),
) -> dict[str, Any]:
    if data.trend_ids:
        # Per-trend forge: scope generation to the server-cached trends'
        # content — no re-search, no extra Tavily spend, same single model
        # call otherwise. Unknown/expired ids are a typed 404 from the cache
        # (never a silent fallback to unscoped forging).
        cached_trends = await load_trends_for_forge(
            db, user_id=current_user["user_id"], trend_ids=data.trend_ids
        )
        trends_text = _trends_text(cached_trends)
        task = (
            "Generate 5-6 LinkedIn post ideas based specifically on these "
            "selected trends."
        )
    else:
        trends_text = _trends_text(data.raw_trends)
        task = "Generate 5-6 LinkedIn post ideas based on these trends."
    llm = await get_llm(
        current_user["user_id"],
        "anthropic",
        db=db,
        vault=vault,
        settings=settings,
    )
    system = CLAUDE_IDEA_GENERATION_PROMPT.format(niche=data.niche, tone=data.tone)
    prompt = f"Here are the current trends:\n{trends_text}\n\n{task}"
    response = await llm.complete(system=system, prompt=prompt, json_mode=True)
    ideas = parse_json_output(response, provider="anthropic")
    usage = last_usage_of(llm)
    # Honest analytics: one event per successful generation, with the token
    # counts the SDK reported. Failures above never reach this line.
    await record_usage_event(
        db, current_user["user_id"], IDEAS_GENERATED,
        provider="anthropic", count=len(ideas) if isinstance(ideas, list) else 1,
        tokens_in=usage.tokens_in if usage else None,
        tokens_out=usage.tokens_out if usage else None,
    )
    # Onboarding auto-advance (spec §Onboarding): a successful forge IS the
    # first-forge event — the checklist mirrors reality. Fail-open, logged.
    await advance_on_event(db, current_user["user_id"], STEP_FIRST_FORGE)
    cost_hint = build_cost_hint(
        "forge_ideas",
        settings=settings,
        provider="anthropic",
        model=settings.anthropic_model,
        prompt_chars=len(prompt),
        n=len(ideas) if isinstance(ideas, list) and ideas else None,
    )
    return {"ideas": ideas, "cost_hint": cost_hint}


@router.post("/idea-insights")
async def get_idea_insights(
    data: IdeaInsightsRequest,
    current_user: dict[str, str] = Depends(get_current_user),
    db: Any = Depends(get_db),
    vault: Any = Depends(get_vault),
    settings: Any = Depends(get_settings_dep),
) -> dict[str, Any]:
    """Structured insight card for one idea (craft pack §5).

    The card carries the audience, why-it-matters, key aspects with their
    tensions, exactly three post angles in distinct formats, and the evidence
    gaps the variant engine later refuses on. Card output is validated against
    the InsightCard schema; anything malformed is a typed failure, never a
    partially-filled card presented as complete.
    """
    llm = await get_llm(
        current_user["user_id"],
        "anthropic",
        db=db,
        vault=vault,
        settings=settings,
    )
    idea = data.idea
    prompt = INSIGHT_CARD_USER_TEMPLATE.format(
        researched_at=data.researched_at or "unknown date",
        trend_block=build_trend_block(data.trends),
        title=idea.get("title", ""),
        angle=idea.get("rating_explanation", ""),
        derivation=str(idea.get("derivation") or "not provided"),
        audience=idea.get("targeted_audience")
        or "infer from the idea and trend context",
        aspects="3-5",
        insight_card_schema=INSIGHT_CARD_OUTPUT_SCHEMA,
    )
    response = await llm.complete(
        system=INSIGHT_CARD_SYSTEM_PROMPT, prompt=prompt, json_mode=True
    )
    parsed = parse_json_output(response, provider="anthropic")
    if isinstance(parsed, dict) and parsed.get("error") == "insufficient_evidence":
        raise InsufficientEvidenceError(
            str(parsed.get("reason", "The trend context cannot support this idea.")),
            provider="anthropic",
        )
    try:
        card = InsightCard.model_validate(parsed)
    except ValidationError as exc:
        raise GenerationError(
            "The model's insight card was incomplete. Please retry.",
            provider="anthropic",
        ) from exc
    usage = last_usage_of(llm)
    await record_usage_event(
        db, current_user["user_id"], INSIGHT_CARD_GENERATED,
        provider="anthropic",
        tokens_in=usage.tokens_in if usage else None,
        tokens_out=usage.tokens_out if usage else None,
    )
    cost_hint = build_cost_hint(
        "insight_card_refresh" if data.refresh else "insight_card_first",
        settings=settings,
        provider="anthropic",
        model=settings.anthropic_model,
        prompt_chars=len(prompt),
        output_tokens=estimate_output_tokens("how_to"),  # nearest long-form band
    )
    return {"insights": card.model_dump(), "cost_hint": cost_hint}
