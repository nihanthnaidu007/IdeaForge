"""Board request models — status transitions and tag edits over saved ideas.

The status enum is the spec's pipeline (``inbox → forged → drafting → ready``,
spec data model ``saved_ideas.status``); the UI & Copy Craft Pack §6.6 note to
"confirm the enum against the backend" resolves here: the spec's values win.
"""

from __future__ import annotations

from enum import StrEnum
from typing import Annotated

from pydantic import BaseModel, Field, StringConstraints

Tag = Annotated[str, StringConstraints(min_length=1, max_length=40)]


class BoardStatus(StrEnum):
    INBOX = "inbox"
    FORGED = "forged"
    DRAFTING = "drafting"
    READY = "ready"


class TransitionRequest(BaseModel):
    to: BoardStatus


class TagsUpdateRequest(BaseModel):
    # Full-list replace: the board is single-user per idea, so a replace is
    # unambiguous where a diff-style patch could interleave badly.
    tags: list[Tag] = Field(default_factory=list, max_length=10)
