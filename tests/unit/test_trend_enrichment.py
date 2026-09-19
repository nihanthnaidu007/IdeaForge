"""Trend enrichment: one batched call, deterministic freshness, fail-open.

Spec (Wave 1, locked): a research run never fails because enrichment failed,
and a missing why_now/post_worthiness/freshness is never invented — it rides back as an
explicit null the frontend renders as "No signal yet". All stubs are
deterministic; no test touches a real provider API.
"""

from __future__ import annotations

import json
from datetime import UTC, datetime
from typing import Any

import pytest
from app.routers import research as research_module
from app.services.llm.provider import GenerationError, MissingKeyError
from app.services.trend_enrichment import (
    build_enrichment_block,
    derive_freshness,
    enrich_trends,
    merge_enrichment,
    normalize_trend_row,
)

from tests.conftest import store_tavily_key
from tests.unit.fakes import RecordingLLM

_NOW = datetime(2026, 9, 18, 12, 0, 0, tzinfo=UTC)


def _trend(title: str = "Agents eat SaaS", **overrides: Any) -> dict[str, Any]:
    row = {
        "title": title,
        "snippet": f"{title} — everyone is rebuilding workflows around agents.",
        "url": f"https://example.com/{title.lower().replace(' ', '-')}",
        "source": "AI agents",
        "published_at": None,
        "freshness": None,
        "why_now": None,
        "post_worthiness": None,
        "score_reason": None,
    }
    row.update(overrides)
    return row


def _enrichment_payload(entries: list[dict[str, Any]]) -> str:
    return json.dumps({"trends": entries})


# --- deterministic freshness -------------------------------------------------


@pytest.mark.parametrize(
    ("published", "expected"),
    [
        ("2026-09-17T00:00:00Z", "this_week"),  # 1 day old
        ("2026-09-11T12:00:00Z", "this_week"),  # exactly 7 days
        ("2026-09-10T12:00:00Z", "this_month"),  # 8 days
        ("2026-08-18T12:00:00Z", "this_month"),  # exactly 31 days
        ("2026-08-17T12:00:00Z", "older"),  # 32 days
    ],
)
def test_derive_freshness_buckets_are_deterministic(published: str, expected: str) -> None:
    assert derive_freshness(published, now=_NOW) == expected


@pytest.mark.parametrize("published", [None, "", "   ", "not a date at all", "2026-13-99"])
def test_derive_freshness_unknown_stays_unknown(published: str | None) -> None:
    assert derive_freshness(published, now=_NOW) is None


def test_derive_freshness_accepts_date_only_and_naive_timestamps() -> None:
    assert derive_freshness("2026-09-16", now=_NOW) == "this_week"
    assert derive_freshness("2026-09-18T00:00:00", now=_NOW) == "this_week"


# --- row normalization -------------------------------------------------------


def test_normalize_trend_row_starts_explicitly_unknown() -> None:
    row = normalize_trend_row(
        {"title": "Agents eat SaaS", "snippet": "s", "url": "u", "source": "q"}
    )
    assert row["why_now"] is None
    assert row["post_worthiness"] is None
    assert row["score_reason"] is None
    assert row["id"] is None


def test_normalize_trend_row_derives_freshness_from_published_at() -> None:
    row = normalize_trend_row({"title": "t", "published_at": "2026-09-17T00:00:00Z"})
    assert row["published_at"] == "2026-09-17T00:00:00Z"
    assert row["freshness"] == "this_week"


# --- the batched enrichment call ---------------------------------------------


async def test_enrich_trends_batches_whole_set_into_one_call() -> None:
    trends = [_trend("Trend One"), _trend("Trend Two"), _trend("Trend Three")]
    llm = RecordingLLM([_enrichment_payload([])])

    await enrich_trends(llm, trends, niche="AI")

    assert len(llm.calls) == 1  # batched — never one call per trend
    prompt = llm.calls[0]["prompt"]
    for trend in trends:
        assert trend["title"] in prompt
    assert "[2]" in prompt  # indexes are the merge key


async def test_enrich_trends_success_merges_fields() -> None:
    trends = [_trend("Trend One"), _trend("Trend Two")]
    llm = RecordingLLM(
        [
            _enrichment_payload(
                [
                    {
                        "index": 0,
                        "why_now": "Two top threads panic about the same deprecation.",
                        "post_worthiness": 8,
                        "score_reason": "Concrete deadline, high emotional charge.",
                    },
                    {
                        "index": 1,
                        "why_now": "A major vendor shipped support yesterday.",
                        "post_worthiness": 6,
                        "score_reason": "Broad but generic.",
                    },
                ]
            )
        ]
    )

    merged = await enrich_trends(llm, trends, niche="AI")

    assert merged[0]["why_now"].startswith("Two top threads")
    assert merged[0]["post_worthiness"] == 8
    assert merged[0]["score_reason"] == "Concrete deadline, high emotional charge."
    assert merged[1]["post_worthiness"] == 6


async def test_enrich_trends_partial_answer_leaves_missing_unknown() -> None:
    trends = [_trend("Trend One"), _trend("Trend Two"), _trend("Trend Three")]
    llm = RecordingLLM(
        [
            _enrichment_payload(
                [{"index": 1, "why_now": "Vendor shipped support.", "post_worthiness": 7}]
            )
        ]
    )

    merged = await enrich_trends(llm, trends, niche="AI")

    assert merged[1]["why_now"] == "Vendor shipped support."
    assert merged[1]["post_worthiness"] == 7
    # Indices the model did not answer stay explicitly unknown — not synthesized.
    for index in (0, 2):
        assert merged[index]["why_now"] is None
        assert merged[index]["post_worthiness"] is None
        assert merged[index]["score_reason"] is None


async def test_enrich_trends_invalid_fields_render_unknown() -> None:
    trends = [_trend("Trend One"), _trend("Trend Two")]
    llm = RecordingLLM(
        [
            _enrichment_payload(
                [
                    {  # out-of-range post_worthiness → unknown; valid why_now survives
                        "index": 0,
                        "why_now": "Deprecation window announced.",
                        "post_worthiness": 99,
                        "score_reason": "n",
                    },
                    {  # non-numeric post_worthiness and non-string why_now → unknown
                        "index": 1,
                        "why_now": 42,
                        "post_worthiness": "great",
                    },
                    {"index": 7, "why_now": "Hallucinated index is dropped."},
                ]
            )
        ]
    )

    merged = await enrich_trends(llm, trends, niche="AI")

    assert merged[0]["why_now"] == "Deprecation window announced."
    assert merged[0]["post_worthiness"] is None
    assert merged[1]["why_now"] is None
    assert merged[1]["post_worthiness"] is None


async def test_enrich_trends_wrong_payload_shape_is_fail_open() -> None:
    trends = [_trend("Trend One")]
    llm = RecordingLLM([json.dumps({"unrelated": "shape"})])

    merged = await enrich_trends(llm, trends, niche="AI")

    assert merged[0]["why_now"] is None
    assert merged[0]["post_worthiness"] is None


async def test_enrich_trends_unparseable_json_raises_for_router_fail_open() -> None:
    llm = RecordingLLM(["this is not json", "still not json"])

    with pytest.raises(GenerationError):
        await enrich_trends(llm, [_trend("Trend One")], niche="AI")


def test_merge_enrichment_handles_bare_array_payload() -> None:
    trends = [_trend("Trend One")]
    merged = merge_enrichment(
        trends, [{"index": 0, "why_now": "Window is open.", "post_worthiness": 9}]
    )
    assert merged[0]["post_worthiness"] == 9


def test_build_enrichment_block_includes_published_when_known() -> None:
    block = build_enrichment_block([_trend(published_at="2026-09-17T00:00:00Z")])
    assert "published: 2026-09-17T00:00:00Z" in block
    assert "unknown" not in block


# --- router integration: fail-open + cache round trip ------------------------


class _FakeResponse:
    def __init__(self, status_code: int, payload: dict[str, Any]) -> None:
        self.status_code = status_code
        self._payload = payload

    def json(self) -> dict[str, Any]:
        return self._payload


class _AlwaysOkTavily:
    """Returns the same 200 payload for every Tavily query."""

    def __init__(self, payload: dict[str, Any]) -> None:
        self._payload = payload

    async def post(self, url: str, **kwargs: Any) -> _FakeResponse:
        return _FakeResponse(200, self._payload)

    async def aclose(self) -> None:
        return None


def _tavily_payload() -> dict[str, Any]:
    return {
        "results": [
            {
                "title": "Agents eat SaaS",
                "content": "Everyone is rebuilding workflows around agents.",
                "url": "https://example.com/agents",
                "published_date": "2026-09-17T00:00:00Z",
            }
        ]
    }


async def test_research_fail_open_on_enrichment_failure(
    client, auth_headers, monkeypatch
) -> None:
    """No LLM key (or a dead enrichment call) → real trends, explicit nulls."""
    await store_tavily_key(client, auth_headers)
    client._transport.app.state.http_client = _AlwaysOkTavily(_tavily_payload())

    async def _failing_llm(*args: Any, **kwargs: Any) -> Any:
        raise MissingKeyError("No OpenAI or Anthropic API key configured.")

    monkeypatch.setattr(research_module, "get_llm", _failing_llm)

    response = await client.post(
        "/api/research",
        json={"niche": "AI", "tone": "professional"},
        headers=auth_headers,
    )
    assert response.status_code == 200, response.text
    trends = response.json()["raw_trends"]
    assert len(trends) == 3
    for trend in trends:
        # Explicit presence of the fields — absent keys would push the
        # frontend into synthesizing values, which is the forbidden path.
        assert "why_now" in trend and trend["why_now"] is None
        assert "post_worthiness" in trend and trend["post_worthiness"] is None
        assert "score_reason" in trend and trend["score_reason"] is None
        # Freshness is deterministic, so it survives the enrichment outage.
        assert trend["freshness"] == "this_week"
        assert trend["id"]  # cacheable rows keep their per-trend forge id


async def test_research_enriches_and_caches_with_ids(
    client, auth_headers, monkeypatch
) -> None:
    await store_tavily_key(client, auth_headers)
    client._transport.app.state.http_client = _AlwaysOkTavily(_tavily_payload())
    llm = RecordingLLM(
        [
            _enrichment_payload(
                [
                    {
                        "index": 0,
                        "why_now": "Two top threads panic about the same deprecation.",
                        "post_worthiness": 8,
                        "score_reason": "Concrete deadline.",
                    }
                ]
            )
        ]
    )

    async def _llm(*args: Any, **kwargs: Any) -> Any:
        return llm

    monkeypatch.setattr(research_module, "get_llm", _llm)

    response = await client.post(
        "/api/research",
        json={"niche": "AI", "tone": "professional"},
        headers=auth_headers,
    )
    assert response.status_code == 200, response.text
    trends = response.json()["raw_trends"]
    assert trends[0]["why_now"].startswith("Two top threads")
    assert trends[0]["post_worthiness"] == 8
    assert trends[0]["id"]

    app = client._transport.app
    docs = await app.state.db.trend_cache.find({}).to_list(None)
    assert len(docs) == 3  # every validated row is cached for per-trend forge
    cached = next(doc for doc in docs if doc["id"] == trends[0]["id"])
    assert cached["why_now"] == trends[0]["why_now"]
    assert cached["post_worthiness"] == 8
    assert cached["user_id"]  # user-scoped docs; owner asserted in test_trend_forge
