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
from datetime import UTC, datetime
from typing import Any

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
