"""Key resolution: user BYOK → server env default → typed MissingKeyError.

Spec verification criterion #3: resolution prefers user BYOK, falls back to
env, else typed 400 with per-provider setup guidance. Decrypt failures map to
401 and write a key_audit use-failure event.
"""

from __future__ import annotations

import json

import pytest
from app.deps import get_llm
from app.logging_setup import request_id_var
from app.services.llm.anthropic_client import AnthropicLLM
from app.services.llm.openai_client import OpenAILLM
from app.services.llm.provider import (
    MissingKeyError,
    ProviderAuthError,
    resolve_user_key,
)
from app.services.vault import build_vault

from tests.conftest import VALID_MASTER_KEY, make_settings

USER_KEY = "sk-user-byok-openai-9999"
SERVER_KEY = "sk-server-default-openai-0000"


def _vault():
    return build_vault(VALID_MASTER_KEY)


async def _store_key(fake_db, vault, user_id: str, provider: str, plaintext: str):
    blob = vault.encrypt(user_id, provider, plaintext)
    await fake_db.user_preferences.insert_one(
        {"user_id": user_id, "keys": {provider: blob}}
    )


async def test_byok_preferred_over_server_env(fake_db) -> None:
    vault = _vault()
    await _store_key(fake_db, vault, "user-1", "openai", USER_KEY)
    settings = make_settings(openai_api_key=SERVER_KEY)
    resolved = await resolve_user_key(fake_db, vault, "user-1", "openai", settings)
    assert resolved == USER_KEY


async def test_server_env_default_used_without_byok(fake_db) -> None:
    vault = _vault()
    settings = make_settings(openai_api_key=SERVER_KEY)
    resolved = await resolve_user_key(fake_db, vault, "user-1", "openai", settings)
    assert resolved == SERVER_KEY


async def test_missing_everywhere_raises_typed_missing_key(fake_db) -> None:
    vault = _vault()
    settings = make_settings(openai_api_key=None, anthropic_api_key=None)
    with pytest.raises(MissingKeyError) as excinfo:
        await resolve_user_key(fake_db, vault, "user-1", "openai", settings)
    assert excinfo.value.status_code == 400
    assert excinfo.value.provider == "openai"
    # Per-provider setup guidance, product-neutral (no scaffold billing copy).
    assert "Settings" in str(excinfo.value)


async def test_tavily_resolves_from_stored_byok(fake_db) -> None:
    vault = _vault()
    await _store_key(fake_db, vault, "user-1", "tavily", "tvly-user-key-12345")
    resolved = await resolve_user_key(
        fake_db, vault, "user-1", "tavily", make_settings()
    )
    assert resolved == "tvly-user-key-12345"


async def test_decrypt_failure_is_401_and_audited(fake_db) -> None:
    vault = _vault()
    blob = vault.encrypt("user-1", "openai", USER_KEY)
    # Corrupt the ciphertext to simulate a rotated master key / tampering.
    blob["ciphertext"] = "AAAA" + str(blob["ciphertext"])[4:]
    await fake_db.user_preferences.insert_one(
        {"user_id": "user-1", "keys": {"openai": blob}}
    )
    token = request_id_var.set("req-fail-1")
    try:
        with pytest.raises(ProviderAuthError) as excinfo:
            await resolve_user_key(fake_db, vault, "user-1", "openai", make_settings())
    finally:
        request_id_var.reset(token)
    assert excinfo.value.status_code == 401
    audit_rows = list(fake_db.key_audit.docs.values())
    assert len(audit_rows) == 1
    assert audit_rows[0]["event"] == "use_failure"
    assert audit_rows[0]["provider"] == "openai"
    assert audit_rows[0]["user_id"] == "user-1"
    assert audit_rows[0]["request_id"] == "req-fail-1"


async def test_byok_use_success_is_audited_with_request_id(fake_db) -> None:
    """M5: every successful BYOK consumption records a 'used' event carrying
    the active request id — the ledger shows usage, not only failures, and
    never key material."""
    vault = _vault()
    await _store_key(fake_db, vault, "user-1", "openai", USER_KEY)
    token = request_id_var.set("req-ok-1")
    try:
        resolved = await resolve_user_key(
            fake_db, vault, "user-1", "openai", make_settings()
        )
    finally:
        request_id_var.reset(token)
    assert resolved == USER_KEY

    audit_rows = list(fake_db.key_audit.docs.values())
    assert len(audit_rows) == 1
    assert audit_rows[0]["event"] == "used"
    assert audit_rows[0]["provider"] == "openai"
    assert audit_rows[0]["user_id"] == "user-1"
    assert audit_rows[0]["request_id"] == "req-ok-1"
    # Secret-free audit: no key material may leak into the ledger.
    assert USER_KEY not in json.dumps(audit_rows[0], default=str)


async def test_byok_use_success_outside_request_has_empty_request_id(
    fake_db,
) -> None:
    """The correlation field is always present; it is empty when no request
    context exists (scripts, workers) rather than absent."""
    vault = _vault()
    await _store_key(fake_db, vault, "user-1", "openai", USER_KEY)
    await resolve_user_key(fake_db, vault, "user-1", "openai", make_settings())
    audit_rows = list(fake_db.key_audit.docs.values())
    assert audit_rows[0]["request_id"] == ""


async def test_get_llm_builds_correct_client_per_provider(fake_db) -> None:
    vault = _vault()
    settings = make_settings(
        openai_api_key=SERVER_KEY, anthropic_api_key="sk-ant-server-1234"
    )
    llm = await get_llm("user-1", "openai", db=fake_db, vault=vault, settings=settings)
    assert isinstance(llm, OpenAILLM)
    llm = await get_llm(
        "user-1", "anthropic", db=fake_db, vault=vault, settings=settings
    )
    assert isinstance(llm, AnthropicLLM)


async def test_get_llm_rejects_non_llm_providers(fake_db) -> None:
    vault = _vault()
    with pytest.raises(Exception) as excinfo:
        await get_llm(
            "user-1", "tavily", db=fake_db, vault=vault, settings=make_settings()
        )
    assert "not an LLM provider" in str(excinfo.value)
