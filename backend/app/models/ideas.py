"""Idea Forge schemas."""


from typing import Annotated, Literal

from pydantic import BaseModel, Field, StringConstraints, model_validator

from app.models.research import MAX_TRENDS, TrendItem

# Per-trend forge accepts at most the rows the prompt builder renders anyway
# (the router caps the trend block at 8 rows).
MAX_FORGE_TRENDS = 8
TrendId = Annotated[str, StringConstraints(min_length=1, max_length=64)]

# The six canonical format enums (craft pack §5.1 post_angles.format; the
# backend audit's server.py format list). Frontend IDs are kebab-case; the
# variant engine normalizes both spellings.
PostFormat = Literal[
    "hot_take", "carousel", "story", "listicle", "how_to", "contrarian"
]


class InsightAudience(BaseModel):
    primary: str = Field(min_length=1, max_length=400)
    secondary: str = Field(default="", max_length=400)
    reading_trigger: str = Field(min_length=1, max_length=600)


class InsightKeyAspect(BaseModel):
    aspect: str = Field(min_length=1, max_length=400)
    tension: str = Field(min_length=1, max_length=800)


class InsightPostAngle(BaseModel):
    angle: str = Field(min_length=1, max_length=600)
    format: PostFormat
    why_now: str = Field(min_length=1, max_length=800)


class InsightCard(BaseModel):
    """The per-idea insight card (craft pack §5.1 schema, validated).

    `evidence_gaps` is the honesty mechanism: claims a great post would want
    that the trend context cannot source — the variant engine surfaces them
    in the generation prompt so source-dependent briefs refuse loudly.
    """

    schema_version: Literal[1] = 1
    audience: InsightAudience
    why_it_matters: str = Field(min_length=1, max_length=2000)
    key_aspects: list[InsightKeyAspect] = Field(min_length=3, max_length=5)
    post_angles: list[InsightPostAngle] = Field(min_length=3, max_length=3)
    evidence_gaps: list[str] = Field(default_factory=list, max_length=5)


class GenerateIdeasRequest(BaseModel):
    # M4: typed rows + bounded list — the router renders these into the LLM
    # prompt, so shape and size are contract, not client discretion.
    raw_trends: list[TrendItem] = Field(default_factory=list, max_length=MAX_TRENDS)
    # Per-trend forge: scope generation to server-cached trends by id — no
    # re-search, no extra Tavily spend. Exactly one trend source per request.
    trend_ids: list[TrendId] = Field(default_factory=list, max_length=MAX_FORGE_TRENDS)
    niche: str = Field(default="AI", min_length=1, max_length=120)
    tone: str = Field(default="professional", min_length=1, max_length=120)

    @model_validator(mode="after")
    def _exactly_one_trend_source(self) -> "GenerateIdeasRequest":
        # Both sources is ambiguous (which trends govern?), neither would burn
        # a model call on an empty trend block — both are client errors.
        if bool(self.raw_trends) == bool(self.trend_ids):
            raise ValueError("Provide exactly one of raw_trends or trend_ids.")
        return self


class IdeaInsightsRequest(BaseModel):
    idea: dict = Field(min_length=1)
    niche: str = Field(default="AI", min_length=1, max_length=120)
    tone: str = Field(default="professional", min_length=1, max_length=120)
    # Research evidence for the card's grounding + evidence_gaps reasoning —
    # validated rows so a malformed payload is a 422, not a 500.
    trends: list[TrendItem] = Field(default_factory=list, max_length=20)
    researched_at: str | None = Field(default=None, max_length=40)
    # True when the user explicitly re-runs a card they already hold — picks
    # the §6 refresh cost string instead of the first-card one.
    refresh: bool = False
