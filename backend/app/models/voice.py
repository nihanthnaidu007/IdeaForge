"""Voice DNA schemas.

The extraction output model mirrors the AI Craft Pack's VoiceDNAProfile schema
(§3.1): the spec's four keys (structure, vocabulary, energy, signature_moves)
plus the sibling fields the craft pack adds (sentence_rhythm, do/don't lists,
confidence, notes) — the two lists are what generation conditions on, and
confidence/notes are how the extractor expresses honest uncertainty.
"""

from typing import Annotated, Literal

from pydantic import BaseModel, ConfigDict, Field

_MAX_SAMPLE_CHARS = 20_000
_MAX_NOTES_CHARS = 4_000

_BoundedSample = Annotated[str, Field(min_length=1, max_length=_MAX_SAMPLE_CHARS)]


class ExtractVoiceRequest(BaseModel):
    samples: list[_BoundedSample] = Field(min_length=3, max_length=5)
    niche: str = Field(default="", max_length=120)
    audience: str = Field(default="", max_length=200)
    # None = auto: extract with whichever provider the user actually has a
    # key for (BYOK blob or server env default). A BYOK user with one key
    # shouldn't need to know this route's provider order.
    provider: Literal["anthropic", "openai"] | None = None


class StructureProfile(BaseModel):
    opening_pattern: str = Field(min_length=1, max_length=600)
    body_pattern: str = Field(min_length=1, max_length=600)
    closing_pattern: str = Field(min_length=1, max_length=600)
    paragraph_style: str = Field(min_length=1, max_length=600)
    line_break_habit: Literal["every_sentence", "beat_based", "dense_blocks", "mixed"]


class VocabularyProfile(BaseModel):
    # pydantic's BaseModel grew a `register` attribute, so the craft pack's
    # "register" key is stored as the field alias (API/Mongo keep "register").
    model_config = ConfigDict(populate_by_name=True)

    formality: str = Field(min_length=1, max_length=600, alias="register")
    jargon_level: Literal["none", "light", "moderate", "heavy"]
    signature_phrases: list[str] = Field(max_length=8)
    verb_energy: str = Field(min_length=1, max_length=600)


class EnergyProfile(BaseModel):
    overall_level: int = Field(ge=1, le=10)
    punctuation_style: str = Field(min_length=1, max_length=600)
    emoji_use: Literal["none", "rare", "frequent"]
    emphasis_tactics: str = Field(min_length=1, max_length=600)


class SentenceRhythm(BaseModel):
    avg_sentence_length_words: float = Field(ge=1, le=200)
    variation: str = Field(min_length=1, max_length=600)
    fragment_use: Literal["never", "occasional", "frequent"]


class SignatureMove(BaseModel):
    move: str = Field(min_length=1, max_length=600)
    evidence: str = Field(min_length=1, max_length=600)


class VoiceDNAProfile(BaseModel):
    """Validated extractor output — one version of the user's style profile."""

    schema_version: Literal[1] = 1
    sample_count: int = Field(ge=1, le=5)
    structure: StructureProfile
    vocabulary: VocabularyProfile
    energy: EnergyProfile
    sentence_rhythm: SentenceRhythm
    signature_moves: list[SignatureMove] = Field(min_length=2, max_length=6)
    do_list: list[str] = Field(min_length=3, max_length=8)
    dont_list: list[str] = Field(min_length=3, max_length=8)
    confidence: float = Field(ge=0.0, le=1.0)
    notes: str = Field(default="", max_length=_MAX_NOTES_CHARS)


class VoiceProfileEdit(BaseModel):
    """Editable fields of the active profile (UI pack §6.3: editing is really
    editing the do/don't lists and notes). Saving appends a new version —
    history is never rewritten."""

    do_list: list[str] | None = Field(default=None, min_length=3, max_length=8)
    dont_list: list[str] | None = Field(default=None, min_length=3, max_length=8)
    notes: str | None = Field(default=None, max_length=_MAX_NOTES_CHARS)
