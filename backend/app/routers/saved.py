"""Saved-idea routes — the Content Board's storage seed. Contracts identical
to the scaffold; status/tags/board views land with the board PR."""

from __future__ import annotations

import uuid
from datetime import UTC, datetime
from typing import Any

from fastapi import APIRouter, Depends, HTTPException
from pymongo import ReturnDocument

from app.deps import get_current_user, get_db
from app.models.saved import SavedIdea, SaveIdeaRequest

router = APIRouter()


@router.post("/save-idea", response_model=SavedIdea)
async def save_idea(
    data: SaveIdeaRequest,
    current_user: dict[str, str] = Depends(get_current_user),
    db: Any = Depends(get_db),
) -> SavedIdea:
    idea_doc = {
        "id": str(uuid.uuid4()),
        "user_id": current_user["user_id"],
        "topic_title": data.topic_title,
        "rating": data.rating,
        "rating_explanation": data.rating_explanation,
        "targeted_audience": data.targeted_audience,
        "why_it_matters": data.why_it_matters,
        "key_aspects": data.key_aspects,
        "generated_post": data.generated_post,
        "post_format": data.post_format,
        "niche": data.niche,
        "tone": data.tone,
        "created_at": datetime.now(UTC).isoformat(),
        "is_bookmarked": data.is_bookmarked,
    }
    await db.saved_ideas.insert_one(idea_doc)
    return SavedIdea(**idea_doc)


@router.get("/saved", response_model=list[SavedIdea])
async def get_saved_ideas(
    current_user: dict[str, str] = Depends(get_current_user),
    db: Any = Depends(get_db),
) -> list[SavedIdea]:
    ideas = (
        await db.saved_ideas.find({"user_id": current_user["user_id"]}, {"_id": 0})
        .sort("created_at", -1)
        .to_list(100)
    )
    return [SavedIdea(**idea) for idea in ideas]


@router.delete("/saved/{idea_id}")
async def delete_saved_idea(
    idea_id: str,
    current_user: dict[str, str] = Depends(get_current_user),
    db: Any = Depends(get_db),
) -> dict[str, str]:
    result = await db.saved_ideas.delete_one(
        {"id": idea_id, "user_id": current_user["user_id"]}
    )
    if result.deleted_count == 0:
        raise HTTPException(status_code=404, detail="Idea not found")
    return {"message": "Idea deleted"}


@router.patch("/saved/{idea_id}/bookmark")
async def toggle_bookmark(
    idea_id: str,
    current_user: dict[str, str] = Depends(get_current_user),
    db: Any = Depends(get_db),
) -> dict[str, bool]:
    # Single atomic flip (pipeline update) instead of the scaffold's
    # find-then-set — two rapid toggles can no longer clobber each other.
    doc = await db.saved_ideas.find_one_and_update(
        {"id": idea_id, "user_id": current_user["user_id"]},
        [{"$set": {"is_bookmarked": {"$not": "$is_bookmarked"}}}],
        return_document=ReturnDocument.AFTER,
        projection={"_id": 0, "is_bookmarked": 1},
    )
    if doc is None:
        raise HTTPException(status_code=404, detail="Idea not found")
    return {"is_bookmarked": bool(doc["is_bookmarked"])}
