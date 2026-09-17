"""BYOK preferences endpoints: store/list/delete with masked responses.

Spec verification criterion #3: no API response ever contains key material
(hint only); every key lifecycle event lands in key_audit; unknown providers
404; validation rejects junk keys.
"""

from __future__ import annotations

STORED_OPENAI = "sk-openai-byok-secret-7741"
STORED_TAVILY = "tvly-byok-5522"


def _prefs_doc(fake_db) -> dict:
    """The user's preferences document (fake keys docs by sequence, not user_id)."""
    user = next(
        doc
        for doc in fake_db.users.docs.values()
        if doc["email"] == "creator@example.com"
    )
    return next(
        doc
        for doc in fake_db.user_preferences.docs.values()
        if doc.get("user_id") == user["id"]
    )


async def test_store_key_response_is_masked(client, auth_headers, fake_db) -> None:
    response = await client.put(
        "/api/preferences", json={"openai_api_key": STORED_OPENAI}, headers=auth_headers
    )
    assert response.status_code == 200, response.text
    assert STORED_OPENAI not in response.text
    body = response.json()
    assert body["has_openai_key"] is True
    assert body["key_hints"]["openai"] == "****7741"


async def test_get_preferences_lists_hints_only(client, auth_headers, fake_db) -> None:
    await client.put(
        "/api/preferences",
        json={"openai_api_key": STORED_OPENAI, "tavily_api_key": STORED_TAVILY},
        headers=auth_headers,
    )
    response = await client.get("/api/preferences", headers=auth_headers)
    assert response.status_code == 200, response.text
    text = response.text
    assert STORED_OPENAI not in text and STORED_TAVILY not in text
    assert text.count("****") >= 2  # masked hints present
    body = response.json()
    assert body["has_openai_key"] and body["has_tavily_key"]


async def test_stored_document_holds_ciphertext_not_plaintext(
    client, auth_headers, fake_db
) -> None:
    await client.put(
        "/api/preferences", json={"openai_api_key": STORED_OPENAI}, headers=auth_headers
    )
    doc = _prefs_doc(fake_db)
    blob = doc["keys"]["openai"]
    assert STORED_OPENAI not in repr(blob)
    assert {"nonce", "ciphertext", "key_version", "alg", "hint"} <= set(blob)


async def test_storing_key_writes_audit_event(client, auth_headers, fake_db) -> None:
    await client.put(
        "/api/preferences", json={"openai_api_key": STORED_OPENAI}, headers=auth_headers
    )
    rows = list(fake_db.key_audit.docs.values())
    assert len(rows) == 1
    assert rows[0]["event"] == "stored"
    assert rows[0]["provider"] == "openai"


async def test_delete_key_removes_and_audits(client, auth_headers, fake_db) -> None:
    await client.put(
        "/api/preferences", json={"openai_api_key": STORED_OPENAI}, headers=auth_headers
    )
    response = await client.delete("/api/keys/openai", headers=auth_headers)
    assert response.status_code == 200, response.text
    prefs = await client.get("/api/preferences", headers=auth_headers)
    assert prefs.json()["has_openai_key"] is False
    events = [row["event"] for row in fake_db.key_audit.docs.values()]
    assert events == ["stored", "removed"]


async def test_delete_missing_key_is_404(client, auth_headers) -> None:
    response = await client.delete("/api/keys/openai", headers=auth_headers)
    assert response.status_code == 404


async def test_unknown_provider_is_404(client, auth_headers) -> None:
    response = await client.delete(
        "/api/keys/unknown-provider", headers=auth_headers
    )
    assert response.status_code == 404
    response = await client.post(
        "/api/keys/unknown-provider/test", headers=auth_headers
    )
    assert response.status_code == 404


async def test_too_short_key_is_rejected(client, auth_headers) -> None:
    response = await client.put(
        "/api/preferences", json={"openai_api_key": "abc"}, headers=auth_headers
    )
    assert response.status_code == 400


async def test_default_preferences_fields_round_trip(client, auth_headers) -> None:
    response = await client.put(
        "/api/preferences",
        json={"default_tone": "witty", "default_niche": "devtools"},
        headers=auth_headers,
    )
    assert response.status_code == 200, response.text
    assert response.json()["default_tone"] == "witty"
    assert response.json()["default_niche"] == "devtools"
    fetched = await client.get("/api/preferences", headers=auth_headers)
    assert fetched.json()["default_tone"] == "witty"
