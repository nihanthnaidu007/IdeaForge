"""Onboarding progress — per-user, server-side, a mirror of real events.

Spec (Wave 1 §Onboarding): the checklist is a mirror of reality, not homework.
Steps advance when the real product event happens (first successful research
run, first successful forge), never on a timer and never as homework the user
must report. Dismissal is permanent until the user explicitly replays the
guide from Settings, and a replay never resets completed state.

The document shape follows the spec's example::

    {"user_id": "...",
     "steps": {"welcome": "done", "first_sweep": "current", "first_forge": "pending"},
     "completed_at": null, "dismissed_at": null}

Writes are read-modify-write with monotone transitions (pending → current →
done only), so a concurrent second event can at worst repeat an idempotent
write — a done step never reverts. That race is two same-user requests
arriving in the same instant on a UI checklist; losing it cannot misstate
what the user did (the next real event re-advances).
"""

from __future__ import annotations

import logging
from datetime import UTC, datetime
from typing import Any

logger = logging.getLogger("app.onboarding")

STEP_WELCOME = "welcome"
STEP_FIRST_SWEEP = "first_sweep"
STEP_FIRST_FORGE = "first_forge"
# Order is the guide's narrative order: live mat → first sweep → first forge.
STEP_ORDER: tuple[str, ...] = (STEP_WELCOME, STEP_FIRST_SWEEP, STEP_FIRST_FORGE)

STATUS_DONE = "done"
STATUS_CURRENT = "current"
STATUS_PENDING = "pending"


def default_steps() -> dict[str, str]:
    """Fresh state: the user is on the welcome mat, everything else pending."""
    return {
        STEP_WELCOME: STATUS_CURRENT,
        STEP_FIRST_SWEEP: STATUS_PENDING,
        STEP_FIRST_FORGE: STATUS_PENDING,
    }


def _steps_of(doc: dict[str, Any] | None) -> dict[str, str]:
    raw = (doc or {}).get("steps") or {}
    steps = default_steps()
    for step in STEP_ORDER:
        value = raw.get(step)
        if value in (STATUS_DONE, STATUS_CURRENT, STATUS_PENDING):
            steps[step] = value
    return steps


def _current_step(steps: dict[str, str]) -> str | None:
    """The first not-done step in narrative order — what to do next."""
    for step in STEP_ORDER:
        if steps[step] != STATUS_DONE:
            return step
    return None


def _iso(value: Any) -> str | None:
    if isinstance(value, datetime):
        return value.isoformat()
    return None


def build_progress_response(doc: dict[str, Any] | None) -> dict[str, Any]:
    """Normalized API shape — every step materialized, timestamps as ISO."""
    steps = _steps_of(doc)
    all_done = all(steps[step] == STATUS_DONE for step in STEP_ORDER)
    current = None if all_done else (_current_step(steps) or STEP_WELCOME)
    if current is not None:
        steps[current] = STATUS_CURRENT
    return {
        "steps": steps,
        "completed_at": _iso((doc or {}).get("completed_at")),
        "dismissed_at": _iso((doc or {}).get("dismissed_at")),
    }


async def get_progress(db: Any, user_id: str) -> dict[str, Any]:
    """Materialized progress for the user (defaults when never written)."""
    doc = await db.onboarding_progress.find_one({"user_id": user_id}, {"_id": 0})
    return build_progress_response(doc)


async def complete_step(db: Any, user_id: str, step: str) -> dict[str, Any]:
    """Mark one step done (idempotent) and aim `current` at the next one.

    ``completed_at`` lands when every step is done — the flow's own completion,
    which Settings replay later shows without resetting.
    """
    if step not in STEP_ORDER:
        raise ValueError(f"unknown onboarding step '{step}'")
    existing = await db.onboarding_progress.find_one({"user_id": user_id})
    steps = _steps_of(existing)
    steps[step] = STATUS_DONE
    now = datetime.now(UTC)
    all_done = all(s == STATUS_DONE for s in steps.values())
    update: dict[str, Any] = {
        "$set": {
            "steps": steps,
            "completed_at": now if all_done else (existing or {}).get("completed_at"),
            "updated_at": now,
        },
        "$setOnInsert": {"user_id": user_id},
    }
    await db.onboarding_progress.update_one({"user_id": user_id}, update, upsert=True)
    return await get_progress(db, user_id)


async def mark_dismissed(db: Any, user_id: str) -> dict[str, Any]:
    """Permanent-for-the-dismissal dismissal: the flow hides until a replay.

    Step statuses are deliberately untouched — dismiss changes what is
    visible, never what the user has actually done.
    """
    now = datetime.now(UTC)
    await db.onboarding_progress.update_one(
        {"user_id": user_id},
        {
            "$set": {"dismissed_at": now, "updated_at": now},
            "$setOnInsert": {"user_id": user_id, "steps": default_steps()},
        },
        upsert=True,
    )
    return await get_progress(db, user_id)


async def reopen(db: Any, user_id: str) -> dict[str, Any]:
    """Replay: clear the dismissal, keep every completed step and timestamp."""
    await db.onboarding_progress.update_one(
        {"user_id": user_id}, {"$unset": {"dismissed_at": ""}}
    )
    return await get_progress(db, user_id)


async def advance_on_event(db: Any, user_id: str, step: str) -> None:
    """Auto-advance hook for real product events (research/forge success).

    Secondary to the event it observes — exactly the usage-event rule: the
    primary action already succeeded, so a failed advance never surfaces as an
    error to the user, but it is never silent either (structured log).
    """
    try:
        await complete_step(db, user_id, step)
    except Exception:
        logger.exception(
            "onboarding advance failed (user=%s step=%s) — progress may lag",
            user_id,
            step,
        )
