"""Analytics routes — honest, user-scoped numbers only.

Every response is derived from the user's own usage events (what they did in
IdeaForge) and their own manually entered post metrics (what they pasted from
their LinkedIn dashboard). Nothing is scraped, estimated, or fabricated — an
empty count is a real zero, and the frontend says "no data yet" for it.
"""

from __future__ import annotations

import uuid
from datetime import UTC, datetime, timedelta
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Query
from pymongo import ReturnDocument

from app.deps import get_current_user, get_db
from app.models.analytics import ManualMetricCreate, ManualMetricEntry
from app.services.analytics import (
    WINDOW_DAYS,
    aggregate_manual_metrics,
    aggregate_usage,
)

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
    now_utc = datetime.now(UTC)
    since = now_utc - timedelta(days=WINDOW_DAYS)
    events = (
        await db.usage_events.find(
            {"user_id": current_user["user_id"], "at": {"$gte": since}},
            {"_id": 0},
        )
        .sort("at", 1)
        .to_list(_MAX_EVENTS)
    )
    summary = aggregate_usage(events, now_utc, tz_offset)

    # Manual metrics live on the user's saved ideas — the numbers they pasted
    # in. Aggregated over the same calendar periods, clearly separated from
    # usage events: one source is IdeaForge activity, the other is LinkedIn.
    ideas = await db.saved_ideas.find(
        {"user_id": current_user["user_id"]}, {"_id": 0, "manual_metrics": 1}
    ).to_list(_MAX_EVENTS)
    entries = [
        entry for idea in ideas for entry in (idea.get("manual_metrics") or [])
    ]
    summary["manual"] = aggregate_manual_metrics(entries, now_utc.date())
    return summary


def _own_idea_query(idea_id: str, current_user: dict[str, str]) -> dict[str, str]:
    return {"id": idea_id, "user_id": current_user["user_id"]}


@router.post("/posts/{idea_id}/metrics", response_model=ManualMetricEntry)
async def add_manual_metric(
    idea_id: str,
    data: ManualMetricCreate,
    current_user: dict[str, str] = Depends(get_current_user),
    db: Any = Depends(get_db),
) -> ManualMetricEntry:
    entry = ManualMetricEntry(
        id=str(uuid.uuid4()),
        recorded_at=datetime.now(UTC).isoformat(),
        **data.model_dump(),
    )
    doc = await db.saved_ideas.find_one_and_update(
        _own_idea_query(idea_id, current_user),
        {"$push": {"manual_metrics": entry.model_dump()}},
        return_document=ReturnDocument.AFTER,
    )
    if doc is None:
        raise HTTPException(status_code=404, detail="Idea not found")
    return entry


@router.get("/posts/{idea_id}/metrics", response_model=list[ManualMetricEntry])
async def list_manual_metrics(
    idea_id: str,
    current_user: dict[str, str] = Depends(get_current_user),
    db: Any = Depends(get_db),
) -> list[ManualMetricEntry]:
    doc = await db.saved_ideas.find_one(
        _own_idea_query(idea_id, current_user), {"_id": 0, "manual_metrics": 1}
    )
    if doc is None:
        raise HTTPException(status_code=404, detail="Idea not found")
    return [ManualMetricEntry(**entry) for entry in doc.get("manual_metrics") or []]


@router.delete("/posts/{idea_id}/metrics/{metric_id}")
async def delete_manual_metric(
    idea_id: str,
    metric_id: str,
    current_user: dict[str, str] = Depends(get_current_user),
    db: Any = Depends(get_db),
) -> dict[str, str]:
    result = await db.saved_ideas.update_one(
        _own_idea_query(idea_id, current_user),
        {"$pull": {"manual_metrics": {"id": metric_id}}},
    )
    if result.modified_count == 0:
        # Same honest 404 whether the idea or the entry is missing — the
        # resource does not exist for this user either way.
        raise HTTPException(status_code=404, detail="Metric entry not found")
    return {"message": "Metric entry deleted"}
