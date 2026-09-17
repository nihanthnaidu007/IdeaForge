"""Shared key-audit event builders (M5).

One shape for every ``key_audit`` insert, so events stay queryable and can
never drift: ``request_id`` links each event to the request log line it
happened in (empty outside a request context — e.g. scripts), and success
events carry the same fields as failure events.
"""

from __future__ import annotations

from datetime import UTC, datetime
from typing import Any

from app.logging_setup import get_request_id


def build_key_audit_event(user_id: str, provider: str, event: str) -> dict[str, Any]:
    return {
        "user_id": user_id,
        "provider": provider,
        "event": event,
        "request_id": get_request_id(),  # M5: correlate with the request log
        "at": datetime.now(UTC),
    }
