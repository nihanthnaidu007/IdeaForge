"""Honest analytics: usage events aggregate into streaks; nothing fabricated.

Covers the aggregation math (pure functions), the event write path (never
breaks the user's action, never silent on failure), the route wiring (events
only on real successes), and the summary endpoint (user-scoped, real zeros).
"""

from __future__ import annotations

import json
from datetime import UTC, datetime, timedelta
from typing import Any

import bson
from app.services.analytics import (
    _MAX_TZ_OFFSET,
    _TIMELINE_DAYS,
    aggregate_manual_metrics,
    aggregate_usage,
)
from app.services.llm.provider import TokenUsage
from app.services.usage import (
    IDEAS_GENERATED,
    POST_DRAFTED,
    RESEARCH_RUN,
    build_usage_event,
    record_usage_event,
)

from tests.conftest import store_tavily_key
from tests.unit.fakes import FakeDatabase

# --- helpers -----------------------------------------------------------------


def _event(
    event: str,
    at: datetime,
    *,
    tokens_in: int | None = None,
    tokens_out: int | None = None,
    count: int | None = None,
) -> dict[str, Any]:
    doc: dict[str, Any] = {"event": event, "at": at}
    if tokens_in is not None:
        doc["tokens_in"] = tokens_in
    if tokens_out is not None:
        doc["tokens_out"] = tokens_out
    if count is not None:
        doc["count"] = count
    return doc


def _utc(*args: int) -> datetime:
    return datetime(*args, tzinfo=UTC)


# --- aggregation: streaks -----------------------------------------------------


def test_empty_history_is_real_zeros() -> None:
    summary = aggregate_usage([], _utc(2026, 9, 17, 12, 0))
    assert summary["total_events"] == 0
    assert summary["counts"] == {"by_event": {}, "total": 0}
    assert summary["streaks"] == {"current": 0, "longest": 0, "active_days_30": 0}
    assert len(summary["timeline"]) == _TIMELINE_DAYS
    assert all(day["total"] == 0 for day in summary["timeline"])  # type: ignore[index]


def test_streak_counts_consecutive_days() -> None:
    now = _utc(2026, 9, 17, 12, 0)
    days = [now - timedelta(days=i, hours=1) for i in range(4)]
    summary = aggregate_usage(
        [_event(RESEARCH_RUN, day) for day in days], now
    )
    assert summary["streaks"]["current"] == 4
    assert summary["streaks"]["longest"] == 4


def test_missing_today_does_not_break_current_streak() -> None:
    """No events yet today ≠ streak broken — yesterday anchors the count."""
    now = _utc(2026, 9, 17, 12, 0)
    days = [now - timedelta(days=i, hours=2) for i in range(1, 6)]
    summary = aggregate_usage(
        [_event(POST_DRAFTED, day) for day in days], now
    )
    assert summary["streaks"]["current"] == 5


def test_gap_breaks_the_streak_but_longest_survives() -> None:
    now = _utc(2026, 9, 17, 12, 0)
    events = [
        # a 3-day run, a 3-day gap, then a 2-day run ending yesterday
        _event(RESEARCH_RUN, now - timedelta(days=8, hours=1)),
        _event(RESEARCH_RUN, now - timedelta(days=9, hours=1)),
        _event(RESEARCH_RUN, now - timedelta(days=10, hours=1)),
        _event(POST_DRAFTED, now - timedelta(days=1, hours=1)),
        _event(POST_DRAFTED, now - timedelta(days=2, hours=1)),
    ]
    summary = aggregate_usage(events, now)
    assert summary["streaks"]["current"] == 2
    assert summary["streaks"]["longest"] == 3


def test_counts_by_event_type() -> None:
    now = _utc(2026, 9, 17, 12, 0)
    events = [
        _event(RESEARCH_RUN, now),
        _event(RESEARCH_RUN, now - timedelta(hours=1)),
        _event(IDEAS_GENERATED, now - timedelta(hours=2), count=6),
    ]
    summary = aggregate_usage(events, now)
    assert summary["counts"]["by_event"] == {
        RESEARCH_RUN: 2,
        IDEAS_GENERATED: 1,
    }
    assert summary["counts"]["total"] == 3


# --- aggregation: day bucketing + timezone ------------------------------------


def test_timezone_shifts_day_buckets() -> None:
    """23:30 UTC in UTC+2 (offset -120) is 01:30 the next local day."""
    now = _utc(2026, 9, 17, 12, 0)
    events = [_event(RESEARCH_RUN, _utc(2026, 9, 16, 23, 30))]
    summary = aggregate_usage(events, now, tz_offset=-120)
    dates_with_events = [day["date"] for day in summary["timeline"] if day["total"]]  # type: ignore[index]
    assert dates_with_events == ["2026-09-17"]


def test_tz_offset_is_clamped() -> None:
    now = _utc(2026, 9, 17, 12, 0)
    summary = aggregate_usage([_event(RESEARCH_RUN, now)], now, tz_offset=10_000)
    assert summary["total_events"] == 1
    assert _MAX_TZ_OFFSET == 840


def test_timeline_spans_thirty_days_oldest_first() -> None:
    now = _utc(2026, 9, 17, 12, 0)
    summary = aggregate_usage([_event(RESEARCH_RUN, now)], now)
    timeline = summary["timeline"]
    assert timeline[0]["date"] == "2026-08-19"  # type: ignore[index]
    assert timeline[-1]["date"] == "2026-09-17"  # type: ignore[index]
    assert timeline[-1]["total"] == 1  # type: ignore[index]


# --- aggregation: period comparison -------------------------------------------


def test_week_comparison_separates_this_and_last_week() -> None:
    now = _utc(2026, 9, 17, 12, 0)  # Thursday
    assert now.date().weekday() == 3
    events = [
        _event(RESEARCH_RUN, now - timedelta(days=1)),  # Wednesday, this week
        _event(RESEARCH_RUN, now - timedelta(days=3)),  # Monday, this week
        _event(POST_DRAFTED, now - timedelta(days=8)),  # last week
        _event(POST_DRAFTED, now - timedelta(days=9)),  # last week
        _event(POST_DRAFTED, now - timedelta(days=10)),  # last week
    ]
    summary = aggregate_usage(events, now)
    week = summary["comparison"]["week"]  # type: ignore[index]
    assert week["current"]["total"] == 2
    assert week["previous"]["total"] == 3
    assert week["current"]["by_event"] == {RESEARCH_RUN: 2}
    assert week["previous"]["by_event"] == {POST_DRAFTED: 3}


def test_month_comparison_boundaries() -> None:
    now = _utc(2026, 9, 17, 12, 0)
    events = [
        _event(RESEARCH_RUN, _utc(2026, 9, 1, 0, 30)),  # this month
        _event(RESEARCH_RUN, _utc(2026, 8, 31, 23, 30)),  # last month
    ]
    summary = aggregate_usage(events, now)
    month = summary["comparison"]["month"]  # type: ignore[index]
    assert month["current"]["total"] == 1
    assert month["previous"]["total"] == 1


# --- manual metrics aggregation ------------------------------------------------


def test_manual_metrics_period_sums() -> None:
    today = datetime(2026, 9, 17, tzinfo=UTC).date()
    entries = [
        {"posted_on": "2026-09-16", "impressions": 1200, "reactions": 34,
         "comments": 5, "reposts": 2},
        {"posted_on": "2026-09-14", "impressions": 800, "reactions": 20,
         "comments": 3, "reposts": 1},
        {"posted_on": "2026-09-08", "impressions": 400, "reactions": 10,
         "comments": 1, "reposts": 0},  # last week
    ]
    result = aggregate_manual_metrics(entries, today)
    assert result["week"]["current"]["impressions"] == 2000
    assert result["week"]["current"]["reactions"] == 54
    assert result["week"]["current"]["count"] == 2
    assert result["week"]["previous"]["impressions"] == 400
    assert result["month"]["current"]["impressions"] == 2400


def test_manual_metrics_empty_periods_are_real_zeros() -> None:
    today = datetime(2026, 9, 17, tzinfo=UTC).date()
    result = aggregate_manual_metrics([], today)
    assert result["week"]["current"] == {
        "impressions": 0, "reactions": 0, "comments": 0, "reposts": 0, "count": 0,
    }


# --- event builder + write path -------------------------------------------------


def test_build_usage_event_carries_context_fields() -> None:
    event = build_usage_event(
        "user-1", POST_DRAFTED,
        provider="openai", tokens_in=120, tokens_out=340,
        hook_pattern_id="hook-7", variant_id="variant-2",
    )
    assert event["user_id"] == "user-1"
    assert event["event"] == POST_DRAFTED
    assert event["provider"] == "openai"
    assert event["tokens_in"] == 120
    assert event["tokens_out"] == 340
    assert event["hook_pattern_id"] == "hook-7"
    assert event["variant_id"] == "variant-2"
    assert event["at"].tzinfo is not None  # timezone-aware UTC


async def test_record_usage_event_survives_a_broken_write(caplog) -> None:
    """A telemetry failure never breaks the user's action — and never hides."""

    class _BrokenCollection:
        async def insert_one(self, doc: dict) -> None:
            raise RuntimeError("disk on fire")

    class _BrokenDb:
        usage_events = _BrokenCollection()

    with caplog.at_level("ERROR", logger="app.usage"):
        await record_usage_event(_BrokenDb(), "user-1", RESEARCH_RUN)

    assert any("usage event write failed" in record.message for record in caplog.records)


async def test_record_usage_event_writes_the_document() -> None:
    db = FakeDatabase()
    await record_usage_event(db, "user-1", RESEARCH_RUN, count=3)
    docs = await db.usage_events.find({"user_id": "user-1"}).to_list()
    assert len(docs) == 1
    assert docs[0]["event"] == RESEARCH_RUN
    assert docs[0]["count"] == 3


# --- route wiring: events only on real successes --------------------------------


def _three_result_client() -> Any:
    from tests.unit.test_research_service import FakeAsyncClient, FakeResponse

    return FakeAsyncClient(
        [
            FakeResponse(
                200,
                {
                    "results": [
                        {"title": "A", "content": "a", "url": "https://a.dev"},
                        {"title": "B", "content": "b", "url": "https://b.dev"},
                        {"title": "C", "content": "c", "url": "https://c.dev"},
                    ]
                },
            )
        ]
    )


def _unauthorized_client() -> Any:
    from tests.unit.test_research_service import FakeAsyncClient, FakeResponse

    return FakeAsyncClient([FakeResponse(401)])


async def test_research_success_records_one_event(client, auth_headers) -> None:
    await store_tavily_key(client, auth_headers)
    client._transport.app.state.http_client = _three_result_client()

    response = await client.post(
        "/api/research", json={"niche": "AI", "tone": "professional"},
        headers=auth_headers,
    )
    assert response.status_code == 200, response.text

    app = client._transport.app
    docs = await app.state.db.usage_events.find({}).to_list()
    assert len(docs) == 1
    assert docs[0]["event"] == RESEARCH_RUN
    assert docs[0]["count"] == 9  # 3 queries x 3 results — all real trends
    assert docs[0]["provider"] == "tavily"


async def test_research_failure_records_nothing(client, auth_headers) -> None:
    """A 401 from Tavily must not leave a usage row — nothing happened."""
    await store_tavily_key(client, auth_headers)
    client._transport.app.state.http_client = _unauthorized_client()

    response = await client.post(
        "/api/research", json={"niche": "AI", "tone": "professional"},
        headers=auth_headers,
    )
    assert response.status_code == 401

    app = client._transport.app
    docs = await app.state.db.usage_events.find({}).to_list()
    assert docs == []


class _FakeLLM:
    """Returns parseable idea JSON and reports the usage a real SDK would."""

    provider = "anthropic"

    def __init__(self) -> None:
        self.last_usage = TokenUsage(tokens_in=150, tokens_out=420)

    async def complete(
        self, *, system: str, prompt: str, json_mode: bool = False,
        max_tokens: int = 2_000,
    ) -> str:
        return json.dumps(
            [
                {"title": "Idea A", "rating": 8.0, "rating_explanation": "strong"},
                {"title": "Idea B", "rating": 7.0, "rating_explanation": "solid"},
            ]
        )


async def test_generate_ideas_records_event_with_tokens(
    client, auth_headers, monkeypatch
) -> None:
    async def _fake_get_llm(user_id: str, provider: str, **kwargs: Any) -> _FakeLLM:
        return _FakeLLM()

    monkeypatch.setattr("app.routers.ideas.get_llm", _fake_get_llm)
    response = await client.post(
        "/api/generate-ideas",
        json={
            "raw_trends": [{"title": "Agents eat SaaS", "url": "https://x.dev"}],
            "niche": "AI",
            "tone": "professional",
        },
        headers=auth_headers,
    )
    assert response.status_code == 200, response.text

    app = client._transport.app
    docs = await app.state.db.usage_events.find({}).to_list()
    assert len(docs) == 1
    assert docs[0]["event"] == IDEAS_GENERATED
    assert docs[0]["count"] == 2
    assert docs[0]["tokens_in"] == 150
    assert docs[0]["tokens_out"] == 420


# --- manual metrics routes ------------------------------------------------------


async def _save_an_idea(client: Any, auth_headers: dict[str, str]) -> str:
    """Save one idea through the real route; returns its id."""
    response = await client.post(
        "/api/save-idea",
        json={"topic_title": "Agents eat SaaS", "rating": 8.5,
              "rating_explanation": "strong hook, live trend"},
        headers=auth_headers,
    )
    assert response.status_code == 200, response.text
    return response.json()["id"]


async def test_manual_metric_attach_round_trip(client, auth_headers) -> None:
    idea_id = await _save_an_idea(client, auth_headers)
    response = await client.post(
        f"/api/analytics/posts/{idea_id}/metrics",
        json={"posted_on": "2026-09-16", "impressions": 1200,
              "reactions": 34, "comments": 5, "reposts": 2},
        headers=auth_headers,
    )
    assert response.status_code == 200, response.text
    entry = response.json()
    assert entry["impressions"] == 1200
    assert entry["id"] and entry["recorded_at"]

    listing = await client.get(
        f"/api/analytics/posts/{idea_id}/metrics", headers=auth_headers
    )
    assert listing.status_code == 200
    assert [e["id"] for e in listing.json()] == [entry["id"]]


async def test_manual_metric_entry_is_bson_encodable(client, auth_headers) -> None:
    """Regression: the $push entry must be BSON-encodable.

    Pydantic parses ``posted_on`` into ``datetime.date``, which BSON cannot
    encode — the fake database stores dicts as-is and hid the failure until a
    real mongod rejected the write (dogfood 500). model_dump(mode="json")
    keeps the stored value an ISO string, which the aggregation service parses.
    """
    idea_id = await _save_an_idea(client, auth_headers)
    response = await client.post(
        f"/api/analytics/posts/{idea_id}/metrics",
        json={"posted_on": "2026-09-16", "impressions": 1200},
        headers=auth_headers,
    )
    assert response.status_code == 200, response.text

    app = client._transport.app
    docs = await app.state.db.saved_ideas.find({}).to_list()
    stored = next(doc for doc in docs if doc["id"] == idea_id)
    pushed = stored["manual_metrics"][0]
    encoded = bson.decode(bson.encode(pushed))  # encode raises InvalidDocument on datetime.date
    assert encoded["posted_on"] == "2026-09-16"


async def test_manual_metric_rejects_negative_counts(client, auth_headers) -> None:
    idea_id = await _save_an_idea(client, auth_headers)
    response = await client.post(
        f"/api/analytics/posts/{idea_id}/metrics",
        json={"posted_on": "2026-09-16", "impressions": -5},
        headers=auth_headers,
    )
    assert response.status_code == 422  # pasted numbers cannot be negative


async def test_manual_metric_on_foreign_idea_is_404(
    client, auth_headers
) -> None:
    """Tenancy: another user's idea does not exist for metric purposes."""
    idea_id = await _save_an_idea(client, auth_headers)

    await client.post(
        "/api/auth/register",
        json={"email": "other@example.com", "password": "correct-horse-9",
              "name": "Other"},
    )
    login = await client.post(
        "/api/auth/login",
        json={"email": "other@example.com", "password": "correct-horse-9"},
    )
    other_headers = {"Authorization": f"Bearer {login.json()['token']}"}

    response = await client.post(
        f"/api/analytics/posts/{idea_id}/metrics",
        json={"posted_on": "2026-09-16", "impressions": 100},
        headers=other_headers,
    )
    assert response.status_code == 404  # not 403 — the idea is simply not theirs


async def test_manual_metric_delete_round_trip(client, auth_headers) -> None:
    idea_id = await _save_an_idea(client, auth_headers)
    entry = (
        await client.post(
            f"/api/analytics/posts/{idea_id}/metrics",
            json={"posted_on": "2026-09-16", "impressions": 100},
            headers=auth_headers,
        )
    ).json()

    deleted = await client.delete(
        f"/api/analytics/posts/{idea_id}/metrics/{entry['id']}",
        headers=auth_headers,
    )
    assert deleted.status_code == 200

    listing = await client.get(
        f"/api/analytics/posts/{idea_id}/metrics", headers=auth_headers
    )
    assert listing.json() == []

    again = await client.delete(
        f"/api/analytics/posts/{idea_id}/metrics/{entry['id']}",
        headers=auth_headers,
    )
    assert again.status_code == 404


async def test_summary_includes_manual_metrics_section(
    client, auth_headers
) -> None:
    """The summary's manual section aggregates pasted entries — labelled apart
    from usage events because the two come from different worlds."""
    today = datetime.now(UTC).date().isoformat()
    idea_id = await _save_an_idea(client, auth_headers)
    await client.post(
        f"/api/analytics/posts/{idea_id}/metrics",
        json={"posted_on": today, "impressions": 1200, "reactions": 34,
              "comments": 5, "reposts": 2},
        headers=auth_headers,
    )

    response = await client.get("/api/analytics/summary", headers=auth_headers)
    assert response.status_code == 200
    body = response.json()
    manual_week = body["manual"]["week"]["current"]
    assert manual_week["impressions"] == 1200
    assert manual_week["reactions"] == 34
    assert manual_week["count"] == 1
    # Usage events untouched by the paste — separate sources, same payload.
    assert body["counts"]["total"] == 0


# --- summary endpoint ------------------------------------------------------------


async def test_summary_requires_auth(client) -> None:
    response = await client.get("/api/analytics/summary")
    assert response.status_code in (401, 403)  # missing credentials are rejected


async def test_summary_aggregates_only_my_events(client, auth_headers, fake_db) -> None:
    me = (await client.get("/api/auth/me", headers=auth_headers)).json()["id"]
    now = datetime.now(UTC)
    for user_id in (me, "someone-else"):
        for offset_days in range(3):
            await fake_db.usage_events.insert_one(
                _event(
                    RESEARCH_RUN,
                    now - timedelta(days=offset_days, hours=1),
                )
                | {"user_id": user_id}
            )

    response = await client.get("/api/analytics/summary", headers=auth_headers)
    assert response.status_code == 200
    body = response.json()
    assert body["total_events"] == 3
    assert body["counts"]["by_event"] == {RESEARCH_RUN: 3}
    assert body["streaks"]["current"] == 3
    # The other user's events are invisible here — 3, not 6.
