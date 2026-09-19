"""Health routes: GET /api/ (root ping, scaffold contract), /health/live, /health/ready."""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Depends
from starlette.responses import JSONResponse

from app.deps import get_db

api_router = APIRouter()
live_router = APIRouter()


@api_router.get("/")
async def root() -> dict[str, str]:
    return {"message": "IdeaForge API is running"}


@live_router.get("/health/live")
async def health_live() -> dict[str, str]:
    return {"status": "ok"}


@live_router.get("/health/ready")
async def health_ready(db: Any = Depends(get_db)) -> JSONResponse:
    try:
        await db.command("ping")
    except Exception:
        return JSONResponse(
            status_code=503,
            content={"status": "unavailable", "mongo": "unreachable"},
        )
    return JSONResponse(
        status_code=200, content={"status": "ok", "mongo": "ok"}
    )
