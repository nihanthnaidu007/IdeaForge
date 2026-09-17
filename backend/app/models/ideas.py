"""Idea Forge schemas."""


from pydantic import BaseModel, Field

from app.models.research import MAX_TRENDS, TrendItem


class GenerateIdeasRequest(BaseModel):
    # M4: typed rows + bounded list — the router renders these into the LLM
    # prompt, so shape and size are contract, not client discretion.
    raw_trends: list[TrendItem] = Field(max_length=MAX_TRENDS)
    niche: str = Field(default="AI", min_length=1, max_length=120)
    tone: str = Field(default="professional", min_length=1, max_length=120)


class IdeaInsightsRequest(BaseModel):
    idea: dict
    niche: str = Field(default="AI", min_length=1, max_length=120)
    tone: str = Field(default="professional", min_length=1, max_length=120)
