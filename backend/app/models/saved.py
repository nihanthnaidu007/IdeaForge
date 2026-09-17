"""Saved-idea schemas (Content Board seeds). Contract identical to scaffold."""


from pydantic import BaseModel


class SaveIdeaRequest(BaseModel):
    topic_title: str
    rating: float
    rating_explanation: str
    targeted_audience: str | None = None
    why_it_matters: str | None = None
    key_aspects: list[str] | None = None
    generated_post: str | None = None
    post_format: str | None = None
    niche: str = "AI"
    tone: str = "professional"
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
