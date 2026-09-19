"""Pydantic request/response schemas, split 1:1 with routers."""

from app.models.auth import (
    LogoutRequest,
    RefreshRequest,
    TokenResponse,
    UserCreate,
    UserLogin,
)
from app.models.ideas import GenerateIdeasRequest, IdeaInsightsRequest
from app.models.posts import GeneratePostRequest, TweakPostRequest
from app.models.preferences import PreferencesUpdate
from app.models.research import ResearchRequest
from app.models.saved import SavedIdea, SaveIdeaRequest

__all__ = [
    "GenerateIdeasRequest",
    "GeneratePostRequest",
    "IdeaInsightsRequest",
    "LogoutRequest",
    "PreferencesUpdate",
    "RefreshRequest",
    "ResearchRequest",
    "SavedIdea",
    "SaveIdeaRequest",
    "TokenResponse",
    "TweakPostRequest",
    "UserCreate",
    "UserLogin",
]
