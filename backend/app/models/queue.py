"""Draft Queue request/response models (spec §What We Build, Draft Queue row).

Compliance ceiling (LOCKED in the spec): the queue schedules REMINDERS —
in-app notifications with optional email. Nothing here models a publish
action; there is no auto-posting anywhere in the product.
"""

from __future__ import annotations

from datetime import datetime
from typing import Literal

from pydantic import BaseModel, Field

from app.models.saved import SavedIdea


class ScheduleRequest(BaseModel):
    # Validated as a future time at the route and stored normalized to UTC ISO.
    scheduled_for: datetime


class SnoozeRequest(BaseModel):
    hours: int = Field(default=1, ge=1, le=72)


class QueueView(BaseModel):
    """The queue list plus the deployment's honest email capability.

    ``email_enabled`` lets the UI tell the truth about delivery channels —
    copy never promises email unconditionally (UI pack §5.3).
    """

    email_enabled: bool
    items: list[SavedIdea]


class NotificationOut(BaseModel):
    id: str
    user_id: str
    idea_id: str
    idea_title: str
    channel: Literal["in_app", "email"]
    fired_at: str
    read: bool = False
