"""Usage-cap read route — the Settings banner's honest allowance display.

One authenticated read: current bundled usage per resource against its
operator-configured limit, when the allowance resets, and whether the user
is on BYOK (uncapped) for that resource. Read-only — enforcement happens at
the key-resolution seam, never here.
"""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Depends

from app.config import Settings
from app.deps import get_current_user, get_db, get_settings_dep
from app.services import usage as usage_counters

router = APIRouter()

# Which server-default providers can serve each resource — the same 1:1
# product mapping the enforcement seam uses (research runs on Tavily,
# model calls on Anthropic/OpenAI).
_PROVIDERS_FOR_RESOURCE: dict[str, tuple[str, ...]] = {
    usage_counters.RESOURCE_RESEARCH: ("tavily",),
    usage_counters.RESOURCE_LLM: ("anthropic", "openai"),
}


def _has_byok_for_resource(prefs: dict[str, Any] | None, resource: str) -> bool:
    keys = (prefs or {}).get("keys") or {}
    return any(bool(keys.get(p)) for p in _PROVIDERS_FOR_RESOURCE[resource])


def _bundled_available(settings: Settings, resource: str) -> bool:
    return any(
        getattr(settings, f"{p}_api_key", None) is not None
        for p in _PROVIDERS_FOR_RESOURCE[resource]
    )


@router.get("/usage/caps")
async def usage_caps(
    current_user: dict[str, str] = Depends(get_current_user),
    db: Any = Depends(get_db),
    settings: Settings = Depends(get_settings_dep),
) -> dict[str, Any]:
    """Bundled allowance state for the signed-in user (honest, per resource)."""
    user_id = current_user["user_id"]
    prefs = await db.user_preferences.find_one({"user_id": user_id}, {"_id": 0})

    resources: dict[str, Any] = {}
    for resource in (usage_counters.RESOURCE_LLM, usage_counters.RESOURCE_RESEARCH):
        limit = usage_counters.bundled_daily_limit(settings, resource)
        used = await usage_counters.read_daily_usage(db, user_id, resource)
        resources[resource] = {
            "used": used,
            "limit": limit,
            # Facts, not copy: the server knows whether it can fall back to a
            # bundled key for this resource, and whether the user's own key
            # (uncapped, uncounted) is connected.
            "bundled_available": _bundled_available(settings, resource),
            "byok_connected": _has_byok_for_resource(prefs, resource),
        }

    return {
        "resources": resources,
        "resets_at": usage_counters.daily_usage_reset_at().isoformat(),
    }
