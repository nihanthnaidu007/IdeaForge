"""Usage event recording — the honest-analytics data source.

Every meaningful user action (research run, ideas generated, posts drafted,
voice extractions, exports, manual-metric logging) writes one event here.
Aggregation lives in :mod:`app.services.analytics`; this module only defines
the event vocabulary and the write path.

Honesty rules:
- Events are never synthesized or backfilled — analytics shows only what
  users actually did (spec: fail-loud data honesty, Analytics row).
- A failed event write must never break the user's primary action (a telemetry
  insert is secondary to the research/generation it observes), but it is never
  swallowed silently — it is logged with the full exception.
- ``hook_pattern_id`` / ``variant_id`` ride on the events that carry them
  (AI craft pack §1.3): generated posts store the hook pattern they used, and
  variant ids attach to their generation events, so analytics can join on
  them without a schema change later.
"""

from __future__ import annotations

import logging
import uuid
from datetime import UTC, datetime, timedelta
from typing import Any

from pymongo import ReturnDocument

from app.logging_setup import get_request_id

logger = logging.getLogger("app.usage")

# Event vocabulary — the closed set analytics aggregates over. Constants the
# recorder sites for (voice extraction, exports) land with their own PRs;
# defining the names here keeps the vocabulary in one place.
RESEARCH_RUN = "research_run"
IDEAS_GENERATED = "ideas_generated"
INSIGHT_CARD_GENERATED = "insight_card_generated"
POST_DRAFTED = "post_drafted"
POST_REGENERATED = "post_regenerated"
POST_TWEAKED = "post_tweaked"
VARIANT_GENERATED = "variant_generated"
VARIANT_TWEAKED = "variant_tweaked"
VOICE_EXTRACTED = "voice_extracted"
POSTS_EXPORTED = "posts_exported"
METRICS_LOGGED = "metrics_logged"
IDEA_STATUS_CHANGED = "idea_status_changed"
DRAFT_SCHEDULED = "draft_scheduled"
REMINDER_SNOOZED = "reminder_snoozed"
REMINDER_FIRED = "reminder_fired"

# Upper bound on optional context fields — analytic metadata, not user copy.
_MAX_CONTEXT_LEN = 200


# --- Bundled-key daily usage counters (Wave 1 hybrid-model caps) -------------
#
# Separate from the event log above: these are enforcement counters, one doc
# per (user, resource, UTC day), incremented atomically at the moment a
# bundled (server-default) call is authorized. BYOK calls never touch them —
# the cap bounds the operator's spend, it never nudges users off the product.

RESOURCE_LLM = "llm"
RESOURCE_RESEARCH = "research"

# Research runs execute on Tavily; every model call is an LLM resource. The
# 1:1 provider→resource mapping is a property of the product, not a config
# knob — caps are per resource so one dashboard action cannot exhaust both.
_RESOURCE_FOR_PROVIDER: dict[str, str] = {
    "tavily": RESOURCE_RESEARCH,
    "anthropic": RESOURCE_LLM,
    "openai": RESOURCE_LLM,
}


def resource_for_provider(provider: str) -> str:
    """Map a provider to its cap resource (research runs vs LLM calls)."""
    return _RESOURCE_FOR_PROVIDER[provider]


def bundled_daily_limit(settings: Any, resource: str) -> int:
    """Operator-configured daily allowance for a resource (env-tunable)."""
    if resource == RESOURCE_RESEARCH:
        return settings.bundled_daily_research_limit
    return settings.bundled_daily_llm_limit


def daily_usage_reset_at(now: datetime | None = None) -> datetime:
    """When today's counters reset: next UTC midnight (deterministic)."""
    now = now or datetime.now(UTC)
    return datetime(now.year, now.month, now.day, tzinfo=UTC) + timedelta(days=1)


def seconds_until_reset(now: datetime | None = None) -> int:
    reset = daily_usage_reset_at(now)
    now = now or datetime.now(UTC)
    return max(0, int((reset - now).total_seconds()))


def _counter_identity(user_id: str, resource: str, now: datetime) -> dict[str, Any]:
    return {
        "user_id": user_id,
        "resource": resource,
        "day": now.strftime("%Y-%m-%d"),
    }


async def read_daily_usage(
    db: Any, user_id: str, resource: str, *, now: datetime | None = None
) -> int:
    """Current count for (user, resource, today) — the Settings banner read."""
    now = now or datetime.now(UTC)
    doc = await db.usage_counters.find_one(
        _counter_identity(user_id, resource, now), {"_id": 0, "count": 1}
    )
    return int(doc["count"]) if doc else 0


async def authorize_daily_usage(
    db: Any,
    user_id: str,
    resource: str,
    *,
    limit: int,
    now: datetime | None = None,
) -> int | None:
    """Atomically reserve one bundled unit; None when today's allowance is spent.

    The increment is an atomic ``$inc`` on the daily-keyed doc; the returned
    count doubles as the caller's reservation ticket — a caller that draws a
    ticket above ``limit`` was denied and refunds its own increment. Concurrent
    callers therefore draw distinct tickets and at most ``limit`` of them can
    proceed; at rest the counter equals the number of authorized units.
    ``$setOnInsert`` carries the identity fields explicitly because upsert
    document creation from filter equalities is MongoDB-specific — stating
    them keeps the repo fakes and real Mongo identical (the unique index on
    user×resource×day collapses any first-insert race). Callers raise
    UsageCapExceeded on None; an authorized unit is never refunded (a failed
    provider call is still a spend attempt — documented, honest).
    """
    now = now or datetime.now(UTC)
    identity = _counter_identity(user_id, resource, now)
    doc = await db.usage_counters.find_one_and_update(
        identity,
        {
            "$inc": {"count": 1},
            "$setOnInsert": {**identity, "resets_at": daily_usage_reset_at(now)},
        },
        upsert=True,
        return_document=ReturnDocument.AFTER,
    )
    if not doc:
        # find_one_and_update(upsert) always returns a doc in practice; a
        # missing one is a fake/driver contract break, not a denial.
        raise RuntimeError("usage counter upsert returned no document")
    count = int(doc["count"])
    if count > limit:
        await db.usage_counters.update_one(identity, {"$inc": {"count": -1}})
        return None
    return count


def build_usage_event(
    user_id: str,
    event: str,
    *,
    provider: str | None = None,
    tokens_in: int | None = None,
    tokens_out: int | None = None,
    count: int | None = None,
    hook_pattern_id: str | None = None,
    variant_id: str | None = None,
    idea_id: str | None = None,
) -> dict[str, Any]:
    """One canonical shape for every ``usage_events`` document (audit.py pattern)."""
    doc: dict[str, Any] = {
        "id": str(uuid.uuid4()),
        "user_id": user_id,
        "event": event,
        "at": datetime.now(UTC),
        "request_id": get_request_id(),
    }
    if provider is not None:
        doc["provider"] = provider[:_MAX_CONTEXT_LEN]
    if tokens_in is not None:
        doc["tokens_in"] = tokens_in
    if tokens_out is not None:
        doc["tokens_out"] = tokens_out
    if count is not None:
        doc["count"] = count
    for key, value in (
        ("hook_pattern_id", hook_pattern_id),
        ("variant_id", variant_id),
        ("idea_id", idea_id),
    ):
        if value is not None:
            doc[key] = value[:_MAX_CONTEXT_LEN]
    return doc


async def record_usage_event(
    db: Any, user_id: str, event: str, **context: Any
) -> None:
    """Write one usage event; failures log and never raise to the caller.

    The caller's action (research, generation, …) already succeeded — analytics
    is secondary. But a broken write is never silent: it lands in the structured
    log where operators see it.
    """
    try:
        await db.usage_events.insert_one(build_usage_event(user_id, event, **context))
    except Exception:
        logger.exception(
            "usage event write failed (user=%s event=%s) — analytics may undercount",
            user_id,
            event,
        )
