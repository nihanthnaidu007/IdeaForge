"""Analytics routes — honest, user-scoped numbers only.

Every response is derived from the user's own usage events (what they did in
IdeaForge) and their own manually entered post metrics (what they pasted from
their LinkedIn dashboard). Nothing is scraped, estimated, or fabricated — an
empty count is a real zero, and the frontend says "no data yet" for it.
"""

from __future__ import annotations

from datetime import UTC, datetime, timedelta
from typing import Any

from fastapi import APIRouter, Depends, Query

from app.deps import get_current_user, get_db
from app.services.analytics import WINDOW_DAYS, aggregate_usage

router = APIRouter(prefix="/analytics")

# Cap on events aggregated in one request — the window keeps this small for a
# personal account; the cap guards a pathological history.
_MAX_EVENTS = 20_000


@router.get("/summary")
async def get_analytics_summary(
    tz_offset: int = Query(
        default=0,
        ge=840 * -1,
        le=840,
        description="Minutes east of UTC (JS getTimezoneOffset convention) "
        "so streaks and day buckets land on the user's own days.",
    ),
    current_user: dict[str, str] = Depends(get_current_user),
    db: Any = Depends(get_db),
) -> dict[str, Any]:
    since = datetime.now(UTC) - timedelta(days=WINDOW_DAYS)
    events = (
        await db.usage_events.find(
            {"user_id": current_user["user_id"], "at": {"$gte": since}},
            {"_id": 0},
        )
        .sort("at", 1)
        .to_list(_MAX_EVENTS)
    )
    return aggregate_usage(events, datetime.now(UTC), tz_offset)
