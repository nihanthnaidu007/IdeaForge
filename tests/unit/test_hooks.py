"""Hook Bank: seed inventory, filters, CRUD guardrails, prompt injection.

Spec verification criterion #4: ≥40 seeded patterns filterable by
style/format and injectable into generation. Fast tier — the lifespan seeds
the catalog into the FakeDatabase and LLM calls are recorded stubs at the
import seam; no live provider calls ever.
"""

from __future__ import annotations

from typing import Any

from app.routers import posts as posts_module
from app.services.hooks import (
    pattern_needs_source,
    seed_documents,
    seed_hooks,
)

from tests.unit.fakes import RecordingLLM as _RecordingLLM
from tests.unit.fakes import stub_get_llm as _stub_get_llm

# --- seed inventory -----------------------------------------------------------


async def test_seed_creates_at_least_40_patterns(client, auth_headers) -> None:
    response = await client.get("/api/hooks", headers=auth_headers)
    assert response.status_code == 200, response.text
    body = response.json()
    unique_ids = {h["id"] for h in body["hooks"]}
    assert len(unique_ids) >= 40  # spec criterion #4: ≥40 curated patterns
    assert body["total"] == len(seed_documents())  # 117 pattern×format docs
    assert all(h["is_builtin"] for h in body["hooks"])
    # Builtin rows lead, in stable H-ID order.
    leading_ids = [h["id"] for h in body["hooks"] if h["is_builtin"]]
    assert leading_ids == sorted(leading_ids)


def test_seed_documents_one_per_pattern_format() -> None:
    docs = seed_documents()
    keys = {(d["id"], d["format"]) for d in docs}
    assert len(keys) == len(docs)  # no duplicate (id, format) pairs


async def test_seeding_is_idempotent(fake_db) -> None:
    first = await seed_hooks(fake_db)
    second = await seed_hooks(fake_db)
    assert first == len(seed_documents())
    assert second == 0  # second run inserts nothing — H-IDs are frozen
    assert len(fake_db.hooks.docs) == len(seed_documents())


async def test_requires_source_patterns_carry_the_tag(client, auth_headers) -> None:
    response = await client.get("/api/hooks", headers=auth_headers)
    hooks = response.json()["hooks"]
    gated = [h for h in hooks if pattern_needs_source(h["text_pattern"])]
    assert gated, "the catalog must include {stat}/{source_name} patterns"
    for hook in hooks:
        if pattern_needs_source(hook["text_pattern"]):
            assert "requires_source" in hook["tags"], hook["id"]
        # Gating tags are mutually exclusive — a hook never demands both
        # a sourced claim AND the author's private numbers.
        both = {"requires_source", "requires_own_data"}
        assert not both.issubset(set(hook["tags"])), hook["id"]


# --- filters --------------------------------------------------------------------


async def test_hooks_filterable_by_style_and_format(client, auth_headers) -> None:
    by_style = await client.get(
        "/api/hooks", params={"style": "contrarian"}, headers=auth_headers
    )
    assert by_style.status_code == 200
    rows = by_style.json()["hooks"]
    assert rows, "contrarian is a seeded archetype"
    assert all(h["style"] == "contrarian" for h in rows)

    by_format = await client.get(
        "/api/hooks", params={"format": "carousel"}, headers=auth_headers
    )
    assert by_format.status_code == 200
    rows = by_format.json()["hooks"]
    assert rows, "carousel is a seeded format"
    assert all(h["format"] == "carousel" for h in rows)


# --- CRUD guardrails -------------------------------------------------------------


def _own_hook_payload(**overrides: Any) -> dict[str, Any]:
    payload: dict[str, Any] = {
        "text_pattern": "My rule after {n} launches: {lesson}.",
        "style": "authority",
        "format": "how_to",
        "tags": ["personal"],
    }
    payload.update(overrides)
    return payload


async def test_create_and_list_own_hook(client, auth_headers) -> None:
    created = await client.post(
        "/api/hooks", json=_own_hook_payload(), headers=auth_headers
    )
    assert created.status_code == 200, created.text
    hook = created.json()
    assert hook["id"].startswith("U-")
    assert hook["is_builtin"] is False

    mine = await client.get("/api/hooks", params={"mine": True}, headers=auth_headers)
    rows = mine.json()["hooks"]
    assert [h["id"] for h in rows] == [hook["id"]]
    assert all(not h["is_builtin"] for h in rows)


async def test_create_hook_auto_tags_requires_source(client, auth_headers) -> None:
    created = await client.post(
        "/api/hooks",
        json=_own_hook_payload(
            text_pattern="{stat} changed how I think about {topic}.",
            tags=[],
        ),
        headers=auth_headers,
    )
    assert created.status_code == 200, created.text
    assert "requires_source" in created.json()["tags"]


async def test_create_hook_rejects_unknown_style(client, auth_headers) -> None:
    created = await client.post(
        "/api/hooks",
        json=_own_hook_payload(style="nonsense"),
        headers=auth_headers,
    )
    assert created.status_code == 422  # pydantic Literal, not a silent accept


async def test_builtin_hooks_are_read_only(client, auth_headers) -> None:
    edited = await client.put(
        "/api/hooks/H01", json={"text_pattern": "mine now"}, headers=auth_headers
    )
    assert edited.status_code == 404
    deleted = await client.delete("/api/hooks/H01", headers=auth_headers)
    assert deleted.status_code == 404


async def test_update_and_delete_own_hook(client, auth_headers) -> None:
    created = await client.post(
        "/api/hooks", json=_own_hook_payload(), headers=auth_headers
    )
    hook_id = created.json()["id"]

    updated = await client.put(
        f"/api/hooks/{hook_id}",
        json={"text_pattern": "Revised: {claim}."},
        headers=auth_headers,
    )
    assert updated.status_code == 200, updated.text
    assert updated.json()["text_pattern"] == "Revised: {claim}."

    deleted = await client.delete(f"/api/hooks/{hook_id}", headers=auth_headers)
    assert deleted.status_code == 200
    mine = await client.get("/api/hooks", params={"mine": True}, headers=auth_headers)
    assert mine.json()["hooks"] == []


# --- injection into generation ---------------------------------------------------


async def _generate_with_hook(
    client, auth_headers, monkeypatch, hook_id: str | None
) -> tuple[dict, list[_RecordingLLM]]:
    capture: list[_RecordingLLM] = []
    monkeypatch.setattr(
        posts_module, "get_llm", _stub_get_llm(["A generated post."], capture=capture)
    )
    payload: dict[str, Any] = {
        "idea": {"title": "Vector DB cost curves"},
        "format": "hot_take",
        "tone": "professional",
    }
    if hook_id:
        payload["hook_id"] = hook_id
    response = await client.post(
        "/api/generate-post", json=payload, headers=auth_headers
    )
    assert response.status_code == 200, response.text
    return response.json(), capture


async def test_hook_block_injected_into_generation_prompt(
    client, auth_headers, monkeypatch
) -> None:
    _, capture = await _generate_with_hook(
        client, auth_headers, monkeypatch, "H01"
    )
    prompt = capture[0].calls[0]["prompt"]
    assert "HOOK (first line only, id: H01, archetype: contrarian)" in prompt
    assert "Unpopular opinion: {claim}." in prompt
    # The pattern governs only the opening line — the instruction says so.
    assert "first line" in prompt


async def test_generation_without_hook_has_no_hook_block(
    client, auth_headers, monkeypatch
) -> None:
    _, capture = await _generate_with_hook(client, auth_headers, monkeypatch, None)
    assert "HOOK (first line only" not in capture[0].calls[0]["prompt"]


async def test_generate_with_unknown_hook_id_is_404(
    client, auth_headers, monkeypatch
) -> None:
    monkeypatch.setattr(
        posts_module, "get_llm", _stub_get_llm(["A generated post."])
    )
    response = await client.post(
        "/api/generate-post",
        json={"idea": {"title": "x"}, "format": "hot_take", "hook_id": "H999"},
        headers=auth_headers,
    )
    assert response.status_code == 404


async def test_swap_hook_rewrites_only_the_opening(
    client, auth_headers, monkeypatch
) -> None:
    capture: list[_RecordingLLM] = []
    monkeypatch.setattr(
        posts_module,
        "get_llm",
        _stub_get_llm(["Rewritten opening + unchanged body."], capture=capture),
    )
    original = "Old opening line.\n\nBody that must stay standing."
    response = await client.post(
        "/api/swap-hook",
        json={
            "original_post": original,
            "hook_id": "H09",
            "idea": {"title": "Vector DB cost curves"},
            "format": "hot_take",
        },
        headers=auth_headers,
    )
    assert response.status_code == 200, response.text
    body = response.json()
    assert body["hook_pattern_id"] == "H09"

    prompt = capture[0].calls[0]["prompt"]
    assert original in prompt  # the draft is the source of truth
    assert "OPENING LINE" in prompt
    assert "{stat}" in prompt  # H09's pattern rides in the prompt
    assert "HOOK (first line only, id: H09" in prompt


async def test_swap_hook_unknown_hook_id_is_404(
    client, auth_headers, monkeypatch
) -> None:
    monkeypatch.setattr(
        posts_module, "get_llm", _stub_get_llm(["Rewritten."])
    )
    response = await client.post(
        "/api/swap-hook",
        json={
            "original_post": "Some draft.",
            "hook_id": "H999",
            "idea": {"title": "x"},
            "format": "hot_take",
        },
        headers=auth_headers,
    )
    assert response.status_code == 404
