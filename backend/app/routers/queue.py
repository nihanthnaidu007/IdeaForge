"""Draft Queue routes — scheduling, snoozing, and in-app notifications.

Compliance ceiling (LOCKED, spec §What We Build): the queue schedules
REMINDERS — never posting, never auto-publishing. A reminder's job is to
bring the user back at the right moment with the draft ready to preview,
copy, and post themselves.
"""

from __future__ import annotations

from datetime import UTC, datetime, timedelta
from typing import Any

from fastapi import APIRouter, Depends, HTTPException
from pymongo import ReturnDocument

from app.config import Settings
from app.deps import get_current_user, get_db, get_settings_dep
from app.models.queue import NotificationOut, QueueView, ScheduleRequest, SnoozeRequest
from app.models.saved import SavedIdea
from app.services.usage import DRAFT_SCHEDULED, REMINDER_SNOOZED, record_usage_event
from app.services.workflow_errors import InvalidScheduleTime

router = APIRouter()

_QUEUE_CAP = 200
_NOTIFICATION_CAP = 50


async def _get_owned_idea(db: Any, user_id: str, idea_id: str) -> dict[str, Any]:
    doc = await db.saved_ideas.find_one({"id": idea_id, "user_id": user_id})
    if doc is None:
        raise HTTPException(status_code=404, detail="Idea not found")
    return doc


@router.get("/queue", response_model=QueueView)
async def get_queue(
    current_user: dict[str, str] = Depends(get_current_user),
    db: Any = Depends(get_db),
    settings: Settings = Depends(get_settings_dep),
) -> QueueView:
    docs = await db.saved_ideas.find(
        {"user_id": current_user["user_id"]}, {"_id": 0}
    ).to_list(_QUEUE_CAP)
    # Equality-only matching in the test tier fakes → scheduled items are
    # filtered in Python, sorted soonest-first.
    scheduled = [d for d in docs if d.get("scheduled_for")]
    scheduled.sort(key=lambda d: d.get("scheduled_for", ""))
    return QueueView(
        email_enabled=bool(settings.smtp_url),
        items=[SavedIdea(**d) for d in scheduled],
    )


@router.post("/queue/{idea_id}/schedule", response_model=SavedIdea)
async def schedule_draft(
    idea_id: str,
    data: ScheduleRequest,
    current_user: dict[str, str] = Depends(get_current_user),
    db: Any = Depends(get_db),
) -> SavedIdea:
    now = datetime.now(UTC)
    when = data.scheduled_for
    if when.tzinfo is None:
        when = when.replace(tzinfo=UTC)  # naive input is treated as UTC
    if when <= now:
        raise InvalidScheduleTime(
            "Pick a time in the future — reminders can't fire into the past."
        )
    await _get_owned_idea(db, current_user["user_id"], idea_id)
    doc = await db.saved_ideas.find_one_and_update(
        {"id": idea_id, "user_id": current_user["user_id"]},
        {
            "$set": {
                "scheduled_for": when.astimezone(UTC).isoformat(),
                "reminder_fired_at": None,
            }
        },
        return_document=ReturnDocument.AFTER,
        projection={"_id": 0},
    )
    await record_usage_event(db, current_user["user_id"], DRAFT_SCHEDULED)
    assert doc is not None
    return SavedIdea(**doc)


@router.delete("/queue/{idea_id}/schedule", response_model=SavedIdea)
async def unschedule_draft(
    idea_id: str,
    current_user: dict[str, str] = Depends(get_current_user),
    db: Any = Depends(get_db),
) -> SavedIdea:
    await _get_owned_idea(db, current_user["user_id"], idea_id)
    doc = await db.saved_ideas.find_one_and_update(
        {"id": idea_id, "user_id": current_user["user_id"]},
        {"$set": {"scheduled_for": None, "reminder_fired_at": None}},
        return_document=ReturnDocument.AFTER,
        projection={"_id": 0},
    )
    assert doc is not None
    return SavedIdea(**doc)


@router.post("/queue/{idea_id}/snooze", response_model=SavedIdea)
async def snooze_draft(
    idea_id: str,
    data: SnoozeRequest,
    current_user: dict[str, str] = Depends(get_current_user),
    db: Any = Depends(get_db),
) -> SavedIdea:
    await _get_owned_idea(db, current_user["user_id"], idea_id)
    when = datetime.now(UTC) + timedelta(hours=data.hours)
    doc = await db.saved_ideas.find_one_and_update(
        {"id": idea_id, "user_id": current_user["user_id"]},
        {"$set": {"scheduled_for": when.isoformat(), "reminder_fired_at": None}},
        return_document=ReturnDocument.AFTER,
        projection={"_id": 0},
    )
    await record_usage_event(db, current_user["user_id"], REMINDER_SNOOZED)
    assert doc is not None
    return SavedIdea(**doc)


@router.get("/queue/notifications", response_model=list[NotificationOut])
async def get_notifications(
    current_user: dict[str, str] = Depends(get_current_user),
    db: Any = Depends(get_db),
) -> list[NotificationOut]:
    docs = await db.notifications.find(
        {"user_id": current_user["user_id"]}, {"_id": 0}
    ).to_list(_NOTIFICATION_CAP)
    docs.sort(key=lambda d: d.get("fired_at", ""), reverse=True)
    return [NotificationOut(**d) for d in docs]


@router.post(
    "/queue/notifications/{notification_id}/read", response_model=NotificationOut
)
async def mark_notification_read(
    notification_id: str,
    current_user: dict[str, str] = Depends(get_current_user),
    db: Any = Depends(get_db),
) -> NotificationOut:
    doc = await db.notifications.find_one_and_update(
        {"id": notification_id, "user_id": current_user["user_id"]},
        {"$set": {"read": True}},
        return_document=ReturnDocument.AFTER,
        projection={"_id": 0},
    )
    if doc is None:
        raise HTTPException(status_code=404, detail="Notification not found")
    return NotificationOut(**doc)
