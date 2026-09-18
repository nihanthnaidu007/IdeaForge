"""Export routes — Markdown, CSV, and ICS downloads (spec §Draft Queue & Export).

Exports are the compliant ceiling's delivery mechanism: files leave with the
user, nothing posts anywhere. All serialization is pure (services/exporter.py);
these routes own auth, ownership scoping, and response headers only.
"""

from __future__ import annotations

from datetime import UTC, datetime
from typing import Any

from fastapi import APIRouter, Depends, Query
from fastapi.responses import PlainTextResponse

from app.deps import get_current_user, get_db
from app.routers.board import filter_ideas
from app.services.exporter import ideas_to_csv, ideas_to_markdown, scheduled_to_ics
from app.services.usage import POSTS_EXPORTED, record_usage_event

router = APIRouter()

_MAX_EXPORT_ROWS = 500


async def _owned_ideas(db: Any, user_id: str) -> list[dict[str, Any]]:
    docs = await db.saved_ideas.find({"user_id": user_id}, {"_id": 0}).to_list(
        _MAX_EXPORT_ROWS
    )
    # Sorted oldest-first for a stable, diff-friendly export.
    docs.sort(key=lambda d: d.get("created_at", ""))
    return docs


def _attachment(filename: str, content: str, media_type: str) -> PlainTextResponse:
    return PlainTextResponse(
        content=content,
        media_type=media_type,
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


@router.get("/export/ideas.md")
async def export_ideas_markdown(
    status: str | None = Query(default=None),
    tag: str | None = Query(default=None),
    q: str | None = Query(default=None),
    current_user: dict[str, str] = Depends(get_current_user),
    db: Any = Depends(get_db),
) -> PlainTextResponse:
    ideas = filter_ideas(await _owned_ideas(db, current_user["user_id"]), q=q, tag=tag, status=status)
    stamp = datetime.now(UTC).strftime("%Y%m%d")
    await record_usage_event(
        db, current_user["user_id"], POSTS_EXPORTED, count=len(ideas)
    )
    return _attachment(
        f"ideaforge-board-{stamp}.md", ideas_to_markdown(ideas), "text/markdown; charset=utf-8"
    )


@router.get("/export/ideas.csv")
async def export_ideas_csv(
    status: str | None = Query(default=None),
    tag: str | None = Query(default=None),
    q: str | None = Query(default=None),
    current_user: dict[str, str] = Depends(get_current_user),
    db: Any = Depends(get_db),
) -> PlainTextResponse:
    ideas = filter_ideas(await _owned_ideas(db, current_user["user_id"]), q=q, tag=tag, status=status)
    stamp = datetime.now(UTC).strftime("%Y%m%d")
    await record_usage_event(
        db, current_user["user_id"], POSTS_EXPORTED, count=len(ideas)
    )
    return _attachment(
        f"ideaforge-board-{stamp}.csv", ideas_to_csv(ideas), "text/csv; charset=utf-8"
    )


@router.get("/export/reminders.ics")
async def export_reminders_ics(
    current_user: dict[str, str] = Depends(get_current_user),
    db: Any = Depends(get_db),
) -> PlainTextResponse:
    ideas = await _owned_ideas(db, current_user["user_id"])
    stamp = datetime.now(UTC).strftime("%Y%m%d")
    return _attachment(
        f"ideaforge-reminders-{stamp}.ics",
        scheduled_to_ics(ideas),
        "text/calendar; charset=utf-8",
    )
