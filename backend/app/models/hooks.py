"""Hook Bank schemas.

Style/format values mirror the seed catalog's axes; hook format values are
the backend's snake_case enums — the frontend's kebab-case POST_FORMATS ids
map onto these (HookPicker converts).
"""

from typing import Annotated, Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator

HookStyle = Literal[
    "contrarian", "story", "data", "vulnerability", "question", "listicle",
    "prediction", "myth_bust", "behind_the_scenes", "result", "curiosity",
    "failure", "challenge", "comparison", "authority", "observation", "insider",
]
HookFormat = Literal[
    "hot_take", "story", "how_to", "listicle", "carousel", "contrarian"
]


class HookCreate(BaseModel):
    text_pattern: Annotated[str, Field(min_length=3, max_length=280)]
    style: HookStyle
    format: HookFormat
    tags: list[Annotated[str, Field(min_length=1, max_length=40)]] = Field(
        default_factory=list, max_length=8
    )

    @field_validator("text_pattern")
    @classmethod
    def _strip(cls, value: str) -> str:
        stripped = value.strip()
        if not stripped:
            raise ValueError("text_pattern must not be empty")
        return stripped


class HookUpdate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    text_pattern: Annotated[str, Field(min_length=3, max_length=280)] | None = None
    style: HookStyle | None = None
    format: HookFormat | None = None
    tags: list[Annotated[str, Field(min_length=1, max_length=40)]] | None = None

    @field_validator("text_pattern")
    @classmethod
    def _strip(cls, value: str | None) -> str | None:
        if value is None:
            return None
        stripped = value.strip()
        if not stripped:
            raise ValueError("text_pattern must not be empty")
        return stripped
