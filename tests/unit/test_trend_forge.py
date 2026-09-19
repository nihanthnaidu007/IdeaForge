"""Per-trend forge: trend_ids scoping, typed 404s, request validation.

Spec (Wave 1): idea generation scoped to the cached trends' content — no
re-search, no extra Tavily spend, same single ideas call otherwise; an
unknown/expired/foreign trend id is a typed 404, never a silent fallback to
unscoped forging.
"""

from __future__ import annotations

import json
from datetime import UTC, datetime, timedelta
from typing import Any

from app.routers import ideas as ideas_module

from tests.conftest import store_tavily_key
from tests.unit.fakes import FakeDatabase, RecordingLLM

_NOW = datetime(2026, 9, 18, 12, 0, 0, tzinfo=UTC)

_SELECTABLE = {
    "id": "trend_a1b2",
    "title": "Agents eating eval budgets",
    "snippet": "Teams discover orchestration costs, not model costs, blow up spend.",
    "url": "https://example.com/agents-evals",
    "source": "AI agents",
    "why_now": "Two of the last three top threads panic about the same window.",
    "post_worthiness": 8,
    "score_reason": "Concrete deadline, high emotional charge.",
}
_DECOY = {
    "id": "trend_c3d4",
    "title": "Decoy trend nobody selected",
    "snippet": "This row must never reach the forge prompt.",
    "url": "https://example.com/decoy",
    "source": "AI agents",
    "why_now": "Decoy why-now.",
    "post_worthiness": 3,
    "score_reason": "Noise.",
}

_IDEAS_JSON = json.dumps(
    [
        {"title": "Idea A", "rating": 8.0, "rating_explanation": "strong"},
        {"title": "Idea B", "rating": 7.0, "rating_explanation": "solid"},
    ]
)


async def _seed_trend(
    db: FakeDatabase,
    row: dict[str, Any],
    *,
    user_id: str,
    expires_at: datetime | None = None,
) -> None:
    await db.trend_cache.insert_one(
        {
            **row,
            "user_id": user_id,
            "created_at": _NOW - timedelta(days=1),
            "expires_at": expires_at or _NOW + timedelta(days=7),
        }
    )


async def _authed_user_id(client) -> str:
    users = await client._transport.app.state.db.users.find({}).to_list(None)
    return users[0]["id"]


def _llm_returning(llm: RecordingLLM):
    async def _llm(*args: Any, **kwargs: Any) -> Any:
        return llm

    return _llm


async def test_per_trend_forge_scopes_prompt_to_cached_trends(
    client, auth_headers, monkeypatch
) -> None:
    user_id = await _authed_user_id(client)
    db = client._transport.app.state.db
    await _seed_trend(db, _SELECTABLE, user_id=user_id)
    await _seed_trend(db, _DECOY, user_id=user_id)
    llm = RecordingLLM([_IDEAS_JSON])
    monkeypatch.setattr(ideas_module, "get_llm", _llm_returning(llm))

    response = await client.post(
        "/api/generate-ideas",
        json={"trend_ids": ["trend_a1b2"], "niche": "AI", "tone": "professional"},
        headers=auth_headers,
    )
    assert response.status_code == 200, response.text
    body = response.json()
    assert [idea["title"] for idea in body["ideas"]] == ["Idea A", "Idea B"]

    assert len(llm.calls) == 1  # same single ideas call — no re-search
    prompt = llm.calls[0]["prompt"]
    # Scoped to the cached trend's content: title, snippet, why_now, source url.
    assert "Agents eating eval budgets" in prompt
    assert "orchestration costs, not model costs" in prompt
    assert "Two of the last three top threads" in prompt
    assert "https://example.com/agents-evals" in prompt
    # The unselected cached trend never leaks into the prompt.
    assert "Decoy trend nobody selected" not in prompt


async def test_per_trend_forge_unknown_id_is_404(client, auth_headers, monkeypatch) -> None:
    llm = RecordingLLM([_IDEAS_JSON])
    monkeypatch.setattr(ideas_module, "get_llm", _llm_returning(llm))

    response = await client.post(
        "/api/generate-ideas",
        json={"trend_ids": ["trend_missing"], "niche": "AI", "tone": "professional"},
        headers=auth_headers,
    )
    assert response.status_code == 404, response.text
    assert response.json()["kind"] == "TRENDS_NOT_FOUND"
    assert llm.calls == []  # no spend on an unforgeable scope


async def test_per_trend_forge_expired_id_is_404(client, auth_headers, monkeypatch) -> None:
    user_id = await _authed_user_id(client)
    db = client._transport.app.state.db
    await _seed_trend(
        db, _SELECTABLE, user_id=user_id, expires_at=_NOW - timedelta(seconds=1)
    )
    llm = RecordingLLM([_IDEAS_JSON])
    monkeypatch.setattr(ideas_module, "get_llm", _llm_returning(llm))

    response = await client.post(
        "/api/generate-ideas",
        json={"trend_ids": ["trend_a1b2"], "niche": "AI", "tone": "professional"},
        headers=auth_headers,
    )
    assert response.status_code == 404
    assert response.json()["kind"] == "TRENDS_NOT_FOUND"
    assert llm.calls == []


async def test_per_trend_forge_rejects_foreign_trend_ids(
    client, auth_headers, monkeypatch
) -> None:
    db = client._transport.app.state.db
    await _seed_trend(db, _SELECTABLE, user_id="someone-else")
    llm = RecordingLLM([_IDEAS_JSON])
    monkeypatch.setattr(ideas_module, "get_llm", _llm_returning(llm))

    response = await client.post(
        "/api/generate-ideas",
        json={"trend_ids": ["trend_a1b2"], "niche": "AI", "tone": "professional"},
        headers=auth_headers,
    )
    assert response.status_code == 404
    assert response.json()["kind"] == "TRENDS_NOT_FOUND"
    assert llm.calls == []


async def test_per_trend_forge_deduplicates_repeated_ids(
    client, auth_headers, monkeypatch
) -> None:
    user_id = await _authed_user_id(client)
    db = client._transport.app.state.db
    await _seed_trend(db, _SELECTABLE, user_id=user_id)
    llm = RecordingLLM([_IDEAS_JSON])
    monkeypatch.setattr(ideas_module, "get_llm", _llm_returning(llm))

    response = await client.post(
        "/api/generate-ideas",
        json={
            "trend_ids": ["trend_a1b2", "trend_a1b2"],
            "niche": "AI",
            "tone": "professional",
        },
        headers=auth_headers,
    )
    assert response.status_code == 200, response.text
    assert len(llm.calls) == 1
    assert llm.calls[0]["prompt"].count("Agents eating eval budgets") == 1


async def test_forge_rejects_raw_trends_and_trend_ids_together(client, auth_headers) -> None:
    response = await client.post(
        "/api/generate-ideas",
        json={
            "trend_ids": ["trend_a1b2"],
            "raw_trends": [{"title": "Both sources is ambiguous"}],
            "niche": "AI",
            "tone": "professional",
        },
        headers=auth_headers,
    )
    assert response.status_code == 422


async def test_forge_requires_a_trend_source(client, auth_headers) -> None:
    response = await client.post(
        "/api/generate-ideas",
        json={"niche": "AI", "tone": "professional"},
        headers=auth_headers,
    )
    assert response.status_code == 422


async def test_research_then_forge_round_trip(client, auth_headers, monkeypatch) -> None:
    """The id the research route returns must be immediately forgeable."""
    from app.routers import research as research_module

    from tests.unit.test_trend_enrichment import _AlwaysOkTavily, _tavily_payload

    await store_tavily_key(client, auth_headers)
    client._transport.app.state.http_client = _AlwaysOkTavily(_tavily_payload())
    enrichment_llm = RecordingLLM([json.dumps({"trends": []})])
    monkeypatch.setattr(research_module, "get_llm", _llm_returning(enrichment_llm))

    research_response = await client.post(
        "/api/research",
        json={"niche": "AI", "tone": "professional"},
        headers=auth_headers,
    )
    assert research_response.status_code == 200, research_response.text
    trend_ids = [
        trend["id"] for trend in research_response.json()["raw_trends"] if trend["id"]
    ]
    assert trend_ids

    forge_llm = RecordingLLM([_IDEAS_JSON])
    monkeypatch.setattr(ideas_module, "get_llm", _llm_returning(forge_llm))

    forge_response = await client.post(
        "/api/generate-ideas",
        json={"trend_ids": trend_ids[:1], "niche": "AI", "tone": "professional"},
        headers=auth_headers,
    )
    assert forge_response.status_code == 200, forge_response.text
    prompt = forge_llm.calls[0]["prompt"]
    assert "Agents eat SaaS" in prompt
