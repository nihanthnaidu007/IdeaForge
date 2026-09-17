"""Async-native Tavily research client.

Replaces the scaffold's sync ``TavilyClient`` called inside ``async def`` —
that blocked the event loop on every research request. Queries run
concurrently over a shared ``httpx.AsyncClient``; every failure is a typed
error, and partial success returns only real, source-labeled results.
"""

from __future__ import annotations

import asyncio
from typing import Any

import httpx

from app.services.llm.provider import ProviderAuthError, ProviderError, ProviderQuotaError

_SEARCH_URL = "https://api.tavily.com/search"
_SNIPPET_LENGTH = 300


class ResearchError(Exception):
    """Tavily research failed — surfaced as 502 RESEARCH_FAILED, never synthetic trends."""

    status_code = 502
    kind = "RESEARCH_FAILED"
    provider = "tavily"

    def __init__(self, message: str) -> None:
        super().__init__(message)


class TavilyResearchService:
    def __init__(
        self,
        api_key: str,
        *,
        http_client: httpx.AsyncClient | None = None,
        timeout_seconds: float = 15.0,
        max_results_per_query: int = 3,
    ) -> None:
        # A shared app-lifetime client (connection pooling) is injected in prod;
        # the per-instance default keeps the service usable standalone/in tests.
        self._client = http_client or httpx.AsyncClient(timeout=timeout_seconds)
        self._owns_client = http_client is None
        self._api_key = api_key
        self._max_results = max_results_per_query

    async def aclose(self) -> None:
        if self._owns_client:
            await self._client.aclose()

    async def search(self, niche: str) -> list[dict[str, Any]]:
        """Run the standard three research queries; return real, source-labeled trends."""
        queries = [
            f"{niche} latest trends site:reddit.com",
            f"{niche} viral news today",
            f"trending {niche} topics LinkedIn",
        ]
        outcomes = await asyncio.gather(
            *(self._search_one(query) for query in queries),
            return_exceptions=True,
        )

        results: list[dict[str, Any]] = []
        failures: list[BaseException] = []
        for outcome in outcomes:
            if isinstance(outcome, BaseException):
                failures.append(outcome)
            else:
                results.extend(outcome)

        # Partial success returns the real results it did get. If nothing
        # succeeded, surface the most specific failure we have — loudly.
        if not results:
            provider_errors = [f for f in failures if isinstance(f, ProviderError)]
            if provider_errors:
                raise provider_errors[0]
            causes = ", ".join(
                sorted({f"{type(f).__name__}: {f}" for f in failures})
            )
            raise ResearchError(
                f"Tavily research failed for all {len(queries)} queries "
                f"({len(failures)} failures: {causes}) — check connectivity and retry."
            )
        return results

    async def _search_one(self, query: str) -> list[dict[str, Any]]:
        try:
            response = await self._client.post(
                _SEARCH_URL,
                json={
                    "api_key": self._api_key,
                    "query": query,
                    "max_results": self._max_results,
                    "include_raw_content": False,
                },
            )
        except httpx.TimeoutException as exc:
            raise ResearchError("Tavily request timed out — please retry.") from exc
        except httpx.HTTPError as exc:
            raise ResearchError(
                f"Tavily request failed ({exc.__class__.__name__}) — please retry."
            ) from exc

        if response.status_code in (401, 403):
            raise ProviderAuthError(
                "Tavily rejected the API key — please check Settings.", provider="tavily"
            )
        if response.status_code == 429:
            raise ProviderQuotaError(
                "Tavily rate limit hit — please retry shortly.", provider="tavily"
            )
        if response.status_code >= 400:
            raise ResearchError(
                f"Tavily returned HTTP {response.status_code} — please retry."
            )

        payload = response.json()
        return [
            {
                "title": result.get("title", ""),
                "snippet": (result.get("content") or "")[:_SNIPPET_LENGTH],
                "url": result.get("url", ""),
                "source": query,
            }
            for result in (payload.get("results") or [])
        ]
