"""Research service + route: async Tavily, typed failures, BYOK resolution.

The scaffold returned AI-invented "trends" on Tavily failure with HTTP 200 —
these tests pin the opposite contract: only real results succeed; every
failure is a typed error with an honest status.
"""

from __future__ import annotations

import httpx
import pytest
from app.services.llm.provider import ProviderAuthError, ProviderQuotaError
from app.services.research import ResearchError, TavilyResearchService

from tests.conftest import store_tavily_key

# --- fake httpx client ------------------------------------------------------


class FakeResponse:
    def __init__(self, status_code: int, payload: dict | None = None) -> None:
        self.status_code = status_code
        self._payload = payload or {}

    def json(self) -> dict:
        return self._payload


class FakeAsyncClient:
    """Returns the queued response for each post; repeats the last entry."""

    def __init__(self, responses: list[FakeResponse | Exception] | None = None) -> None:
        self._queue = list(responses or [])
        self.calls: list[dict] = []

    async def post(self, url: str, **kwargs) -> FakeResponse:
        self.calls.append({"url": url, **kwargs})
        index = min(len(self.calls) - 1, len(self._queue) - 1)
        outcome = self._queue[index]
        if isinstance(outcome, Exception):
            raise outcome
        return outcome

    async def aclose(self) -> None:
        return None


def _ok_response() -> FakeResponse:
    return FakeResponse(
        200,
        {
            "results": [
                {
                    "title": "Agents eat SaaS",
                    "content": "Everyone is rebuilding workflows around agents.",
                    "url": "https://example.com/agents",
                }
            ]
        },
    )


# --- service-level ----------------------------------------------------------


async def test_search_maps_results_with_source_labels() -> None:
    service = TavilyResearchService("k", http_client=FakeAsyncClient([_ok_response()]))
    results = await service.search("AI")
    assert len(results) == 3  # three queries × one result each
    assert results[0]["title"] == "Agents eat SaaS"
    assert results[0]["url"] == "https://example.com/agents"
    assert results[0]["source"].startswith("AI ")
    await service.aclose()


async def test_search_401_raises_provider_auth() -> None:
    service = TavilyResearchService("k", http_client=FakeAsyncClient([FakeResponse(401)]))
    with pytest.raises(ProviderAuthError):
        await service.search("AI")
    await service.aclose()


async def test_search_429_raises_provider_quota() -> None:
    service = TavilyResearchService("k", http_client=FakeAsyncClient([FakeResponse(429)]))
    with pytest.raises(ProviderQuotaError):
        await service.search("AI")
    await service.aclose()


async def test_search_500_raises_research_error() -> None:
    service = TavilyResearchService("k", http_client=FakeAsyncClient([FakeResponse(500)]))
    with pytest.raises(ResearchError):
        await service.search("AI")
    await service.aclose()


async def test_search_timeout_raises_research_error() -> None:
    service = TavilyResearchService(
        "k", http_client=FakeAsyncClient([httpx.TimeoutException("slow")])
    )
    with pytest.raises(ResearchError, match="timed out"):
        await service.search("AI")
    await service.aclose()


async def test_search_connection_error_raises_research_error() -> None:
    service = TavilyResearchService(
        "k", http_client=FakeAsyncClient([httpx.ConnectError("refused")])
    )
    with pytest.raises(ResearchError):
        await service.search("AI")
    await service.aclose()


async def test_total_failure_raises_instead_of_fabricating() -> None:
    service = TavilyResearchService(
        "k",
        http_client=FakeAsyncClient([FakeResponse(500), FakeResponse(500)]),
    )
    with pytest.raises(ResearchError, match="failed for all 3 queries"):
        await service.search("AI")
    await service.aclose()


async def test_partial_failure_returns_only_real_results() -> None:
    service = TavilyResearchService(
        "k",
        http_client=FakeAsyncClient(
            [_ok_response(), FakeResponse(500), httpx.TimeoutException("slow")]
        ),
    )
    results = await service.search("AI")
    assert len(results) == 1  # the one query that succeeded
    await service.aclose()


# --- route-level (BYOK resolution + fail-loud statuses) ---------------------


async def _register(client, email: str) -> dict[str, str]:
    response = await client.post(
        "/api/auth/register",
        json={"email": email, "password": "correct-horse-9"},
    )
    assert response.status_code == 200, response.text
    return {"Authorization": f"Bearer {response.json()['token']}"}


async def test_research_without_any_key_is_400_missing_keys(client) -> None:
    headers = await _register(client, "nokey@example.com")
    response = await client.post(
        "/api/research", json={"niche": "AI", "tone": "professional"}, headers=headers
    )
    assert response.status_code == 400
    assert response.json()["kind"] == "MISSING_KEYS"
    assert "tavily" in response.json()["detail"].lower()


class _AlwaysOkClient(FakeAsyncClient):
    async def post(self, url: str, **kwargs) -> FakeResponse:
        self.calls.append({"url": url, **kwargs})
        return _ok_response()


class _RejectingClient(FakeAsyncClient):
    async def post(self, url: str, **kwargs) -> FakeResponse:
        self.calls.append({"url": url, **kwargs})
        return FakeResponse(401)


async def test_research_with_stored_key_returns_real_trends(
    client, auth_headers
) -> None:
    await store_tavily_key(client, auth_headers)
    client._transport.app.state.http_client = _AlwaysOkClient()

    response = await client.post(
        "/api/research",
        json={"niche": "AI", "tone": "professional"},
        headers=auth_headers,
    )
    assert response.status_code == 200, response.text
    body = response.json()
    assert body["niche"] == "AI"
    assert len(body["raw_trends"]) == 3
    assert all(trend["url"] for trend in body["raw_trends"])


async def test_research_with_rejected_key_is_401(client, auth_headers) -> None:
    await store_tavily_key(client, auth_headers)
    client._transport.app.state.http_client = _RejectingClient()

    response = await client.post(
        "/api/research",
        json={"niche": "AI", "tone": "professional"},
        headers=auth_headers,
    )
    assert response.status_code == 401
    assert response.json()["kind"] == "PROVIDER_AUTH"
