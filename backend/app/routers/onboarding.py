"""Onboarding progress routes — read + explicit progress actions.

The progress document itself is written server-side on real events
(first successful research → first_sweep, first successful forge →
first_forge, see services/onboarding) — there is deliberately no
"complete step" route for clients to post, because the checklist mirrors
reality rather than homework. These routes cover the rest of the contract:
the initial read, leaving the welcome mat, the permanent dismissal, and the
Settings replay that re-opens the guide without resetting state.
"""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Depends

from app.deps import get_current_user, get_db
from app.services import onboarding

router = APIRouter()


@router.get("/onboarding")
async def get_onboarding(
    current_user: dict[str, str] = Depends(get_current_user),
    db: Any = Depends(get_db),
) -> dict[str, Any]:
    """Materialized progress for the signed-in user (defaults on first read)."""
    return await onboarding.get_progress(db, current_user["user_id"])


@router.post("/onboarding/welcome")
async def complete_welcome(
    current_user: dict[str, str] = Depends(get_current_user),
    db: Any = Depends(get_db),
) -> dict[str, Any]:
    """The user left the welcome mat via its CTA — the welcome step is done."""
    return await onboarding.complete_step(
        db, current_user["user_id"], onboarding.STEP_WELCOME
    )


@router.post("/onboarding/dismiss")
async def dismiss_onboarding(
    current_user: dict[str, str] = Depends(get_current_user),
    db: Any = Depends(get_db),
) -> dict[str, Any]:
    """Permanent dismissal: the guide hides until Settings replay. Steps kept."""
    return await onboarding.mark_dismissed(db, current_user["user_id"])


@router.post("/onboarding/replay")
async def replay_onboarding(
    current_user: dict[str, str] = Depends(get_current_user),
    db: Any = Depends(get_db),
) -> dict[str, Any]:
    """Re-open the guide. Completed state is preserved, never reset."""
    return await onboarding.reopen(db, current_user["user_id"])
