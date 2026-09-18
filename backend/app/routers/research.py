"""Trend Radar research route — async Tavily + fail-open trend enrichment.

The scaffold caught Tavily failures and returned AI-invented "trends" with
HTTP 200; a failed search is still a typed 502 and the only trends that reach
the client are real, source-labeled results. On top of that, every run now
carries the Trend Radar's enrichment fields: freshness derived from the
source's own published timestamp, and why-now/score from ONE batched
JSON-mode LLM call. Enrichment is fail-open (spec, locked invariant): when it
fails or a field is missing, the trend still renders with the field
explicitly unknown — never invented, never a failed research run.
"""

from __future__ import annotations

import logging
from typing import Any

from fastapi import APIRouter, Depends

from app.deps import (
    get_current_user,
    get_db,
    get_http_client,
    get_llm,
    get_settings_dep,
    get_vault,
)
from app.models.research import ResearchRequest
from app.services.llm.provider import resolve_user_key
from app.services.research import TavilyResearchService
from app.services.trend_cache import cache_trends
from app.services.trend_enrichment import enrich_trends, normalize_trend_row
from app.services.usage import RESEARCH_RUN, record_usage_event

logger = logging.getLogger("app.research")

router = APIRouter()


@router.post("/research")
async def research_trends(
    data: ResearchRequest,
    current_user: dict[str, str] = Depends(get_current_user),
    db: Any = Depends(get_db),
    vault: Any = Depends(get_vault),
    settings: Any = Depends(get_settings_dep),
    http_client: Any = Depends(get_http_client),
) -> dict[str, Any]:
    # resolve_user_key raises MissingKeyError (400 + setup guidance) when the
    # user has no Tavily key and the operator set no server default.
    tavily_key = await resolve_user_key(
        db, vault, current_user["user_id"], "tavily", settings
    )
    service = TavilyResearchService(
        str(tavily_key), http_client=http_client, base_url=settings.tavily_base_url
    )
    raw_trends = await service.search(data.niche)
    # Deterministic fields first: freshness derives from the source's own
    # published_at, so it survives any enrichment outage untouched.
    trends = [normalize_trend_row(row) for row in raw_trends]
    try:
        # "auto" = BYOK presence decides the provider (no hardcoded
        # anthropic/openai requirement for research users). A user with only
        # a Tavily key still gets real trends — unenriched, fields explicit.
        llm = await get_llm(
            current_user["user_id"],
            "auto",
            db=db,
            vault=vault,
            settings=settings,
        )
        trends = await enrich_trends(llm, trends, niche=data.niche)
    except Exception:
        # Fail-open invariant: enrichment failure never fails research and
        # never invents values — the unknown fields ride back as explicit
        # nulls the frontend renders as "No signal yet". Logged, not silent.
        logger.warning(
            "trend enrichment failed — returning unenriched trends", exc_info=True
        )
    # Per-trend forge: cache writes ids onto the rows that validated. A failed
    # write drops that row's id (the forge would only 404 on a dead id).
    trends = await cache_trends(
        db,
        user_id=current_user["user_id"],
        niche=data.niche,
        trends=trends,
        ttl_hours=settings.trend_cache_ttl_hours,
    )
    # Honest analytics: one event per real research run. Never written on
    # failure — a failed search produces no usage row, so counts stay true.
    await record_usage_event(
        db, current_user["user_id"], RESEARCH_RUN,
        provider="tavily", count=len(raw_trends),
    )
    return {"raw_trends": trends, "niche": data.niche, "tone": data.tone}
