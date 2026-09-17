"""Research schemas (Trend Radar)."""


from pydantic import BaseModel, Field

# M4: list-size caps for client-facing trend collections.
MAX_TRENDS = 50
_MAX_STR = 300
_MAX_URL = 2048


class TrendItem(BaseModel):
    """One normalized trend row as produced by Tavily research.

    Consumers (prompt builders) read title/snippet directly; typing the row
    turns a malformed client payload from a KeyError-shaped 500 into a 422
    and bounds its size (M4).
    """

    title: str = Field(min_length=1, max_length=_MAX_STR)
    snippet: str = Field(default="", max_length=_MAX_STR)
    url: str = Field(default="", max_length=_MAX_URL)
    source: str = Field(default="", max_length=_MAX_STR)


class ResearchRequest(BaseModel):
    niche: str = Field(default="AI", min_length=1, max_length=120)
    tone: str = Field(default="professional", min_length=1, max_length=120)


class ResearchResponse(BaseModel):
    raw_trends: list[TrendItem] = Field(max_length=MAX_TRENDS)
    niche: str
    tone: str
