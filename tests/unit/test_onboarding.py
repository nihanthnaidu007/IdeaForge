"""Onboarding progress: routes, real-event auto-advance, dismiss/replay.

Spec (Wave 1 §Onboarding): the checklist mirrors reality — a successful
research run IS the first-sweep event, a successful forge IS the first-forge
event, and no client route can post a completion. Dismissal is permanent
until a Settings replay, which never resets completed state.
"""

from __future__ import annotations

import json
from typing import Any

import pytest
from app.routers import ideas as ideas_module
from app.routers import research as research_module
from app.services import onboarding as onboarding_service

from tests.conftest import store_tavily_key
from tests.unit.fakes import FakeDatabase, RecordingLLM
from tests.unit.test_trend_enrichment import _AlwaysOkTavily, _tavily_payload

_IDEAS_JSON = json.dumps(
    [{"title": "Idea A", "rating": 8.0, "rating_explanation": "strong"}]
)

_RAW_TRENDS = [
    {
        "title": "Agents eat SaaS",
        "snippet": "Everyone is rebuilding workflows around agents.",
        "url": "https://example.com/agents",
        "source": "AI agents",
    }
]


def _llm_returning(llm: RecordingLLM):
    async def _llm(*args: Any, **kwargs: Any) -> Any:
        return llm

    return _llm


def _default_body() -> dict[str, Any]:
    return {
        "steps": {
            "welcome": "current",
            "first_sweep": "pending",
            "first_forge": "pending",
        },
        "completed_at": None,
        "dismissed_at": None,
    }


# --- route contract -------------------------------------------------------------


async def test_get_onboarding_defaults_on_first_read(client, auth_headers) -> None:
    response = await client.get("/api/onboarding", headers=auth_headers)
    assert response.status_code == 200, response.text
    assert response.json() == _default_body()


async def test_onboarding_requires_auth(client) -> None:
    # The app's auth middleware answers tokenless calls with 403 (origin
    # gate), not 401 — match the observed contract, not the RFC default.
    response = await client.get("/api/onboarding")
    assert response.status_code == 403


async def test_first_read_writes_nothing(client, auth_headers) -> None:
    """The doc lands only on real events — a fresh user's GET is a pure read."""
    db = client._transport.app.state.db
    await client.get("/api/onboarding", headers=auth_headers)
    assert db.onboarding_progress.docs == {}


async def test_welcome_completion_is_idempotent_and_advances_current(
    client, auth_headers
) -> None:
    first = await client.post("/api/onboarding/welcome", headers=auth_headers)
    assert first.status_code == 200, first.text
    body = first.json()
    assert body["steps"]["welcome"] == "done"
    assert body["steps"]["first_sweep"] == "current"
    assert body["steps"]["first_forge"] == "pending"
    assert body["completed_at"] is None

    again = await client.post("/api/onboarding/welcome", headers=auth_headers)
    assert again.status_code == 200, again.text
    assert again.json()["steps"] == body["steps"]


async def test_dismiss_persists_and_keeps_steps(client, auth_headers) -> None:
    await client.post("/api/onboarding/welcome", headers=auth_headers)
    dismissed = await client.post("/api/onboarding/dismiss", headers=auth_headers)
    assert dismissed.status_code == 200, dismissed.text
    body = dismissed.json()
    assert body["dismissed_at"] is not None
    assert body["steps"]["welcome"] == "done"  # reality, not the dismissal

    # Idempotent: a second dismissal keeps the original step states.
    again = await client.post("/api/onboarding/dismiss", headers=auth_headers)
    assert again.status_code == 200
    assert again.json()["steps"] == body["steps"]
    assert again.json()["dismissed_at"] is not None


async def test_replay_clears_dismissal_without_resetting_state(
    client, auth_headers
) -> None:
    """The replay assertion: re-open the guide, keep every completed step."""
    await client.post("/api/onboarding/welcome", headers=auth_headers)
    await client.post("/api/onboarding/dismiss", headers=auth_headers)

    replayed = await client.post("/api/onboarding/replay", headers=auth_headers)
    assert replayed.status_code == 200, replayed.text
    body = replayed.json()
    assert body["dismissed_at"] is None
    # State preserved — NOT reset to defaults.
    assert body["steps"]["welcome"] == "done"
    assert body["steps"]["first_sweep"] == "current"
    assert body["steps"]["first_forge"] == "pending"


async def test_replay_on_a_completed_flow_keeps_completed_at(
    client, auth_headers, monkeypatch
) -> None:
    """Replay re-opens the guide; it never claims the work is undone."""
    llm = RecordingLLM([_IDEAS_JSON])
    monkeypatch.setattr(ideas_module, "get_llm", _llm_returning(llm))
    forge = await client.post(
        "/api/generate-ideas",
        json={"raw_trends": _RAW_TRENDS, "niche": "AI", "tone": "professional"},
        headers=auth_headers,
    )
    assert forge.status_code == 200, forge.text

    await client.post("/api/onboarding/dismiss", headers=auth_headers)
    replayed = await client.post("/api/onboarding/replay", headers=auth_headers)
    body = replayed.json()
    assert body["dismissed_at"] is None
    assert body["steps"]["first_forge"] == "done"


# --- real-event auto-advance -----------------------------------------------------


async def test_successful_research_marks_first_sweep(
    client, auth_headers, monkeypatch
) -> None:
    await client.post("/api/onboarding/welcome", headers=auth_headers)
    await store_tavily_key(client, auth_headers)
    client._transport.app.state.http_client = _AlwaysOkTavily(_tavily_payload())
    monkeypatch.setattr(
        research_module,
        "get_llm",
        _llm_returning(RecordingLLM([json.dumps({"trends": []})])),
    )

    response = await client.post(
        "/api/research",
        json={"niche": "AI", "tone": "professional"},
        headers=auth_headers,
    )
    assert response.status_code == 200, response.text

    progress = await client.get("/api/onboarding", headers=auth_headers)
    body = progress.json()
    assert body["steps"]["first_sweep"] == "done"
    assert body["steps"]["first_forge"] == "current"
    assert body["completed_at"] is None


async def test_failed_research_does_not_advance(client, auth_headers) -> None:
    """No Tavily key (and no server default) → typed 400, checklist untouched."""
    response = await client.post(
        "/api/research",
        json={"niche": "AI", "tone": "professional"},
        headers=auth_headers,
    )
    assert response.status_code == 400, response.text

    progress = await client.get("/api/onboarding", headers=auth_headers)
    assert progress.json() == _default_body()


async def test_successful_forge_marks_first_forge(
    client, auth_headers, monkeypatch
) -> None:
    """A forge alone marks its step — the flow is done only when all are."""
    llm = RecordingLLM([_IDEAS_JSON])
    monkeypatch.setattr(ideas_module, "get_llm", _llm_returning(llm))

    response = await client.post(
        "/api/generate-ideas",
        json={"raw_trends": _RAW_TRENDS, "niche": "AI", "tone": "professional"},
        headers=auth_headers,
    )
    assert response.status_code == 200, response.text

    progress = await client.get("/api/onboarding", headers=auth_headers)
    body = progress.json()
    assert body["steps"]["first_forge"] == "done"
    # welcome/first_sweep outstanding — the flow is not complete.
    assert body["completed_at"] is None


async def test_forge_out_of_order_leaves_first_sweep_pending(
    client, auth_headers, monkeypatch
) -> None:
    """Mirror of reality: forge before any research leaves first_sweep not done."""
    await client.post("/api/onboarding/welcome", headers=auth_headers)
    llm = RecordingLLM([_IDEAS_JSON])
    monkeypatch.setattr(ideas_module, "get_llm", _llm_returning(llm))
    response = await client.post(
        "/api/generate-ideas",
        json={"raw_trends": _RAW_TRENDS, "niche": "AI", "tone": "professional"},
        headers=auth_headers,
    )
    assert response.status_code == 200, response.text

    progress = await client.get("/api/onboarding", headers=auth_headers)
    body = progress.json()
    assert body["steps"]["first_sweep"] == "current"  # the real next action
    assert body["steps"]["first_forge"] == "done"


async def test_full_journey_research_then_forge_completes(
    client, auth_headers, monkeypatch
) -> None:
    """Research → forge in sequence: all steps done, completed_at stamped."""
    await client.post("/api/onboarding/welcome", headers=auth_headers)
    await store_tavily_key(client, auth_headers)
    client._transport.app.state.http_client = _AlwaysOkTavily(_tavily_payload())
    monkeypatch.setattr(
        research_module,
        "get_llm",
        _llm_returning(RecordingLLM([json.dumps({"trends": []})])),
    )
    await client.post(
        "/api/research",
        json={"niche": "AI", "tone": "professional"},
        headers=auth_headers,
    )

    forge_llm = RecordingLLM([_IDEAS_JSON])
    monkeypatch.setattr(ideas_module, "get_llm", _llm_returning(forge_llm))
    await client.post(
        "/api/generate-ideas",
        json={"raw_trends": _RAW_TRENDS, "niche": "AI", "tone": "professional"},
        headers=auth_headers,
    )

    progress = await client.get("/api/onboarding", headers=auth_headers)
    body = progress.json()
    assert all(status == "done" for status in body["steps"].values())
    assert body["completed_at"] is not None
    assert body["dismissed_at"] is None


# --- service-level units -------------------------------------------------------


async def test_advance_on_event_never_raises(fake_db: FakeDatabase, monkeypatch) -> None:
    """A broken progress write must not break the research/forge it observes."""

    async def _explode(*args: Any, **kwargs: Any) -> Any:
        raise RuntimeError("mongo down")

    monkeypatch.setattr(onboarding_service, "complete_step", _explode)
    await onboarding_service.advance_on_event(
        fake_db, "u1", onboarding_service.STEP_FIRST_SWEEP
    )


async def test_complete_step_rejects_unknown_step(fake_db: FakeDatabase) -> None:
    with pytest.raises(ValueError):
        await onboarding_service.complete_step(fake_db, "u1", "not_a_step")
