"""Trend enrichment — the Trend Radar's why-now and post-worthiness layer.

One batched JSON-mode LLM call per research run (bounded spend — never
per-trend calls) annotates the Tavily rows with ``why_now``,
``post_worthiness``, and ``score_reason``. ``freshness`` never touches the
model: it is derived deterministically from the source's own published
timestamp.

Fail-open invariant (spec, locked): enrichment failure or a missing field
renders as explicitly unknown — the field rides back as ``None`` so the
frontend can show "No signal yet". A research run never fails because
enrichment did, and a missing why-now is never synthesized from the snippet.
"""

from __future__ import annotations

import logging
from datetime import UTC, datetime, timedelta
from typing import Any

from app.models.research import Freshness
from app.services.llm.provider import LLMProvider, complete_json_with_retry

logger = logging.getLogger("app.trends")

_MAX_WHY_NOW = 1000
_MAX_SCORE_REASON = 1000
_MAX_PUBLISHED_AT = 40
_ENRICHMENT_MAX_TOKENS = 4_000

TREND_ENRICHMENT_SYSTEM_PROMPT = """You are a content strategist for Tech and AI professionals. You receive numbered trend rows from a live web search: title, snippet, source URL, and published date when the source provided one.

For each trend, produce a why-now line and a post-worthiness score.

Rules:
- WHY-NOW GROUNDING: why_now must be 1-2 specific sentences grounded ONLY in that trend's own title, snippet, and source context — what changed, who is reacting, what window is opening. Never add facts, numbers, names, or events that the trend's own row does not contain.
- WHEN THERE IS NO SIGNAL: if the trend's row gives no basis for a why-now claim, return null for why_now. An unknown why-now renders as "no signal yet" in the product; an invented one is the exact failure this field exists to prevent.
- POST-WORTHINESS: the post_worthiness field, an integer 1-10 for how post-worthy this trend is for a LinkedIn creator right now (10 = concrete, urgent, widely felt; 1 = noise). Use the full scale — not every trend deserves 8+.
- SCORE REASON: one sentence naming what drove the post_worthiness (specificity, urgency, evidence, breadth of appeal).
- OUTPUT: exactly one JSON object, no prose outside it:
  {"trends": [{"index": <row index>, "why_now": string or null, "post_worthiness": integer or null, "score_reason": string or null}]}
  Include one entry per index you received, using the same index numbers."""

TREND_ENRICHMENT_USER_TEMPLATE = """=== NICHE ===
{niche}

=== TREND ROWS ===
{trend_block}

TASK: Return the JSON object specified in the system prompt — one entry per index."""


# --- deterministic freshness -------------------------------------------------


def _parse_published_at(value: str) -> datetime | None:
    text = value.strip()
    if text.endswith("Z"):
        text = text[:-1] + "+00:00"
    try:
        parsed = datetime.fromisoformat(text)
    except ValueError:
        return None
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=UTC)  # naive timestamps are treated as UTC
    return parsed


def derive_freshness(
    published_at: str | None, *, now: datetime | None = None
) -> Freshness | None:
    """Deterministic freshness bucket from the source's published timestamp.

    A pure function of (published_at, now) — no model, no content guessing.
    ``None`` when the source gave no parseable timestamp: that renders as
    "No signal yet", never as a guessed bucket. A future timestamp (source
    clock skew) counts as this week.
    """
    if not published_at:
        return None
    parsed = _parse_published_at(published_at)
    if parsed is None:
        return None
    now = now or datetime.now(UTC)
    age = now - parsed
    if age <= timedelta(days=7):
        return "this_week"
    if age <= timedelta(days=31):
        return "this_month"
    return "older"


# --- row normalization -------------------------------------------------------


def normalize_trend_row(row: dict[str, Any]) -> dict[str, Any]:
    """One Tavily result → the enriched-trend shape with explicit fields.

    Every enrichment field starts as ``None`` (explicitly unknown); freshness
    is derived here so it survives enrichment outages. The Tavily field is
    named ``published_date``; the product shape calls it ``published_at``
    (spec's enriched-trend example).
    """
    published_at = row.get("published_at")
    if isinstance(published_at, str):
        published_at = published_at[:_MAX_PUBLISHED_AT] or None
    else:
        published_at = None
    return {
        "title": row.get("title", ""),
        "snippet": row.get("snippet", ""),
        "url": row.get("url", ""),
        "source": row.get("source", ""),
        "id": None,
        "published_at": published_at,
        "freshness": derive_freshness(published_at),
        "why_now": None,
        "post_worthiness": None,
        "score_reason": None,
    }


# --- the batched enrichment call ---------------------------------------------


def build_enrichment_block(trends: list[dict[str, Any]]) -> str:
    """Numbered rows for the batched call — the index is the merge key."""
    lines: list[str] = []
    for index, trend in enumerate(trends):
        published = trend.get("published_at") or "unknown"
        source = trend.get("source") or "unknown source"
        url = trend.get("url") or ""
        lines.append(
            f"[{index}] {trend.get('title', '')}\n"
            f"    snippet: {trend.get('snippet', '')}\n"
            f"    source: {source} {url}\n"
            f"    published: {published}"
        )
    return "\n".join(lines)


def _clean_why_now(value: Any) -> str | None:
    if not isinstance(value, str):
        return None
    cleaned = value.strip()[:_MAX_WHY_NOW]
    return cleaned or None


def _clean_score_reason(value: Any) -> str | None:
    if not isinstance(value, str):
        return None
    cleaned = value.strip()[:_MAX_SCORE_REASON]
    return cleaned or None


def _clean_post_worthiness(value: Any) -> int | None:
    # bool is an int subclass — a model "true" is not a score. A non-integer
    # (8.5) ignores the integer instruction — unknown, never rounded.
    if isinstance(value, bool) or not isinstance(value, int):
        return None
    if not 1 <= value <= 10:
        return None
    return value


def _extract_entries(parsed: Any) -> list[dict[str, Any]]:
    """Pull entry dicts out of the model payload; wrong shapes yield none.

    A structurally-wrong answer is a fail-open case (all fields stay
    unknown, logged) — not a research failure and never a synthesized value.
    """
    if isinstance(parsed, dict):
        entries = parsed.get("trends")
    elif isinstance(parsed, list):
        entries = parsed  # tolerate a bare array of entries
    else:
        entries = None
    if not isinstance(entries, list):
        logger.warning(
            "trend enrichment payload carried no trend entries — fields stay unknown"
        )
        return []
    return [entry for entry in entries if isinstance(entry, dict)]


def merge_enrichment(
    trends: list[dict[str, Any]], entries: list[dict[str, Any]]
) -> list[dict[str, Any]]:
    """Merge validated enrichment entries into the trend rows by index.

    Per-field honesty: each field is validated independently, so a partial
    answer enriches what it can and leaves the rest explicitly unknown.
    Out-of-range indexes are model hallucinations and are dropped.
    """
    by_index: dict[int, dict[str, Any]] = {}
    for entry in entries:
        index = entry.get("index")
        if isinstance(index, bool) or not isinstance(index, int):
            continue
        if not 0 <= index < len(trends):
            continue
        cleaned = {
            "why_now": _clean_why_now(entry.get("why_now")),
            "post_worthiness": _clean_post_worthiness(entry.get("post_worthiness")),
            "score_reason": _clean_score_reason(entry.get("score_reason")),
        }
        if any(value is not None for value in cleaned.values()):
            by_index[index] = cleaned
    merged: list[dict[str, Any]] = []
    for index, trend in enumerate(trends):
        row = dict(trend)
        if index in by_index:
            row.update(by_index[index])
        merged.append(row)
    return merged


async def enrich_trends(
    llm: LLMProvider, trends: list[dict[str, Any]], *, niche: str
) -> list[dict[str, Any]]:
    """One batched JSON-mode call over the whole trend set (bounded spend).

    Returns the rows with why_now/post_worthiness/score_reason merged by
    index; unknown stays None. Raises only what ``llm.complete`` raises —
    the research route fail-opens around that call.
    """
    if not trends:
        return []
    prompt = TREND_ENRICHMENT_USER_TEMPLATE.format(
        niche=niche, trend_block=build_enrichment_block(trends)
    )
    parsed = await complete_json_with_retry(
        llm,
        system=TREND_ENRICHMENT_SYSTEM_PROMPT,
        prompt=prompt,
        max_tokens=_ENRICHMENT_MAX_TOKENS,
    )
    return merge_enrichment(trends, _extract_entries(parsed))
