"""Content Board routes — status workflow, tags, and search over saved ideas.

The board is the pipeline inbox (spec §What We Build, Content Board row): every
saved idea carries a status (``inbox → forged → drafting → ready``), user tags,
and is searchable by text/tag/status. Transitions are validated against an
explicit adjacency map — one step forward or back per move, so the board always
reflects where the content actually is in the pipeline.

No route here touches a provider: the board reads and mutates saved ideas only
(UI pack §3.7), so provider errors can never surface from it.
"""

from __future__ import annotations

from collections.abc import Iterable
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Query
from pymongo import ReturnDocument

from app.deps import get_current_user, get_db
from app.models.board import BoardStatus, TagsUpdateRequest, TransitionRequest
from app.models.saved import SavedIdea
from app.services.usage import IDEA_STATUS_CHANGED, record_usage_event
from app.services.workflow_errors import InvalidTransition

router = APIRouter()

# Page cap for the board list — the working view of the pipeline, not an
# archive. Generous over the /saved cap (100) because the board groups by
# column, but bounded so a runaway account cannot stream unbounded results.
BOARD_PAGE_CAP = 500

_MAX_TAGS = 10
_TAG_MAX_LEN = 40

# Adjacent-step pipeline: forward one stage, or back one stage. Skipping
# stages is rejected with the allowed targets named (fail loud, fail specific).
_TRANSITIONS: dict[str, frozenset[str]] = {
    BoardStatus.INBOX.value: frozenset({BoardStatus.FORGED.value}),
    BoardStatus.FORGED.value: frozenset(
        {BoardStatus.INBOX.value, BoardStatus.DRAFTING.value}
    ),
    BoardStatus.DRAFTING.value: frozenset(
        {BoardStatus.FORGED.value, BoardStatus.READY.value}
    ),
    BoardStatus.READY.value: frozenset({BoardStatus.DRAFTING.value}),
}


def allowed_targets(status: str) -> list[str]:
    """Sorted statuses reachable from ``status`` in one validated move."""
    return sorted(_TRANSITIONS.get(status, frozenset()))


def validate_transition(current: str, to: str) -> None:
    """Raise InvalidTransition unless ``current → to`` is one adjacent step."""
    if to == current:
        raise InvalidTransition(f"That is already the current status ({current}).")
    if to not in _TRANSITIONS.get(current, frozenset()):
        targets = ", ".join(allowed_targets(current)) or "none"
        raise InvalidTransition(
            f"Can't move from {current} to {to} — allowed next steps: {targets}."
        )


def normalize_tags(tags: Iterable[str]) -> list[str]:
    """Strip, drop empties, dedupe preserving order, cap the list."""
    seen: dict[str, None] = {}
    for raw in tags:
        tag = raw.strip()
        if tag:
            seen.setdefault(tag[:_TAG_MAX_LEN], None)
        if len(seen) >= _MAX_TAGS:
            break
    return list(seen)


def filter_ideas(
    ideas: Iterable[dict[str, Any]],
    *,
    q: str | None = None,
    tag: str | None = None,
    status: str | None = None,
) -> list[dict[str, Any]]:
    """Pure board filtering (text + tag + status).

    Filtering happens in Python at the router seam: the repository fakes in
    tests emulate only operator-free matching, and at board scale (hundreds of
    ideas per user) a Python filter over one indexed user read is the honest,
    testable shape.
    """
    needle = q.strip().lower() if q and q.strip() else None
    out: list[dict[str, Any]] = []
    for doc in ideas:
        if status and doc.get("status", "inbox") != status:
            continue
        if tag and tag not in (doc.get("tags") or []):
            continue
        if needle:
            haystack = " ".join(
                part
                for part in (
                    doc.get("topic_title"),
                    doc.get("rating_explanation"),
                    doc.get("targeted_audience"),
                    doc.get("why_it_matters"),
                    doc.get("generated_post"),
                )
                if part
            ).lower()
            if needle not in haystack:
                continue
        out.append(doc)
    return out


async def _get_owned_idea(db: Any, user_id: str, idea_id: str) -> dict[str, Any]:
    doc = await db.saved_ideas.find_one({"id": idea_id, "user_id": user_id})
    if doc is None:
        raise HTTPException(status_code=404, detail="Idea not found")
    return doc


@router.get("/board", response_model=list[SavedIdea])
async def get_board(
    q: str | None = Query(default=None, max_length=200),
    tag: str | None = Query(default=None, max_length=_TAG_MAX_LEN),
    status: BoardStatus | None = None,
    current_user: dict[str, str] = Depends(get_current_user),
    db: Any = Depends(get_db),
) -> list[SavedIdea]:
    docs = await db.saved_ideas.find(
        {"user_id": current_user["user_id"]}, {"_id": 0}
    ).to_list(BOARD_PAGE_CAP)
    filtered = filter_ideas(docs, q=q, tag=tag, status=status.value if status else None)
    filtered.sort(key=lambda d: d.get("created_at", ""), reverse=True)
    return [SavedIdea(**doc) for doc in filtered]


@router.get("/board/tags", response_model=list[str])
async def get_board_tags(
    current_user: dict[str, str] = Depends(get_current_user),
    db: Any = Depends(get_db),
) -> list[str]:
    """Distinct tags across the user's ideas, for the filter chip row."""
    docs = await db.saved_ideas.find(
        {"user_id": current_user["user_id"]}, {"_id": 0, "tags": 1}
    ).to_list(BOARD_PAGE_CAP)
    tags: set[str] = set()
    for doc in docs:
        tags.update(doc.get("tags") or [])
    return sorted(tags)


@router.post("/board/{idea_id}/transition", response_model=SavedIdea)
async def transition_idea(
    idea_id: str,
    data: TransitionRequest,
    current_user: dict[str, str] = Depends(get_current_user),
    db: Any = Depends(get_db),
) -> SavedIdea:
    current = await _get_owned_idea(db, current_user["user_id"], idea_id)
    to = data.to.value
    validate_transition(current.get("status", "inbox"), to)
    doc = await db.saved_ideas.find_one_and_update(
        {"id": idea_id, "user_id": current_user["user_id"]},
        {"$set": {"status": to}},
        return_document=ReturnDocument.AFTER,
        projection={"_id": 0},
    )
    await record_usage_event(db, current_user["user_id"], IDEA_STATUS_CHANGED)
    assert doc is not None  # single-user doc, matched above — update cannot miss
    return SavedIdea(**doc)


@router.patch("/board/{idea_id}/tags", response_model=SavedIdea)
async def update_tags(
    idea_id: str,
    data: TagsUpdateRequest,
    current_user: dict[str, str] = Depends(get_current_user),
    db: Any = Depends(get_db),
) -> SavedIdea:
    await _get_owned_idea(db, current_user["user_id"], idea_id)
    doc = await db.saved_ideas.find_one_and_update(
        {"id": idea_id, "user_id": current_user["user_id"]},
        {"$set": {"tags": normalize_tags(data.tags)}},
        return_document=ReturnDocument.AFTER,
        projection={"_id": 0},
    )
    assert doc is not None
    return SavedIdea(**doc)
