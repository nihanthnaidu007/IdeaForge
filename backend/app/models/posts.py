"""Post generation schemas."""


from pydantic import BaseModel, Field

from app.models.research import TrendItem

# The engine accepts three variants per idea — enough for a materially
# different A/B/C compare, bounded so one request can't multiply token spend
# without limit (BYOK discipline).
MAX_VARIANTS = 3


class GeneratePostRequest(BaseModel):
    idea: dict
    format: str
    tone: str = "professional"
    custom_instructions: str | None = ""
    insights: dict | None = None
    hook_id: str | None = None


class TweakPostRequest(BaseModel):
    original_post: str
    tweak_instruction: str
    idea: dict
    format: str


class SwapHookRequest(BaseModel):
    """Hook-swap: rewrite the opening line onto a different pattern, keep the
    rest of the draft untouched (craft pack §4.3)."""

    original_post: str = Field(min_length=1, max_length=20_000)
    hook_id: str
    idea: dict
    format: str
    tone: str = "professional"


class PostResponse(BaseModel):
    post: str


class GenerateVariantsRequest(BaseModel):
    """One variant-set generation: idea + evidence + format in, N drafts out.

    `parent_set_id` links a regeneration to the set it re-rolls so the engine
    rotates briefs (regenerate never repeats the last instructions); trends
    carry the research evidence the master prompt's fail-loud rule reads.
    """

    idea: dict = Field(min_length=1)
    format: str = Field(min_length=1, max_length=40)
    tone: str = Field(default="professional", min_length=1, max_length=120)
    custom_instructions: str | None = Field(default=None, max_length=2000)
    insights: dict | None = None  # insight card: feeds evidence_gaps + angles
    # Validated trend rows — malformed client payloads are 422s, not 500s.
    trends: list[TrendItem] = Field(default_factory=list, max_length=20)
    researched_at: str | None = Field(default=None, max_length=40)
    parent_set_id: str | None = Field(default=None, max_length=64)


class TweakVariantRequest(BaseModel):
    """Apply a user instruction to one variant, versioned (spec: tweakable)."""

    set_id: str = Field(min_length=1, max_length=64)
    variant_index: int = Field(ge=0, le=MAX_VARIANTS - 1)
    instruction: str = Field(min_length=1, max_length=2000)
