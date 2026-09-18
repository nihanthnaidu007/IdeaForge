"""Preview schemas — the LinkedIn-accurate preview response contract (UI pack §6.1)."""

from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, Field


class PreviewRequest(BaseModel):
    # 2x the saved-draft cap (generated_post is 10k) — a preview request should
    # never be the thing that rejects a legitimately long paste.
    text: str = Field(min_length=1, max_length=20_000)


class PreviewCheck(BaseModel):
    id: str
    severity: Literal["info", "warn", "error"]
    message: str


class LinkedInPreview(BaseModel):
    char_count: int
    char_limit: int
    clean: bool
    checks: list[PreviewCheck]
    first_two_lines: str
