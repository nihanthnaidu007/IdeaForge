"""Manual post metrics — the user pastes their own numbers after publishing.

LinkedIn's member-social read scope is closed, so reach numbers can never be
pulled from anywhere: they exist in this product only because a user typed
them. Every field is non-negative and typed — no fabrication surface.
"""

from __future__ import annotations

from datetime import date

from pydantic import BaseModel, Field


class ManualMetricCreate(BaseModel):
    posted_on: date
    impressions: int = Field(ge=0)
    reactions: int = Field(ge=0, default=0)
    comments: int = Field(ge=0, default=0)
    reposts: int = Field(ge=0, default=0)


class ManualMetricEntry(ManualMetricCreate):
    id: str
    recorded_at: str  # ISO-8601 UTC — when the user entered the numbers
