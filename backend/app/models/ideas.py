"""Idea Forge schemas."""


from pydantic import BaseModel


class GenerateIdeasRequest(BaseModel):
    raw_trends: list[dict]
    niche: str = "AI"
    tone: str = "professional"


class IdeaInsightsRequest(BaseModel):
    idea: dict
    niche: str = "AI"
    tone: str = "professional"
