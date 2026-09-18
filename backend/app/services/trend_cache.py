"""Trend cache — research rows persisted server-side for per-trend forge.

The research route writes every enriched trend here under a generated id;
``POST /generate-ideas`` with ``trend_ids`` scopes generation to the cached
rows' content — no re-search, no extra Tavily spend. Any requested id that is
unknown, expired, or owned by another user is a typed 404 — never a silent
fallback to unscoped forging.
"""

from __future__ import annotations

import logging
import uuid
from datetime import UTC, datetime, timedelta
from typing import Any

from pydantic import ValidationError

from app.models.research import TrendItem

logger = logging.getLogger("app.trends")

_TREND_ID_BYTES = 4  # 8 hex chars, spec's "trend_a1b2" shape


class TrendNotFoundError(Exception):
    """A requested trend id is unknown, expired, or not the caller's — 404."""

    status_code = 404
    kind = "TRENDS_NOT_FOUND"


def make_trend_id() -> str:
    return f"trend_{uuid.uuid4().hex[: 2 * _TREND_ID_BYTES]}"


def _cache_doc(
    trend_id: str,
    user_id: str,
    niche: str,
    item: TrendItem,
    now: datetime,
    ttl_hours: int,
) -> dict[str, Any]:
    return {
        "id": trend_id,
        "user_id": user_id,
        "niche": niche,
        "title": item.title,
        "snippet": item.snippet,
        "url": item.url,
        "source": item.source,
        "published_at": item.published_at,
        "freshness": item.freshness,
        "why_now": item.why_now,
        "score": item.score,
        "score_reason": item.score_reason,
        "created_at": now,
        "expires_at": now + timedelta(hours=ttl_hours),
    }


async def cache_trends(
    db: Any,
    *,
    user_id: str,
    niche: str,
    trends: list[dict[str, Any]],
    ttl_hours: int,
) -> list[dict[str, Any]]:
    """Assign ids to cacheable rows, persist them, return the rows with ids.

    A row that fails trend validation (e.g. an empty title from the source)
    keeps ``id=None`` instead of an id the forge route would later 404 on; a
    failed cache write drops the id too — a dead id in the client's hands is
    just a delayed 404. Write failures log and never raise: the research run
    already succeeded.
    """
    now = datetime.now(UTC)
    result: list[dict[str, Any]] = []
    for row in trends:
        out = dict(row)
        try:
            item = TrendItem(
                title=row.get("title", ""),
                snippet=row.get("snippet", ""),
                url=row.get("url", ""),
                source=row.get("source", ""),
                published_at=row.get("published_at"),
                freshness=row.get("freshness"),
                why_now=row.get("why_now"),
                score=row.get("score"),
                score_reason=row.get("score_reason"),
            )
        except ValidationError:
            out["id"] = None
            result.append(out)
            continue
        trend_id = make_trend_id()
        out["id"] = trend_id
        try:
            await db.trend_cache.insert_one(
                _cache_doc(trend_id, user_id, niche, item, now, ttl_hours)
            )
        except Exception:
            out["id"] = None
            logger.exception(
                "trend cache write failed (user=%s) — row returned without an id",
                user_id,
            )
        result.append(out)
    return result


def _expires_at_of(doc: dict[str, Any]) -> datetime | None:
    """Normalize the stored expiry; naive Mongo datetimes are UTC."""
    expires_at = doc.get("expires_at")
    if not isinstance(expires_at, datetime):
        return None
    if expires_at.tzinfo is None:
        expires_at = expires_at.replace(tzinfo=UTC)
    return expires_at


async def load_trends_for_forge(
    db: Any, *, user_id: str, trend_ids: list[str]
) -> list[TrendItem]:
    """Cached trends for per-trend forge, in request order (deduplicated).

    The lookup is user-scoped and expiry-checked explicitly (Mongo's TTL
    sweeper is asynchronous; the query must not rely on it). Any missing id
    raises the typed 404 — a partial answer would be a silent downgrade of
    the requested scope.
    """
    requested = list(dict.fromkeys(trend_ids))
    docs = await db.trend_cache.find(
        {"user_id": user_id, "id": {"$in": requested}}
    ).to_list(None)
    now = datetime.now(UTC)
    by_id: dict[str, dict[str, Any]] = {}
    for doc in docs:
        expires_at = _expires_at_of(doc)
        # A stored doc without a parseable expiry is treated as expired —
        # fail closed on the scoping contract, never fall back unscoped.
        if expires_at is None or expires_at <= now:
            continue
        trend_id = doc.get("id")
        if isinstance(trend_id, str):
            by_id[trend_id] = doc
    missing = [trend_id for trend_id in requested if trend_id not in by_id]
    if missing:
        shown = ", ".join(missing[:5])
        more = f" (+{len(missing) - 5} more)" if len(missing) > 5 else ""
        raise TrendNotFoundError(
            f"Unknown or expired trend ids: {shown}{more}. "
            "Run a fresh research sweep to forge from current trends."
        )
    return [
        TrendItem(
            title=by_id[trend_id]["title"],
            snippet=by_id[trend_id].get("snippet", ""),
            url=by_id[trend_id].get("url", ""),
            source=by_id[trend_id].get("source", ""),
            id=trend_id,
            published_at=by_id[trend_id].get("published_at"),
            freshness=by_id[trend_id].get("freshness"),
            why_now=by_id[trend_id].get("why_now"),
            score=by_id[trend_id].get("score"),
            score_reason=by_id[trend_id].get("score_reason"),
        )
        for trend_id in requested
    ]
