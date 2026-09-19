"""Bundled-key usage caps: counters, seam enforcement, and the 429 contract.

Wave 1 hybrid-model verification (spec art_YGBAEBjk): caps are per-user,
per-day, per-resource; they authorize bundled (server-default) calls
atomically at the resolution seam and never touch BYOK calls. Deterministic
stubs only — no live provider I/O anywhere in this module.
"""

from __future__ import annotations

import asyncio
from datetime import UTC, datetime
from typing import Any

import jwt
import pytest
from app.routers import research as research_module
from app.services.llm.provider import (
    MissingKeyError,
    UsageCapExceeded,
    resolve_user_key,
)
from app.services.usage import (
    RESOURCE_LLM,
    RESOURCE_RESEARCH,
    authorize_daily_usage,
    bundled_daily_limit,
    daily_usage_reset_at,
    read_daily_usage,
    seconds_until_reset,
)
from app.services.vault import build_vault

from tests.conftest import VALID_MASTER_KEY, make_settings

SERVER_LLM_KEY = "sk-server-default-openai-0000"
SERVER_TAVILY_KEY = "tvly-server-0000"
BYOK_KEY = "sk-byok-openai-9999"


async def _bundled_user_settings() -> Any:
    return make_settings(
        openai_api_key=SERVER_LLM_KEY,
        tavily_api_key=SERVER_TAVILY_KEY,
        BUNDLED_DAILY_LLM_LIMIT=2,
        BUNDLED_DAILY_RESEARCH_LIMIT=5,
    )


def _vault():
    return build_vault(VALID_MASTER_KEY)


async def _store_key(fake_db: Any, vault: Any, user_id: str, provider: str, plaintext: str) -> None:
    """Encrypt with the real vault and persist the blob like the routes do."""
    blob = vault.encrypt(user_id, provider, plaintext)
    await fake_db.user_preferences.find_one_and_update(
        {"user_id": user_id},
        {"$set": {f"keys.{provider}": blob}, "$setOnInsert": {"user_id": user_id}},
        upsert=True,
    )


# --- cap boundary -------------------------------------------------------------


async def test_cap_boundary_raises_typed_429(fake_db) -> None:
    settings = await _bundled_user_settings()
    vault = _vault()
    for _ in range(2):  # limit reached
        await resolve_user_key(fake_db, vault, "u1", "openai", settings)
    with pytest.raises(UsageCapExceeded) as exc_info:
        await resolve_user_key(fake_db, vault, "u1", "openai", settings)

    err = exc_info.value
    assert err.status_code == 429
    assert err.kind == "USAGE_CAP_EXCEEDED"
    assert err.provider == "openai"
    assert err.resource == RESOURCE_LLM
    assert err.allowance == 2
    assert err.retry_after == seconds_until_reset()
    assert err.retry_after > 0
    assert err.resets_at.tzinfo is not None
    assert err.resets_at == daily_usage_reset_at()


async def test_authorized_units_persist_daily(fake_db) -> None:
    settings = await _bundled_user_settings()
    vault = _vault()
    for _ in range(2):
        await resolve_user_key(fake_db, vault, "u1", "openai", settings)
    assert await read_daily_usage(fake_db, "u1", RESOURCE_LLM) == 2
    # The counter doc carries the UTC day and reset — the 429's typed fields
    # and the Settings banner read the same bookkeeping.
    doc = await fake_db.usage_counters.find_one({"user_id": "u1"})
    assert doc["resource"] == RESOURCE_LLM
    assert doc["resets_at"] == daily_usage_reset_at()


async def test_message_states_allowance_and_recovery(fake_db) -> None:
    settings = await _bundled_user_settings()
    vault = _vault()
    for _ in range(2):
        await resolve_user_key(fake_db, vault, "u1", "openai", settings)
    with pytest.raises(UsageCapExceeded) as exc_info:
        await resolve_user_key(fake_db, vault, "u1", "openai", settings)
    message = str(exc_info.value)
    # Copy law: the allowance, the reset, and one recovery action — no blame,
    # no "budget exceeded" scaffold vocabulary.
    assert "2 calls" in message
    assert "Add your own API key in Settings" in message


async def test_missing_key_still_takes_precedence_over_caps(fake_db) -> None:
    # No server keys, no BYOK → MissingKeyError, never a cap error: the cap
    # only governs the bundled path.
    settings = make_settings(BUNDLED_DAILY_LLM_LIMIT=1)
    vault = _vault()
    with pytest.raises(MissingKeyError):
        await resolve_user_key(fake_db, vault, "u1", "openai", settings)


# --- atomicity ----------------------------------------------------------------


async def test_concurrent_increments_never_exceed_limit(fake_db) -> None:
    settings = await _bundled_user_settings()  # LLM limit 2
    vault = _vault()

    results = await asyncio.gather(
        *[
            resolve_user_key(fake_db, vault, "u1", "openai", settings)
            for _ in range(12)
        ],
        return_exceptions=True,
    )
    authorized = [r for r in results if not isinstance(r, BaseException)]
    assert len(authorized) == 2  # exactly the allowance — no over-admission
    assert await read_daily_usage(fake_db, "u1", RESOURCE_LLM) == 2


async def test_denied_calls_refund_their_ticket(fake_db) -> None:
    # At rest the counter equals the number of authorized units — the honest
    # "used today" the Settings banner displays never exceeds the allowance.
    settings = await _bundled_user_settings()  # LLM limit 2
    vault = _vault()
    for _ in range(5):  # 2 authorized + 3 denied
        try:
            await resolve_user_key(fake_db, vault, "u1", "openai", settings)
        except UsageCapExceeded:
            pass  # the denial under test
    assert await read_daily_usage(fake_db, "u1", RESOURCE_LLM) == 2


# --- BYOK bypass --------------------------------------------------------------


async def test_byok_bypasses_cap_and_is_never_counted(fake_db) -> None:
    settings = await _bundled_user_settings()
    vault = _vault()
    # Burn the bundled allowance first — no BYOK key yet, so these are
    # bundled (server-default) calls that the cap counter tracks.
    for _ in range(2):
        await resolve_user_key(fake_db, vault, "u1", "openai", settings)
    await _store_key(fake_db, _vault(), "u1", "openai", BYOK_KEY)

    # BYOK path: uncapped, uncounted — the locked invariant. Five more calls
    # return the user's own key every time and the counter stays at the
    # burned allowance (2) — BYOK usage never counts against anything.
    for _ in range(5):
        key = await resolve_user_key(fake_db, vault, "u1", "openai", settings)
        assert key == BYOK_KEY
    assert await read_daily_usage(fake_db, "u1", RESOURCE_LLM) == 2


async def test_byok_users_have_no_counter_docs_at_all(fake_db) -> None:
    settings = await _bundled_user_settings()
    vault = _vault()
    await _store_key(fake_db, _vault(), "u1", "openai", BYOK_KEY)
    await _store_key(fake_db, _vault(), "u1", "tavily", "tvly-byok-00")
    for _ in range(3):
        await resolve_user_key(fake_db, vault, "u1", "openai", settings)
        await resolve_user_key(fake_db, vault, "u1", "tavily", settings)
    assert len(fake_db.usage_counters.docs) == 0


# --- resource separation --------------------------------------------------------


async def test_exhausting_one_resource_leaves_the_other_alone(fake_db) -> None:
    settings = make_settings(
        openai_api_key=SERVER_LLM_KEY,
        tavily_api_key=SERVER_TAVILY_KEY,
        BUNDLED_DAILY_LLM_LIMIT=1,
        BUNDLED_DAILY_RESEARCH_LIMIT=5,
    )
    vault = _vault()
    await resolve_user_key(fake_db, vault, "u1", "openai", settings)  # LLM spent
    with pytest.raises(UsageCapExceeded):
        await resolve_user_key(fake_db, vault, "u1", "openai", settings)
    # Research is a separate counter — one dashboard action must not be able
    # to exhaust both allowances at once.
    key = await resolve_user_key(fake_db, vault, "u1", "tavily", settings)
    assert key == SERVER_TAVILY_KEY
    assert await read_daily_usage(fake_db, "u1", RESOURCE_RESEARCH) == 1


# --- settings plumbing ---------------------------------------------------------


async def test_cap_limits_read_from_env_settings() -> None:
    settings = make_settings(BUNDLED_DAILY_LLM_LIMIT=7, BUNDLED_DAILY_RESEARCH_LIMIT=3)
    assert bundled_daily_limit(settings, RESOURCE_LLM) == 7
    assert bundled_daily_limit(settings, RESOURCE_RESEARCH) == 3


async def test_defaults_match_the_spec_assumption() -> None:
    settings = make_settings()
    assert bundled_daily_limit(settings, RESOURCE_LLM) == 25
    assert bundled_daily_limit(settings, RESOURCE_RESEARCH) == 10


async def test_daily_reset_is_next_utc_midnight() -> None:
    now = datetime(2026, 9, 18, 15, 30, 0, tzinfo=UTC)
    reset = daily_usage_reset_at(now)
    assert reset == datetime(2026, 9, 19, 0, 0, 0, tzinfo=UTC)
    assert seconds_until_reset(now) == 8 * 3600 + 1800


# --- route-level contract -------------------------------------------------------


async def test_cap_exceeded_maps_to_429_with_honest_payload(
    client, auth_headers, monkeypatch
) -> None:
    resets_at = daily_usage_reset_at()
    retry_after = max(1, seconds_until_reset())

    from app.services.llm.provider import _USAGE_CAP_COPY

    async def _capped(*args: Any, **kwargs: Any) -> str:
        # Raise exactly the way the enforcement seam does — same copy, fields.
        raise UsageCapExceeded(
            _USAGE_CAP_COPY.format(
                allowance=10,
                resets_at=resets_at.strftime("%Y-%m-%d %H:%M UTC"),
            ),
            provider="tavily",
            resource=RESOURCE_RESEARCH,
            allowance=10,
            resets_at=resets_at,
            retry_after=retry_after,
        )

    monkeypatch.setattr(research_module, "resolve_user_key", _capped)
    response = await client.post(
        "/api/research", json={"niche": "AI infrastructure"}, headers=auth_headers
    )
    assert response.status_code == 429, response.text
    assert response.headers["retry-after"] == str(retry_after)
    body = response.json()
    assert body["kind"] == "USAGE_CAP_EXCEEDED"
    assert body["allowance"] == 10
    assert body["resets_at"] == resets_at.isoformat()
    assert body["provider"] == "tavily"
    assert body["resource"] == RESOURCE_RESEARCH
    # The honest card's data: allowance, reset, one action — all server-typed.
    assert "10 calls" in body["detail"]
    assert "Add your own API key in Settings" in body["detail"]


async def test_usage_caps_endpoint_reports_allowance_state(
    client, auth_headers, fake_db
) -> None:
    # user_id comes from the token the fixture minted.
    token = auth_headers["Authorization"].removeprefix("Bearer ")
    payload = jwt.decode(
        token,
        make_settings().jwt_secret,
        algorithms=["HS256"],
        options={"require": ["exp"]},
    )
    user_id = payload["user_id"]

    response = await client.get("/api/usage/caps", headers=auth_headers)
    assert response.status_code == 200, response.text
    body = response.json()
    assert set(body["resources"]) == {RESOURCE_LLM, RESOURCE_RESEARCH}
    for resource in body["resources"].values():
        assert resource["used"] == 0
        assert resource["limit"] in (25, 10)
        # The default test deployment sets no server keys — the banner must
        # not claim an allowance that doesn't exist.
        assert resource["bundled_available"] is False
        assert resource["byok_connected"] is False
    assert body["resets_at"].startswith(daily_usage_reset_at().date().isoformat())

    # One authorized LLM unit shows up as used: the banner mirrors reality.
    await authorize_daily_usage(fake_db, user_id, RESOURCE_LLM, limit=25)
    refreshed = (await client.get("/api/usage/caps", headers=auth_headers)).json()
    assert refreshed["resources"][RESOURCE_LLM]["used"] == 1
    assert refreshed["resources"][RESOURCE_RESEARCH]["used"] == 0


async def test_usage_caps_endpoint_reports_byok_and_bundled_keys() -> None:
    """Server keys + BYOK connected → the banner's two flags flip true."""
    from app.main import create_app
    from httpx import ASGITransport
    from httpx import AsyncClient as HttpxAsyncClient

    from tests.unit.fakes import FakeDatabase

    settings = make_settings(
        openai_api_key=SERVER_LLM_KEY,
        BUNDLED_DAILY_LLM_LIMIT=5,
        BUNDLED_DAILY_RESEARCH_LIMIT=2,
    )
    app = create_app(settings=settings, db=FakeDatabase())
    async with app.router.lifespan_context(app):
        async with HttpxAsyncClient(
            transport=ASGITransport(app=app), base_url="http://test"
        ) as custom_client:
            register = await custom_client.post(
                "/api/auth/register",
                json={"email": "caps@example.com", "password": "correct-horse-9"},
            )
            assert register.status_code == 200, register.text
            headers = {"Authorization": f"Bearer {register.json()['token']}"}
            await custom_client.put(
                "/api/preferences",
                json={"openai_api_key": BYOK_KEY},
                headers=headers,
            )
            response = await custom_client.get("/api/usage/caps", headers=headers)
            assert response.status_code == 200, response.text
            resources = response.json()["resources"]
            assert resources[RESOURCE_LLM]["bundled_available"] is True
            assert resources[RESOURCE_LLM]["limit"] == 5
            assert resources[RESOURCE_LLM]["byok_connected"] is True
            assert resources[RESOURCE_RESEARCH]["bundled_available"] is False
            assert resources[RESOURCE_RESEARCH]["limit"] == 2
