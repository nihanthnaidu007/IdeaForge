"""M4: public request models bound client-controlled size and shape —
malformed payloads get a clean 422, never a 500, and stored strings have
length caps. L1/L3 (email canonicalization, bcrypt byte cap) live here too
because they are enforced by the same models."""

from __future__ import annotations

from tests.conftest import make_settings


async def _register(client, email: str, password: str = "correct-horse-9"):
    return await client.post(
        "/api/auth/register", json={"email": email, "password": password}
    )


async def _auth_headers(client, email: str) -> dict[str, str]:
    response = await _register(client, email)
    assert response.status_code == 200, response.text
    return {"Authorization": f"Bearer {response.json()['token']}"}


# --- L1: email canonicalization ---------------------------------------------


async def test_register_normalizes_email(client) -> None:
    response = await _register(client, "  MixedCase@Example.COM ")
    assert response.status_code == 200
    assert response.json()["user"]["email"] == "mixedcase@example.com"


async def test_duplicate_email_detected_across_case(client) -> None:
    first = await _register(client, "Case@Test.com")
    duplicate = await _register(client, "case@test.com")
    assert first.status_code == 200
    assert duplicate.status_code == 409


async def test_login_matches_normalized_email(client) -> None:
    registered = await _register(client, "Normalize@Example.com")
    assert registered.status_code == 200
    login = await client.post(
        "/api/auth/login",
        json={"email": "normalize@example.com", "password": "correct-horse-9"},
    )
    assert login.status_code == 200


# --- M4: syntactic email validation on both auth paths -----------------------


async def test_malformed_email_rejected_on_register_and_login(client) -> None:
    assert (
        await _register(client, "not-an-email")
    ).status_code == 422  # was a 500 server error before the review
    login = await client.post(
        "/api/auth/login",
        json={"email": "also-not-an-email", "password": "whatever-1"},
    )
    assert login.status_code == 422


# --- M4/L3: length caps and ranges -------------------------------------------


async def test_password_byte_cap_enforced(client) -> None:
    # 80 ASCII chars: passes a naive 72-char read, fails the 72-byte cap.
    response = await _register(client, "longpw@example.com", password="x" * 80)
    assert response.status_code == 422
    # Multibyte characters: 40 chars but 80 bytes.
    response = await _register(client, "utf8pw@example.com", password="é" * 40)
    assert response.status_code == 422
    # 8-char minimum still applies.
    response = await _register(client, "shortpw@example.com", password="x" * 7)
    assert response.status_code == 422


async def test_name_cap_enforced(client) -> None:
    response = await client.post(
        "/api/auth/register",
        json={
            "email": "namelength@example.com",
            "password": "correct-horse-9",
            "name": "n" * 101,
        },
    )
    assert response.status_code == 422


async def test_research_request_bounds(client) -> None:
    headers = await _auth_headers(client, "research-bounds@example.com")
    for payload in (
        {"niche": ""},  # empty
        {"niche": "x" * 121},  # over cap
        {"tone": "x" * 121},
    ):
        response = await client.post("/api/research", json=payload, headers=headers)
        assert response.status_code == 422


async def test_saved_idea_rating_range_and_caps(client) -> None:
    headers = await _auth_headers(client, "saved-bounds@example.com")
    base = {
        "topic_title": "A trend worth saving",
        "rating": 7.5,
        "rating_explanation": "Because the data says so",
    }
    ok = await client.post("/api/save-idea", json=base, headers=headers)
    assert ok.status_code == 200, ok.text

    for override in (
        {"rating": 10.5},  # above scale
        {"rating": -0.5},  # below scale
        {"topic_title": "t" * 301},
        {"rating_explanation": "e" * 2001},
        {"key_aspects": ["a"] * 21},  # list-size cap
    ):
        response = await client.post(
            "/api/save-idea", json={**base, **override}, headers=headers
        )
        assert response.status_code == 422, override


# --- M4: trend rows are typed and bounded ------------------------------------


async def test_generate_ideas_malformed_trend_row_is_422_not_500(client) -> None:
    """The prompt builder previously indexed trend['title']/trend['snippet'] on
    client-supplied dicts — a missing key was an unhandled 500 (KeyError)."""
    headers = await _auth_headers(client, "ideas-bounds@example.com")
    response = await client.post(
        "/api/generate-ideas",
        json={"raw_trends": [{"snippet": "row with no title"}]},
        headers=headers,
    )
    assert response.status_code == 422


async def test_generate_ideas_trend_list_is_capped(client) -> None:
    headers = await _auth_headers(client, "ideas-cap@example.com")
    trends = [
        {"title": f"trend {i}", "snippet": "s", "url": "", "source": ""}
        for i in range(51)
    ]
    response = await client.post(
        "/api/generate-ideas", json={"raw_trends": trends}, headers=headers
    )
    assert response.status_code == 422


def test_settings_env_still_loads_with_bounded_models() -> None:
    # Guards against import-order breakage when models gained validators.
    assert make_settings().env == "dev"
