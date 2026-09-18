"""Hook Bank routes: filtered listing + CRUD for user-saved hooks.

Builtins are read-only catalog rows (the craft pack's ~48 seed patterns, one
document per pattern×format); users save their own patterns alongside. The
inventory invariant holds everywhere: a pattern with a {stat}/{source_name}
slot MUST carry requires_source — user-created patterns get the tag added at
creation, never trust the client tag list blindly.
"""

from __future__ import annotations

import uuid
from datetime import UTC, datetime
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Query

from app.deps import get_current_user, get_db
from app.models.hooks import HookCreate, HookUpdate
from app.services.hooks import hook_response, pattern_needs_source

router = APIRouter()


def _ensure_source_tag(tags: list[str], pattern: str) -> list[str]:
    if pattern_needs_source(pattern) and "requires_source" not in tags:
        return [*tags, "requires_source"]
    return tags


async def _load_hook(db: Any, hook_id: str) -> dict[str, Any] | None:
    return await db.hooks.find_one({"id": hook_id})


@router.get("/hooks")
async def list_hooks(
    style: str | None = Query(default=None),
    format: str | None = Query(default=None),
    mine: bool = Query(default=False),
    current_user: dict[str, str] = Depends(get_current_user),
    db: Any = Depends(get_db),
) -> dict[str, Any]:
    """Catalog + user hooks. Builtin rows first (stable H-ID order), then the
    user's own. Filters narrow by style archetype, post format, or ownership."""
    query: dict[str, Any] = {}
    if style:
        query["style"] = style
    if format:
        query["format"] = format
    if mine:
        query["user_id"] = current_user["user_id"]
        query["is_builtin"] = False

    rows = await db.hooks.find(query).to_list(None)
    builtins = sorted(
        (r for r in rows if r.get("is_builtin")), key=lambda r: (r["id"], r["format"])
    )
    own = [r for r in rows if not r.get("is_builtin")]
    return {
        "hooks": [hook_response(r) for r in [*builtins, *own]],
        "total": len(rows),
    }


@router.post("/hooks")
async def create_hook(
    data: HookCreate,
    current_user: dict[str, str] = Depends(get_current_user),
    db: Any = Depends(get_db),
) -> dict[str, Any]:
    tags = _ensure_source_tag(list(data.tags), data.text_pattern)
    doc = {
        "id": f"U-{uuid.uuid4().hex[:12]}",
        "text_pattern": data.text_pattern,
        "style": data.style,
        "format": data.format,
        "tags": tags,
        "is_builtin": False,
        "user_id": current_user["user_id"],
        "created_at": datetime.now(UTC),
    }
    await db.hooks.insert_one(doc)
    return hook_response(doc)


@router.put("/hooks/{hook_id}")
async def update_hook(
    hook_id: str,
    data: HookUpdate,
    current_user: dict[str, str] = Depends(get_current_user),
    db: Any = Depends(get_db),
) -> dict[str, Any]:
    hook = await _load_hook(db, hook_id)
    if hook is None:
        raise HTTPException(status_code=404, detail="Hook not found.")
    if hook.get("is_builtin") or hook.get("user_id") != current_user["user_id"]:
        raise HTTPException(
            status_code=404, detail="Builtin hooks are read-only; save your own copy."
        )

    updates = data.model_dump(exclude_unset=True)
    if "text_pattern" in updates and updates["text_pattern"] is not None:
        updates["tags"] = _ensure_source_tag(
            list(hook.get("tags", [])), updates["text_pattern"]
        )
    if updates:
        await db.hooks.update_one({"id": hook_id}, {"$set": updates})
    updated = await _load_hook(db, hook_id)
    return hook_response(updated)


@router.delete("/hooks/{hook_id}")
async def delete_hook(
    hook_id: str,
    current_user: dict[str, str] = Depends(get_current_user),
    db: Any = Depends(get_db),
) -> dict[str, Any]:
    hook = await _load_hook(db, hook_id)
    if hook is None:
        raise HTTPException(status_code=404, detail="Hook not found.")
    if hook.get("is_builtin") or hook.get("user_id") != current_user["user_id"]:
        raise HTTPException(status_code=404, detail="Builtin hooks are read-only.")
    await db.hooks.delete_one({"id": hook_id})
    return {"deleted": hook_id}
