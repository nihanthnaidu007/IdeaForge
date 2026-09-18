"""Research schemas (Trend Radar)."""

from typing import Literal

from pydantic import BaseModel, Field

# M4: list-size caps for client-facing trend collections.
MAX_TRENDS = 50
_MAX_STR = 300
_MAX_URL = 2048

# Freshness buckets derived from the source's own published timestamp —
# deterministic, never model-generated (unknown renders as "No signal yet").
Freshness = Literal["this_week", "this_month", "older"]


class TrendItem(BaseModel):
    """One normalized trend row as produced by Tavily research.

    Consumers (prompt builders) read title/snippet directly; typing the row
    turns a malformed client payload from a KeyError-shaped 500 into a 422
    and bounds its size (M4). The enrichment fields are optional and explicit:
    a research run without enrichment (or without an answer for a field)
    carries None — the frontend renders that as "No signal yet", never an
    invented value.
    """

    title: str = Field(min_length=1, max_length=_MAX_STR)
    snippet: str = Field(default="", max_length=_MAX_STR)
    url: str = Field(default="", max_length=_MAX_URL)
    source: str = Field(default="", max_length=_MAX_STR)
    # Server-assigned id (trend cache) so the client can forge from one trend.
    id: str | None = Field(default=None, max_length=64)
    # Source's own published timestamp (Tavily ``published_date``), ISO-ish.
    published_at: str | None = Field(default=None, max_length=40)
    freshness: Freshness | None = None
    why_now: str | None = Field(default=None, max_length=1000)
    score: int | float | None = Field(default=None, ge=1, le=10)
    score_reason: str | None = Field(default=None, max_length=1000)


class ResearchRequest(BaseModel):
    niche: str = Field(default="AI", min_length=1, max_length=120)
    tone: str = Field(default="professional", min_length=1, max_length=120)
