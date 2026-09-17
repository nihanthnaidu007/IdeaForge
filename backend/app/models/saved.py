"""Saved-idea schemas (Content Board seeds). Contract identical to scaffold,
with M4 bounds: string length caps, the 0–10 rating range, and list-size caps."""


from pydantic import BaseModel, Field


class SaveIdeaRequest(BaseModel):
    topic_title: str = Field(min_length=1, max_length=300)
    rating: float = Field(ge=0, le=10)  # M4: the rating scale is 0–10
    rating_explanation: str = Field(min_length=1, max_length=2000)
    targeted_audience: str | None = Field(default=None, max_length=500)
    why_it_matters: str | None = Field(default=None, max_length=2000)
    key_aspects: list[str] | None = Field(default=None, max_length=20)
    generated_post: str | None = Field(default=None, max_length=10000)
    post_format: str | None = Field(default=None, max_length=100)
    niche: str = Field(default="AI", min_length=1, max_length=120)
    tone: str = Field(default="professional", min_length=1, max_length=120)
    is_bookmarked: bool = False


class SavedIdea(BaseModel):
    id: str
    user_id: str
    topic_title: str
    rating: float
    rating_explanation: str
    targeted_audience: str | None = None
    why_it_matters: str | None = None
    key_aspects: list[str] | None = None
    generated_post: str | None = None
    post_format: str | None = None
    niche: str
    tone: str
    created_at: str
    is_bookmarked: bool = False
