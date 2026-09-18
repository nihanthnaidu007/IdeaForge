"""Trend Radar research route — async Tavily, fail loud.

The scaffold caught Tavily failures and returned AI-invented "trends" with
HTTP 200; a failed search is now a typed 502 and the only trends that reach
the client are real, source-labeled results.
"""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Depends

from app.deps import get_current_user, get_db, get_http_client, get_settings_dep, get_vault
from app.models.research import ResearchRequest
from app.services.llm.provider import resolve_user_key
from app.services.research import TavilyResearchService
from app.services.usage import RESEARCH_RUN, record_usage_event

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
    # Honest analytics: one event per real research run. Never written on
    # failure — a failed search produces no usage row, so counts stay true.
    await record_usage_event(
        db, current_user["user_id"], RESEARCH_RUN,
        provider="tavily", count=len(raw_trends),
    )
    return {"raw_trends": raw_trends, "niche": data.niche, "tone": data.tone}
