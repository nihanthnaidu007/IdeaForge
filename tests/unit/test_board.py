"""Board tests — status transitions, tags, and search/filter (spec criterion 4).

Unit tier over the FakeDatabase seam: transition validation, ownership
isolation, tag normalization, and the text/tag/status filter are asserted both
at the HTTP boundary and as pure functions.
"""

from __future__ import annotations

import pytest
from app.routers.board import filter_ideas, normalize_tags, validate_transition
from app.services.workflow_errors import InvalidTransition

# --- fixtures/helpers --------------------------------------------------------


async def seed_idea(client, headers, *, title="Eval pipelines", **overrides) -> str:
    payload = {
        "topic_title": title,
        "rating": 8.0,
        "rating_explanation": "Strong current signal.",
    }
    payload.update(overrides)
    response = await client.post("/api/save-idea", json=payload, headers=headers)
    assert response.status_code == 200, response.text
    return response.json()["id"]


def idea_doc(*, title="Eval pipelines", status="inbox", tags=None, **extra):
    doc = {
        "id": extra.pop("id", "idea-1"),
        "user_id": extra.pop("user_id", "u1"),
        "topic_title": title,
        "rating": 8.0,
        "rating_explanation": "Strong current signal.",
        "niche": "AI",
        "tone": "professional",
        "created_at": "2026-09-17T00:00:00+00:00",
        "is_bookmarked": False,
        "status": status,
        "tags": tags or [],
    }
    doc.update(extra)
    return doc


# --- pure transition logic ----------------------------------------------------


def test_adjacent_forward_transitions_are_valid():
    validate_transition("inbox", "forged")
    validate_transition("forged", "drafting")
    validate_transition("drafting", "ready")


def test_adjacent_backward_transitions_are_valid():
    validate_transition("ready", "drafting")
    validate_transition("drafting", "forged")
    validate_transition("forged", "inbox")


def test_stage_skipping_is_rejected_with_allowed_targets():
    with pytest.raises(InvalidTransition) as exc:
        validate_transition("inbox", "ready")
    assert "forged" in str(exc.value)


def test_same_status_transition_is_rejected():
    with pytest.raises(InvalidTransition):
        validate_transition("ready", "ready")


def test_unknown_status_has_no_targets():
    with pytest.raises(InvalidTransition):
        validate_transition("archived", "inbox")


# --- pure filter + tags --------------------------------------------------------


def test_filter_ideas_by_text_tag_and_status():
    ideas = [
        idea_doc(id="a", title="Eval pipelines", tags=["evals"]),
        idea_doc(id="b", title="Agent billing", status="forged", tags=["pricing"]),
        idea_doc(
            id="c",
            title="Something else",
            generated_post="A post about eval pipelines in production",
        ),
    ]
    by_text = filter_ideas(ideas, q="EVAL")
    assert {d["id"] for d in by_text} == {"a", "c"}  # title OR post text match
    by_tag = filter_ideas(ideas, tag="evals")
    assert [d["id"] for d in by_tag] == ["a"]
    by_status = filter_ideas(ideas, status="forged")
    assert [d["id"] for d in by_status] == ["b"]
    combined = filter_ideas(ideas, q="pipelines", tag="evals", status="inbox")
    assert [d["id"] for d in combined] == ["a"]


def test_normalize_tags_strips_dedupes_and_caps():
    tags = normalize_tags([" evals ", "evals", "", "RAG", "a" * 100, "Evals"])
    assert tags[0] == "evals"
    assert "RAG" in tags
    assert all(len(t) <= 40 for t in tags)
    assert len(tags) == len(set(tags))
    assert len(normalize_tags([f"t{i}" for i in range(50)])) == 10


# --- HTTP boundary -------------------------------------------------------------


@pytest.mark.asyncio
async def test_transition_moves_status_and_records_usage(client, auth_headers, fake_db):
    idea_id = await seed_idea(client, auth_headers)
    response = await client.post(
        f"/api/board/{idea_id}/transition", json={"to": "forged"}, headers=auth_headers
    )
    assert response.status_code == 200, response.text
    assert response.json()["status"] == "forged"

    events = list(fake_db.usage_events.docs.values())
    assert [e["event"] for e in events] == ["idea_status_changed"]


@pytest.mark.asyncio
async def test_transition_rejects_stage_skip_with_typed_error(client, auth_headers):
    idea_id = await seed_idea(client, auth_headers)
    response = await client.post(
        f"/api/board/{idea_id}/transition", json={"to": "ready"}, headers=auth_headers
    )
    assert response.status_code == 422
    assert response.json()["kind"] == "INVALID_TRANSITION"


@pytest.mark.asyncio
async def test_transition_unknown_idea_is_404(client, auth_headers):
    response = await client.post(
        "/api/board/nope/transition", json={"to": "forged"}, headers=auth_headers
    )
    assert response.status_code == 404


@pytest.mark.asyncio
async def test_board_is_isolated_per_user(client, auth_headers, fake_db):
    """Ideas are workspace-scoped: another account cannot transition them."""
    await seed_idea(client, auth_headers)
    other = await client.post(
        "/api/auth/register",
        json={"email": "other@example.com", "password": "correct-horse-9"},
    )
    other_headers = {"Authorization": f"Bearer {other.json()['token']}"}

    response = await client.get("/api/board", headers=other_headers)
    assert response.status_code == 200
    assert response.json() == []  # other account sees nothing
    assert len(fake_db.saved_ideas.docs) == 1  # and the idea is untouched


@pytest.mark.asyncio
async def test_transition_of_foreign_idea_is_404(client, auth_headers):
    idea_id = await seed_idea(client, auth_headers)
    other = await client.post(
        "/api/auth/register",
        json={"email": "other2@example.com", "password": "correct-horse-9"},
    )
    other_headers = {"Authorization": f"Bearer {other.json()['token']}"}
    response = await client.post(
        f"/api/board/{idea_id}/transition",
        json={"to": "forged"},
        headers=other_headers,
    )
    assert response.status_code == 404


@pytest.mark.asyncio
async def test_tags_replace_and_normalize(client, auth_headers):
    idea_id = await seed_idea(client, auth_headers)
    response = await client.patch(
        f"/api/board/{idea_id}/tags",
        json={"tags": [" evals ", "evals", "rag"]},
        headers=auth_headers,
    )
    assert response.status_code == 200, response.text
    assert response.json()["tags"] == ["evals", "rag"]


@pytest.mark.asyncio
async def test_tag_length_and_count_bounds(client, auth_headers):
    idea_id = await seed_idea(client, auth_headers)
    too_long = await client.patch(
        f"/api/board/{idea_id}/tags",
        json={"tags": ["x" * 41]},
        headers=auth_headers,
    )
    assert too_long.status_code == 422
    too_many = await client.patch(
        f"/api/board/{idea_id}/tags",
        json={"tags": [f"t{i}" for i in range(11)]},
        headers=auth_headers,
    )
    assert too_many.status_code == 422


@pytest.mark.asyncio
async def test_board_search_filter_params(client, auth_headers):
    a = await seed_idea(client, auth_headers, title="Eval pipelines")
    b = await seed_idea(client, auth_headers, title="Agent billing")
    await client.post(
        f"/api/board/{b}/transition", json={"to": "forged"}, headers=auth_headers
    )

    text = await client.get("/api/board", params={"q": "eval"}, headers=auth_headers)
    assert [d["id"] for d in text.json()] == [a]

    status = await client.get(
        "/api/board", params={"status": "forged"}, headers=auth_headers
    )
    assert [d["id"] for d in status.json()] == [b]

    tagged = await client.get("/api/board", params={"tag": "nope"}, headers=auth_headers)
    assert tagged.json() == []


@pytest.mark.asyncio
async def test_board_tags_endpoint_returns_distinct(client, auth_headers):
    idea_id = await seed_idea(client, auth_headers)
    await client.patch(
        f"/api/board/{idea_id}/tags",
        json={"tags": ["evals", "rag"]},
        headers=auth_headers,
    )
    await seed_idea(client, auth_headers, title="Second idea")
    response = await client.get("/api/board/tags", headers=auth_headers)
    assert response.json() == ["evals", "rag"]


@pytest.mark.asyncio
async def test_board_requires_auth(client):
    response = await client.get("/api/board")
    assert response.status_code in (401, 403)
