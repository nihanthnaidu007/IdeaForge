"""SDK exception → typed error → HTTP status mapping (mocked SDKs, no network).

Spec verification criterion #3: auth/quota/rate errors map to 401/402/429 via
SDK exception TYPES (never string matching); connection/timeout → 503; JSON
mode retries exactly once then fails loud. The HTTP tier is exercised through
the real test-key endpoint with the provider probe stubbed.
"""

from __future__ import annotations

import app.routers.preferences as preferences_module
import httpx
import pytest
from anthropic import (
    APIConnectionError as AnthropicConnectionError,
)
from anthropic import (
    AuthenticationError as AnthropicAuthError,
)
from anthropic import (
    InternalServerError as AnthropicInternalError,
)
from anthropic import (
    OverloadedError as AnthropicOverloadedError,
)
from anthropic import (
    RateLimitError as AnthropicRateLimitError,
)
from app.services.llm.anthropic_client import AnthropicLLM, map_anthropic_error
from app.services.llm.openai_client import OpenAILLM, map_openai_error
from app.services.llm.provider import (
    GenerationError,
    ProviderAuthError,
    ProviderQuotaError,
    ProviderRateLimitedError,
    ProviderUnavailableError,
    complete_json_with_retry,
)
from openai import (
    APIConnectionError as OpenAIConnectionError,
)
from openai import (
    AuthenticationError as OpenAIAuthError,
)
from openai import (
    InternalServerError as OpenAIInternalError,
)
from openai import (
    RateLimitError as OpenAIRateLimitError,
)


def _resp(status: int, headers: dict[str, str] | None = None) -> httpx.Response:
    return httpx.Response(
        status, headers=headers or {}, request=httpx.Request("GET", "https://x.test")
    )


# --- mappers: exception type is the classifier -------------------------------


def test_openai_auth_error_maps_to_401() -> None:
    exc = OpenAIAuthError("bad key", response=_resp(401), body={"code": "x"})
    mapped = map_openai_error(exc, "openai")
    assert isinstance(mapped, ProviderAuthError)
    assert mapped.status_code == 401


def test_openai_quota_is_structured_code_not_message() -> None:
    """429 + error.code 'insufficient_quota' → 402 (documented structured code)."""
    exc = OpenAIRateLimitError(
        "rate limited",
        response=_resp(429),
        body={"error": {"code": "insufficient_quota"}},
    )
    mapped = map_openai_error(exc, "openai")
    assert isinstance(mapped, ProviderQuotaError)
    assert mapped.status_code == 402


def test_openai_plain_rate_limit_maps_to_429_with_retry_after() -> None:
    exc = OpenAIRateLimitError(
        "rate limited",
        response=_resp(429, {"retry-after": "9"}),
        body={"error": {"code": "rate_limit_exceeded"}},
    )
    mapped = map_openai_error(exc, "openai")
    assert isinstance(mapped, ProviderRateLimitedError)
    assert mapped.status_code == 429
    assert mapped.retry_after == 9


def test_openai_connection_and_server_map_to_503() -> None:
    assert isinstance(
        map_openai_error(OpenAIConnectionError(request=_resp(500).request), "openai"),
        ProviderUnavailableError,
    )
    assert isinstance(
        map_openai_error(
            OpenAIInternalError("boom", response=_resp(500), body={}), "openai"
        ),
        ProviderUnavailableError,
    )


def test_anthropic_error_family_maps_by_type() -> None:
    auth = AnthropicAuthError("bad key", response=_resp(401), body={})
    assert isinstance(map_anthropic_error(auth, "anthropic"), ProviderAuthError)

    rate = AnthropicRateLimitError(
        "slow down", response=_resp(429, {"retry-after": "12"}), body={}
    )
    rate_mapped = map_anthropic_error(rate, "anthropic")
    assert isinstance(rate_mapped, ProviderRateLimitedError)
    assert rate_mapped.retry_after == 12

    for exc in (
        AnthropicOverloadedError("overloaded", response=_resp(529), body={}),
        AnthropicInternalError("boom", response=_resp(500), body={}),
        AnthropicConnectionError(request=_resp(500).request),
    ):
        mapped = map_anthropic_error(exc, "anthropic")
        assert isinstance(mapped, ProviderUnavailableError)


def test_classification_is_type_based_not_message_based() -> None:
    """Same type maps the same way regardless of message text (no string matching)."""
    # A 401 whose message *mentions* quota must still be an auth error.
    tricky_auth = OpenAIAuthError(
        "your quota plan key is invalid", response=_resp(401), body={}
    )
    assert isinstance(map_openai_error(tricky_auth, "openai"), ProviderAuthError)
    # A 429 whose message says nothing helpful still classifies by body code.
    quota = OpenAIRateLimitError(
        "too many requests",
        response=_resp(429),
        body={"error": {"code": "insufficient_quota"}},
    )
    assert isinstance(map_openai_error(quota, "openai"), ProviderQuotaError)


# --- clients end-to-end with fake SDKs ---------------------------------------


class _FakeAnthropicSDK:
    def __init__(self, exc: Exception) -> None:
        self._exc = exc

    class _Messages:
        def __init__(self, exc: Exception) -> None:
            self._exc = exc

        async def create(self, **kwargs):  # noqa: ANN001
            raise self._exc

    @property
    def messages(self) -> _FakeAnthropicSDK._Messages:
        return _FakeAnthropicSDK._Messages(self._exc)


class _FakeOpenAISDK:
    def __init__(self, exc: Exception) -> None:
        self._exc = exc

    class _Completions:
        def __init__(self, exc: Exception) -> None:
            self._exc = exc

        async def create(self, **kwargs):  # noqa: ANN001
            raise self._exc

    class _Chat:
        def __init__(self, exc: Exception) -> None:
            self.completions = _FakeOpenAISDK._Completions(exc)

    @property
    def chat(self) -> _FakeOpenAISDK._Chat:
        return _FakeOpenAISDK._Chat(self._exc)


async def test_anthropic_client_raises_typed_rate_limit() -> None:
    rate = AnthropicRateLimitError(
        "slow down", response=_resp(429, {"retry-after": "30"}), body={}
    )
    llm = AnthropicLLM(
        api_key="sk-ant-test", model="claude-sonnet-4-5", sdk=_FakeAnthropicSDK(rate)
    )
    with pytest.raises(ProviderRateLimitedError) as excinfo:
        await llm.complete(system="s", prompt="p")
    assert excinfo.value.retry_after == 30


async def test_openai_client_raises_typed_quota() -> None:
    quota = OpenAIRateLimitError(
        "rate limited",
        response=_resp(429),
        body={"error": {"code": "insufficient_quota"}},
    )
    llm = OpenAILLM(api_key="sk-test", model="gpt-5.2", sdk=_FakeOpenAISDK(quota))
    with pytest.raises(ProviderQuotaError):
        await llm.complete(system="s", prompt="p")


# --- JSON mode: one structured-output retry, then fail loud ------------------


class _StubLLM:
    """Counts complete() calls; returns queued responses in order."""

    provider = "openai"

    def __init__(self, responses: list[str]) -> None:
        self._responses = list(responses)
        self.calls = 0

    async def complete(
        self,
        *,
        system: str,
        prompt: str,
        json_mode: bool = False,
        max_tokens: int = 2000,
    ) -> str:
        self.calls += 1
        return self._responses.pop(0)


async def test_json_retry_succeeds_on_second_call() -> None:
    llm = _StubLLM(["sure! here is the json: {'oops'", '{"ideas": [1, 2]}'])
    parsed = await complete_json_with_retry(
        llm, system="s", prompt="give me json", provider="openai"
    )
    assert parsed == {"ideas": [1, 2]}
    assert llm.calls == 2


async def test_json_retry_fails_loud_after_one_retry() -> None:
    llm = _StubLLM(["not json", "still not json"])
    with pytest.raises(GenerationError):
        await complete_json_with_retry(llm, system="s", prompt="give me json")
    assert llm.calls == 2


async def test_valid_json_needs_no_retry() -> None:
    llm = _StubLLM(['{"ideas": [1]}'])
    parsed = await complete_json_with_retry(llm, system="s", prompt="give me json")
    assert parsed == {"ideas": [1]}
    assert llm.calls == 1


# --- HTTP tier: taxonomy through the real test-key endpoint ------------------


def _make_probe(exc: Exception | None):
    async def _probe(
        provider: str, api_key: str, settings: object | None = None
    ) -> None:
        if exc is not None:
            raise exc

    return _probe


async def _store_openai_key(client, headers) -> None:
    response = await client.put(
        "/api/preferences",
        json={"openai_api_key": "sk-stored-key-9999"},
        headers=headers,
    )
    assert response.status_code == 200, response.text


async def test_probe_auth_error_surfaces_as_401(client, auth_headers, monkeypatch) -> None:
    await _store_openai_key(client, auth_headers)
    monkeypatch.setattr(
        preferences_module,
        "_probe_key",
        _make_probe(ProviderAuthError("rejected", provider="openai")),
    )
    response = await client.post("/api/keys/openai/test", headers=auth_headers)
    assert response.status_code == 401
    assert response.json()["kind"] == "PROVIDER_AUTH"


async def test_probe_rate_limit_surfaces_as_429_with_retry_after(
    client, auth_headers, monkeypatch
) -> None:
    await _store_openai_key(client, auth_headers)
    monkeypatch.setattr(
        preferences_module,
        "_probe_key",
        _make_probe(ProviderRateLimitedError("slow down", retry_after=15)),
    )
    response = await client.post("/api/keys/openai/test", headers=auth_headers)
    assert response.status_code == 429
    assert response.headers["Retry-After"] == "15"


async def test_probe_quota_surfaces_as_402(client, auth_headers, monkeypatch) -> None:
    await _store_openai_key(client, auth_headers)
    monkeypatch.setattr(
        preferences_module,
        "_probe_key",
        _make_probe(ProviderQuotaError("out of credit", provider="openai")),
    )
    response = await client.post("/api/keys/openai/test", headers=auth_headers)
    assert response.status_code == 402


async def test_probe_unavailable_surfaces_as_503(
    client, auth_headers, monkeypatch
) -> None:
    await _store_openai_key(client, auth_headers)
    monkeypatch.setattr(
        preferences_module,
        "_probe_key",
        _make_probe(ProviderUnavailableError("unreachable", provider="openai")),
    )
    response = await client.post("/api/keys/openai/test", headers=auth_headers)
    assert response.status_code == 503


async def test_test_key_success_never_leaks_key(
    client, auth_headers, monkeypatch
) -> None:
    stored = "sk-stored-key-9999"
    await _store_openai_key(client, auth_headers)
    monkeypatch.setattr(preferences_module, "_probe_key", _make_probe(None))
    response = await client.post("/api/keys/openai/test", headers=auth_headers)
    assert response.status_code == 200, response.text
    assert response.json()["valid"] is True
    assert stored not in response.text
    assert response.json()["hint"] == "****9999"


async def test_missing_key_on_test_endpoint_is_400(client, auth_headers) -> None:
    response = await client.post("/api/keys/openai/test", headers=auth_headers)
    assert response.status_code == 400
    body = response.json()
    assert body["kind"] == "MISSING_KEYS"
    assert "Settings" in body["detail"]
