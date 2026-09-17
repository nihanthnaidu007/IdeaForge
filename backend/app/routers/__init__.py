"""API router aggregation — /api/* routes mirror the scaffold's 16-route shape."""

from fastapi import APIRouter

from app.routers import (
    analytics,
    auth,
    board,
    export,
    health,
    ideas,
    posts,
    preferences,
    preview,
    queue,
    research,
    saved,
)

api_router = APIRouter(prefix="/api")
api_router.include_router(health.api_router)
api_router.include_router(auth.router)
api_router.include_router(research.router)
api_router.include_router(ideas.router)
api_router.include_router(posts.router)
api_router.include_router(saved.router)
api_router.include_router(preferences.router)
api_router.include_router(analytics.router)
api_router.include_router(board.router)
api_router.include_router(queue.router)
api_router.include_router(export.router)
api_router.include_router(preview.router)
