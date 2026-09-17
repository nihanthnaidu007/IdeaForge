"""Voice DNA: extraction, versioning, and retrieval-into-prompt conditioning.

Spec verification criterion #4: the extracted style profile is stored,
versioned, and its descriptors appear in subsequent generation prompts
(captured at the LLM seam). Fast tier — repository fakes + LLM stubs at the
import seam; no live provider calls ever.
"""

from __future__ import annotations

import json
from typing import Any

import pytest
from app.routers import posts as posts_module
from app.routers import voice as voice_module

from tests.unit.fakes import RecordingLLM as _RecordingLLM
from tests.unit.fakes import stub_get_llm as _stub_get_llm


def _valid_profile(sample_count: int = 3) -> dict[str, Any]:
    """A VoiceDNAProfile-shaped payload the stub extractor returns."""
    return {
        "schema_version": 1,
        "sample_count": sample_count,
        "structure": {
            "opening_pattern": "Opens with a direct claim, no greeting",
            "body_pattern": "Short argument blocks, one idea per line",
            "closing_pattern": "Ends with a question to the reader",
            "paragraph_style": "One to two sentences per paragraph",
            "line_break_habit": "beat_based",
        },
        "vocabulary": {
            "register": "technical-casual with product analogies",
            "jargon_level": "light",
            "signature_phrases": ["the boring answer"],
            "verb_energy": "declarative",
        },
        "energy": {
            "overall_level": 4,
            "punctuation_style": "no exclamation marks, heavy em-dashes",
            "emoji_use": "none",
            "emphasis_tactics": "bare assertion",
        },
        "sentence_rhythm": {
            "avg_sentence_length_words": 12.5,
            "variation": "long setup, then a three-word punch line",
            "fragment_use": "occasional",
        },
        "signature_moves": [
            {
                "move": "ends a claim with a one-line proof from own data",
                "evidence": "we shipped it in two days",
            },
            {
                "move": "closes with a reader question",
                "evidence": "what would you do?",
            },
        ],
        "do_list": [
            "Open posts with a direct claim",
            "Never use emoji",
            "Close with a question to the reader",
        ],
        "dont_list": ["No hashtag spam", "No flattery openers", "No fabricated anecdotes"],
        "confidence": 0.82,
        "notes": "Samples agree on register",
    }


def _profile_response(payload: dict[str, Any]) -> str:
    return json.dumps(payload)


_SAMPLES = [
    "I spent six months migrating our stack. The boring answer won.",
    "Everyone is buying tools. Nobody is reading the docs. The boring answer wins again.",
    "Shipped a rewrite in two days by deleting code, not adding it. What would you do?",
]


async def _extract(client, auth_headers, monkeypatch, responses: list[str]) -> dict:
    capture: list[_RecordingLLM] = []
    monkeypatch.setattr(
        voice_module, "get_llm", _stub_get_llm(responses, capture=capture)
    )
    response = await client.post(
        "/api/voice/profile",
        json={"samples": _SAMPLES},
        headers=auth_headers,
    )
    assert response.status_code == 200, response.text
    return response.json()


# --- extraction: stored and versioned ----------------------------------------


async def test_extraction_stores_versioned_profile(
    client, auth_headers, monkeypatch
) -> None:
    body = await _extract(
        client, auth_headers, monkeypatch, [_profile_response(_valid_profile())]
    )
    assert body["version"] == 1
    assert body["total_versions"] == 1
    assert body["confidence"] == pytest.approx(0.82)
    assert body["profile"]["structure"]["opening_pattern"] == (
        "Opens with a direct claim, no greeting"
    )
    assert body["do_list"][0] == "Open posts with a direct claim"

    followup = await client.get("/api/voice/profile", headers=auth_headers)
    assert followup.status_code == 200
    assert followup.json()["version"] == 1


async def test_reextraction_appends_version_newest_first(
    client, auth_headers, monkeypatch
) -> None:
    updated = _valid_profile()
    updated["confidence"] = 0.95
    await _extract(
        client, auth_headers, monkeypatch, [_profile_response(_valid_profile())]
    )
    body = await _extract(
        client, auth_headers, monkeypatch, [_profile_response(updated)]
    )
    assert body["version"] == 2
    assert body["confidence"] == pytest.approx(0.95)

    versions = await client.get("/api/voice/profile/versions", headers=auth_headers)
    rows = versions.json()["versions"]
    assert [r["version"] for r in rows] == [2, 1]
    assert all(r["source"] == "extraction" for r in rows)


async def test_edit_appends_manual_version_and_keeps_history(
    client, auth_headers, monkeypatch
) -> None:
    await _extract(
        client, auth_headers, monkeypatch, [_profile_response(_valid_profile())]
    )
    response = await client.put(
        "/api/voice/profile",
        json={"do_list": ["Open with a stat", "No emoji", "Close with a question"]},
        headers=auth_headers,
    )
    assert response.status_code == 200, response.text
    body = response.json()
    assert body["version"] == 2
    assert body["source"] == "manual_edit"
    assert body["do_list"] == [
        "Open with a stat",
        "No emoji",
        "Close with a question",
    ]
    # History is never rewritten: v1 still carries the extracted list.
    rows = (await client.get("/api/voice/profile/versions", headers=auth_headers)).json()[
        "versions"
    ]
    assert [r["version"] for r in rows] == [2, 1]
    assert rows[1]["do_list"][0] == "Open posts with a direct claim"


async def test_edit_without_profile_is_404(client, auth_headers) -> None:
    response = await client.put(
        "/api/voice/profile", json={"notes": "x"}, headers=auth_headers
    )
    assert response.status_code == 404


# --- retrieval-into-prompt: descriptors in captured generation prompts --------


async def test_generation_prompt_carries_profile_descriptors(
    client, auth_headers, monkeypatch
) -> None:
    await _extract(
        client, auth_headers, monkeypatch, [_profile_response(_valid_profile())]
    )
    capture: list[_RecordingLLM] = []
    monkeypatch.setattr(
        posts_module, "get_llm", _stub_get_llm(["A post."], capture=capture)
    )
    response = await client.post(
        "/api/generate-post",
        json={
            "idea": {"title": "RAG pipelines"},
            "tone": "professional",
            "format": "hot-take",
        },
        headers=auth_headers,
    )
    assert response.status_code == 200, response.text

    prompt = capture[0].calls[0]["prompt"]
    assert "=== VOICE DNA ===" in prompt
    # Descriptors from the extracted profile condition the prompt.
    assert "Opens with a direct claim, no greeting" in prompt  # structure
    assert "Open posts with a direct claim" in prompt
    assert "No hashtag spam" in prompt
    assert "the boring answer" in prompt  # signature phrase
    assert "what would you do?" not in prompt  # evidence quotes stay out

async def test_generation_without_profile_uses_neutral_fallback(
    client, auth_headers, monkeypatch
) -> None:
    capture: list[_RecordingLLM] = []
    monkeypatch.setattr(
        posts_module, "get_llm", _stub_get_llm(["A post."], capture=capture)
    )
    response = await client.post(
        "/api/generate-post",
        json={
            "idea": {"title": "RAG pipelines"},
            "tone": "professional",
            "format": "hot-take",
        },
        headers=auth_headers,
    )
    assert response.status_code == 200, response.text
    prompt = capture[0].calls[0]["prompt"]
    assert "No Voice DNA profile yet" in prompt
    assert "no emoji" in prompt


# --- honest failures ---------------------------------------------------------


async def test_extraction_without_any_key_is_typed_400(client, auth_headers) -> None:
    # No user key stored and no server env default: real resolution fails loud.
    response = await client.post(
        "/api/voice/profile", json={"samples": _SAMPLES}, headers=auth_headers
    )
    assert response.status_code == 400
    assert response.json()["kind"] == "MISSING_KEYS"


async def test_insufficient_samples_surfaces_as_502(
    client, auth_headers, monkeypatch
) -> None:
    monkeypatch.setattr(
        voice_module,
        "get_llm",
        _stub_get_llm([json.dumps({"error": "insufficient_samples"})]),
    )
    response = await client.post(
        "/api/voice/profile", json={"samples": _SAMPLES}, headers=auth_headers
    )
    assert response.status_code == 502
    assert response.json()["kind"] == "GENERATION_FAILED"


async def test_fewer_than_three_nonempty_samples_is_400(
    client, auth_headers, monkeypatch
) -> None:
    monkeypatch.setattr(voice_module, "get_llm", _stub_get_llm(["{}"]))
    response = await client.post(
        "/api/voice/profile",
        json={"samples": ["Post one", "  ", "Post three"]},
        headers=auth_headers,
    )
    assert response.status_code == 400


# --- usage events ------------------------------------------------------------


async def test_extraction_writes_usage_event(
    client, auth_headers, fake_db, monkeypatch
) -> None:
    await _extract(
        client, auth_headers, monkeypatch, [_profile_response(_valid_profile())]
    )
    rows = list(fake_db.usage_events.docs.values())
    assert len(rows) == 1
    assert rows[0]["event"] == "voice_extraction"
    assert rows[0]["sample_count"] == 3


# --- prompt pair is the craft pack's, slot-filled -----------------------------


async def test_extraction_prompt_carries_schema_and_samples(
    client, auth_headers, monkeypatch
) -> None:
    capture: list[_RecordingLLM] = []
    monkeypatch.setattr(
        voice_module,
        "get_llm",
        _stub_get_llm([_profile_response(_valid_profile())], capture=capture),
    )
    await client.post(
        "/api/voice/profile",
        json={"samples": _SAMPLES, "niche": "devtools"},
        headers=auth_headers,
    )
    call = capture[0].calls[0]
    assert call["json_mode"] is True
    assert "writing-style analyst" in call["system"]
    assert "VoiceDNAProfile" in call["prompt"]
    assert "The boring answer won" in call["prompt"]  # sample text slot-filled
    assert "devtools" in call["prompt"]  # niche context slot-filled
