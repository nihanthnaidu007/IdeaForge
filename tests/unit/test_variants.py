"""Variants engine routes: distinct briefs, rotated regeneration, versioned
tweaks, cost hints, usage events — against the fake db and a scripted LLM.

Spec verification criterion #4: N>=2 generations with distinct angle/hook
instructions return materially different drafts (asserted on the captured
prompts AND the distinct drafts); tweak versions stored; cost hint present.
No live provider calls — the LLM seam is overridden with a scripted fake.
"""

from __future__ import annotations

import json
from typing import Any

import pytest
from app.services.llm.provider import ProviderUnavailableError
from app.services.variants import VARIATION_BRIEFS

IDEA = {
    "title": "Vector DBs are eating search",
    "rating": 8.2,
    "rating_explanation": "Timely, opinionated, and backed by live source rows.",
}
FORMAT = "hot-take"  # kebab case, as the frontend sends it


class ScriptedLLM:
    """Fake LLMProvider: counter-tagged drafts, captured prompts, scriptable.

    ``responses`` maps call indexes (0-based) to raw JSON strings; unlisted
    calls get the default counter-tagged draft. Provider failures raise
    ProviderUnavailableError so the whole-request semantics are exercised.
    """

    def __init__(
        self,
        responses: dict[int, str] | None = None,
        fail_after: int | None = None,
    ) -> None:
        self.calls: list[dict[str, str]] = []
        self._responses = responses or {}
        self._fail_after = fail_after
        self._n = 0
        self.last_usage = {"tokens_in": 1500, "tokens_out": 620}

    async def complete(
        self, *, system: str, prompt: str, json_mode: bool = False, max_tokens: int = 2000
    ) -> str:
        self.calls.append({"system": system, "prompt": prompt})
        self._n += 1
        if self._fail_after is not None and self._n > self._fail_after:
            raise ProviderUnavailableError("provider down", provider="openai")
        if self._n - 1 in self._responses:
            return self._responses[self._n - 1]
        return json.dumps(
            {
                "post_text": f"Draft number {self._n} with a distinct angle.",
                "notes": f"call {self._n}",
            }
        )


@pytest.fixture
def install_llm(monkeypatch):
    """Install a fake LLM on the seam the routes actually call.

    The posts router imports get_llm directly and awaits it inside the route
    body, so tests patch the module attribute — dependency_overrides never
    fires for a direct call.
    """
    from app.routers import posts as posts_module

    def _install(fake: ScriptedLLM) -> ScriptedLLM:
        async def _fake_get_llm(user_id: str, provider: str, *, db: Any, vault: Any, settings: Any):
            return fake

        monkeypatch.setattr(posts_module, "get_llm", _fake_get_llm)
        return fake

    return _install


@pytest.fixture
def scripted_llm(install_llm) -> ScriptedLLM:
    """Default ScriptedLLM: counter-tagged drafts for every call."""
    return install_llm(ScriptedLLM())


def _variants_payload(**overrides: Any) -> dict[str, Any]:
    payload: dict[str, Any] = {
        "idea": IDEA,
        "format": FORMAT,
        "tone": "professional",
        "custom_instructions": None,
        "trends": [],
        "researched_at": "2026-09-17T00:00:00Z",
    }
    payload.update(overrides)
    return payload


async def _generate(client, auth_headers, **overrides: Any):
    return await client.post(
        "/api/generate-variants", json=_variants_payload(**overrides), headers=auth_headers
    )


# --- generation: three named, materially different drafts ---------------------


async def test_generate_variants_returns_three_distinct_drafts(
    client, scripted_llm, auth_headers
) -> None:
    response = await _generate(client, auth_headers)
    assert response.status_code == 200, response.text
    body = response.json()
    variants = body["variant_set"]["variants"]
    assert len(variants) == 3
    assert all(v["status"] == "ready" for v in variants)
    # Materially different drafts: the three columns never share a text.
    texts = [v["post_text"] for v in variants]
    assert len(set(texts)) == 3
    # Each column names its brief — the A/B compare's strategic labels.
    for variant in variants:
        assert variant["brief_id"] and variant["brief_name"] and variant["intent"]


async def test_generate_variants_sends_distinct_instruction_sets(
    client, scripted_llm, auth_headers
) -> None:
    """Each variant call carries its own brief — distinct angle/hook/energy.

    The engine varies INSTRUCTIONS (strategy briefs derived from the idea),
    not temperature: every captured prompt contains exactly one brief name.
    """
    response = await _generate(client, auth_headers)
    assert response.status_code == 200, response.text
    brief_names = [b.name for b in VARIATION_BRIEFS["hot_take"]]
    prompts = [call["prompt"] for call in scripted_llm.calls[:3]]
    for prompt in prompts:
        matched = [name for name in brief_names if name in prompt]
        assert len(matched) == 1, f"prompt carries {matched!r}, expected exactly one brief"
    # And the three prompts are pairwise distinct.
    assert len({p for p in prompts}) == 3


async def test_generate_variants_persists_set_and_usage_events(
    client, scripted_llm, fake_db, auth_headers
) -> None:
    response = await _generate(client, auth_headers)
    assert response.status_code == 200, response.text
    set_id = response.json()["variant_set"]["id"]
    stored = await fake_db.variant_sets.find_one({"id": set_id})
    assert stored is not None
    assert stored["parent_set_id"] is None
    assert stored["generation_round"] == 0
    events = list(fake_db.usage_events.docs.values())
    assert [e["event"] for e in events] == ["variant_generated"] * 3


async def test_generate_variants_cost_hint_present(client, scripted_llm, auth_headers) -> None:
    """§6 BYOK rule: every generation response carries the next-call hint."""
    response = await _generate(client, auth_headers)
    assert response.status_code == 200, response.text
    hint = response.json()["cost_hint"]
    assert hint["action"] == "generate_variant"
    assert isinstance(hint["hint"], str) and hint["hint"]
    assert hint["model"]  # names the model the next call will spend on


async def test_generate_variants_without_key_fails_loud(client, fake_db, auth_headers) -> None:
    """No user key, no server key → typed 400, no fabricated drafts."""
    response = await _generate(client, auth_headers)
    assert response.status_code == 400
    assert "openai" in response.text.lower()
    assert list(fake_db.variant_sets.docs.values()) == []


# --- regeneration: rotated briefs, linked parent ------------------------------


async def test_regenerate_rotates_briefs_and_links_parent(
    client, scripted_llm, fake_db, auth_headers
) -> None:
    first = await _generate(client, auth_headers)
    assert first.status_code == 200, first.text
    parent = first.json()["variant_set"]
    parent_briefs = [v["brief_id"] for v in parent["variants"]]

    response = await client.post(
        "/api/regenerate-post",
        json=_variants_payload(parent_set_id=parent["id"]),
        headers=auth_headers,
    )
    assert response.status_code == 200, response.text
    child = response.json()["variant_set"]
    assert child["parent_set_id"] == parent["id"]
    assert child["generation_round"] == 1
    child_briefs = [v["brief_id"] for v in child["variants"]]
    # The audited §1.3 route-9 defect: regenerate produced identical output.
    # The rebuild rotates the brief assignment — new instructions every round.
    assert child_briefs != parent_briefs
    assert sorted(child_briefs) == sorted(parent_briefs)
    child_texts = [v["post_text"] for v in child["variants"]]
    assert len(set(child_texts)) == 3


# --- tweaks: versioned, never destructive -------------------------------------


async def test_tweak_variant_versions_stored(client, scripted_llm, fake_db, auth_headers) -> None:
    first = await _generate(client, auth_headers)
    set_id = first.json()["variant_set"]["id"]
    original_text = first.json()["variant_set"]["variants"][0]["post_text"]

    response = await client.post(
        "/api/tweak-variant",
        json={"set_id": set_id, "variant_index": 0, "instruction": "Make the hook punchier."},
        headers=auth_headers,
    )
    assert response.status_code == 200, response.text
    body = response.json()
    # The draft changed; the previous draft moved into the version trail.
    assert body["variant"]["post_text"] != original_text
    assert len(body["variant"]["versions"]) == 1
    assert body["variant"]["versions"][0]["post_text"] == original_text
    assert body["variant"]["versions"][0]["instruction"] is None
    # Persisted doc agrees with the response.
    stored = await fake_db.variant_sets.find_one({"id": set_id})
    assert stored["variants"][0]["versions"][0]["post_text"] == original_text
    assert any(e["event"] == "variant_tweaked" for e in fake_db.usage_events.docs.values())


async def test_tweak_variant_revalidates_stored_trend_dicts(
    client, scripted_llm, auth_headers
) -> None:
    """Regression: variant sets persist trends as model_dump() dicts, and the
    tweak route must coerce them back into TrendItem before build_trend_block
    reads .title/.snippet — dict rows previously 500'd with AttributeError."""
    trends = [
        {
            "title": "Vector DB consolidation accelerates",
            "snippet": "Two major vendors announced consolidation moves.",
            "url": "https://example.com/vector-db-consolidation",
            "source": "viral news today",
        },
        {
            "title": "Retrieval defaults under scrutiny",
            "snippet": "Engineering teams re-evaluate retrieval defaults.",
            "url": "https://example.com/retrieval-defaults",
            "source": "trending AI topics LinkedIn",
        },
    ]
    first = await _generate(client, auth_headers, trends=trends)
    assert first.status_code == 200, first.text
    set_id = first.json()["variant_set"]["id"]

    response = await client.post(
        "/api/tweak-variant",
        json={
            "set_id": set_id,
            "variant_index": 0,
            "instruction": "Open with the consolidation news instead.",
        },
        headers=auth_headers,
    )
    assert response.status_code == 200, response.text


async def test_tweak_variant_twice_accumulates_versions(client, scripted_llm, auth_headers) -> None:
    first = await _generate(client, auth_headers)
    set_id = first.json()["variant_set"]["id"]
    for instruction in ("Make it punchier.", "Cut it to 120 words."):
        response = await client.post(
            "/api/tweak-variant",
            json={"set_id": set_id, "variant_index": 1, "instruction": instruction},
            headers=auth_headers,
        )
        assert response.status_code == 200, response.text
    body = response.json()
    assert len(body["variant"]["versions"]) == 2
    # The trail is chronological (oldest first); each entry holds its
    # predecessor's draft.
    assert body["variant"]["versions"][0]["version"] < body["variant"]["versions"][1]["version"]


async def test_tweak_variant_cost_hint_present(client, scripted_llm, auth_headers) -> None:
    first = await _generate(client, auth_headers)
    set_id = first.json()["variant_set"]["id"]
    response = await client.post(
        "/api/tweak-variant",
        json={"set_id": set_id, "variant_index": 2, "instruction": "Add a contrarian close."},
        headers=auth_headers,
    )
    assert response.status_code == 200, response.text
    assert response.json()["cost_hint"]["action"] == "generate_variant"


async def test_tweak_failed_variant_conflicts(client, install_llm, auth_headers) -> None:
    """A failed column cannot be tweaked — 409, generate a new set instead."""
    refusals = {
        1: json.dumps({"error": "generation_refused", "reason": "Not enough evidence."}),
        2: json.dumps({"error": "generation_refused", "reason": "Not enough evidence."}),
    }
    install_llm(ScriptedLLM(responses=refusals))
    first = await _generate(client, auth_headers)
    assert first.status_code == 200, first.text
    set_id = first.json()["variant_set"]["id"]
    variants = first.json()["variant_set"]["variants"]
    assert variants[0]["status"] == "ready"
    assert variants[1]["status"] == "failed" and variants[1]["error"]
    assert variants[2]["status"] == "failed"
    response = await client.post(
        "/api/tweak-variant",
        json={"set_id": set_id, "variant_index": 1, "instruction": "Try again."},
        headers=auth_headers,
    )
    assert response.status_code == 409


async def test_all_variants_refused_fails_loud_without_persisting(
    client, fake_db, auth_headers, install_llm
) -> None:
    """Every column refused → typed failure; nothing is stored as content."""
    refusal = json.dumps({"error": "generation_refused", "reason": "Insufficient evidence."})
    install_llm(ScriptedLLM(responses={0: refusal, 1: refusal, 2: refusal}))
    response = await _generate(client, auth_headers)
    assert response.status_code == 502
    assert list(fake_db.variant_sets.docs.values()) == []


async def test_provider_outage_fails_the_whole_request(
    client, fake_db, auth_headers, install_llm
) -> None:
    """Auth/quota/unavailable failures are not per-column — 503, nothing stored."""
    install_llm(ScriptedLLM(fail_after=0))
    response = await _generate(client, auth_headers)
    assert response.status_code == 503
    assert list(fake_db.variant_sets.docs.values()) == []
    assert list(fake_db.usage_events.docs.values()) == []


async def test_unknown_format_is_a_validation_error(client, scripted_llm, auth_headers) -> None:
    response = await _generate(client, auth_headers, format="screed")
    assert response.status_code == 422
