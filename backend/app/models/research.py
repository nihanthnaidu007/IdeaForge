"""Research schemas (Trend Radar)."""


from pydantic import BaseModel


class ResearchRequest(BaseModel):
    niche: str = "AI"
    tone: str = "professional"


class ResearchResponse(BaseModel):
    raw_trends: list[dict]
    niche: str
    tone: str
