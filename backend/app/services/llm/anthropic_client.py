"""Direct Anthropic SDK client — LLMProvider over the user's (or server's) key.

Replaces the scaffold's third-party LLM proxy hop: no universal-key shortcut, no
scaffold session layer. SDK failures are classified by exception TYPE
(:func:`map_anthropic_error`) into the typed provider errors — never by matching
message text, which is how the scaffold once confused quota and auth failures.
"""

from __future__ import annotations

from typing import Any

from anthropic import (
    AnthropicError,
    APIConnectionError,
    APIStatusError,
    AsyncAnthropic,
    AuthenticationError,
    BadRequestError,
    DeadlineExceededError,
    InternalServerError,
    OverloadedError,
    PermissionDeniedError,
    RateLimitError,
    ServiceUnavailableError,
    UnprocessableEntityError,
)

from app.services.llm.provider import (
    GenerationError,
    ProviderAuthError,
    ProviderError,
    ProviderQuotaError,
    ProviderRateLimitedError,
    ProviderUnavailableError,
)

_DEFAULT_TIMEOUT_SECONDS = 60.0

# Anthropic signals an exhausted credit balance as a 400 whose structured body
# carries a billing error type. We read the structured field only — the message
# is never pattern-matched. An unrecognized shape still fails loud (502).
_QUOTA_ERROR_TYPES = frozenset({"insufficient_credits", "billing_error"})


def _body_error_type(exc: APIStatusError) -> str | None:
    body = exc.body
    if not isinstance(body, dict):
        return None
    error = body.get("error")
    if isinstance(error, dict) and error.get("type"):
        return str(error["type"])
    return None


def _retry_after_seconds(exc: APIStatusError) -> int | None:
    response = getattr(exc, "response", None)
    if response is None:
        return None
    value = response.headers.get("retry-after")
    if value is None:
        return None
    try:
        return max(1, int(float(value)))
    except ValueError:
        return None


def map_anthropic_error(exc: AnthropicError, provider: str) -> ProviderError:
    """Classify an SDK failure by type into the honest error taxonomy."""
    if isinstance(exc, AuthenticationError):
        return ProviderAuthError(
            "Anthropic rejected the API key — please check Settings.", provider=provider
        )
    if isinstance(exc, PermissionDeniedError):
        return ProviderAuthError(
            "This Anthropic key is not allowed to use the requested model — "
            "please check Settings.",
            provider=provider,
        )
    if isinstance(exc, RateLimitError):
        return ProviderRateLimitedError(
            "Anthropic rate limit hit — please retry shortly.",
            provider=provider,
            retry_after=_retry_after_seconds(exc),
        )
    if isinstance(
        exc,
        (OverloadedError, InternalServerError, ServiceUnavailableError, DeadlineExceededError),
    ):
        return ProviderUnavailableError(
            "Anthropic is temporarily unavailable — please retry.",
            provider=provider,
        )
    if isinstance(exc, BadRequestError):
        if _body_error_type(exc) in _QUOTA_ERROR_TYPES:
            return ProviderQuotaError(
                "Your Anthropic account is out of credit — please top up or "
                "switch keys in Settings.",
                provider=provider,
            )
        return GenerationError(
            "Anthropic rejected the generation request. Please retry — if it "
            "persists, check the request in Settings.",
            provider=provider,
        )
    if isinstance(exc, UnprocessableEntityError):
        return GenerationError(
            "Anthropic could not process the generation request.",
            provider=provider,
        )
    if isinstance(exc, APIConnectionError):
        return ProviderUnavailableError(
            "Could not reach Anthropic — check connectivity and retry.",
            provider=provider,
        )
    return GenerationError(
        "Anthropic generation failed unexpectedly. Please retry.",
        provider=provider,
    )


def _response_text(response: Any) -> str:
    """Join the text content blocks of a Messages API response."""
    return "".join(
        block.text for block in response.content if getattr(block, "text", None)
    )


class AnthropicLLM:
    """LLMProvider implementation over the direct ``anthropic`` async SDK."""

    def __init__(
        self,
        *,
        api_key: str,
        model: str,
        timeout_seconds: float = _DEFAULT_TIMEOUT_SECONDS,
        sdk: AsyncAnthropic | None = None,
    ) -> None:
        # An injected sdk (tests) replaces the real client entirely.
        self._sdk = sdk if sdk is not None else AsyncAnthropic(
            api_key=api_key, timeout=timeout_seconds
        )
        self._model = model
        self.provider = "anthropic"

    async def complete(
        self,
        *,
        system: str,
        prompt: str,
        json_mode: bool = False,
        max_tokens: int = 2_000,
    ) -> str:
        # The Messages API has no json response_format; json_mode is honored by
        # instruction (the parsed output is still validated by the caller).
        if json_mode:
            system = (
                f"{system}\n\nRespond with ONLY a single valid JSON value — "
                "no prose, no markdown fences."
            )
        messages: list[dict[str, Any]] = [{"role": "user", "content": prompt}]
        return await self._create(messages, system=system, max_tokens=max_tokens)

    async def _create(
        self,
        messages: list[dict[str, Any]],
        *,
        system: str,
        max_tokens: int,
    ) -> str:
        try:
            response = await self._sdk.messages.create(
                model=self._model,
                system=system,
                messages=messages,
                max_tokens=max_tokens,
            )
        except AnthropicError as exc:
            raise map_anthropic_error(exc, self.provider) from exc
        text = _response_text(response)
        if not text.strip():
            raise GenerationError(
                "Anthropic returned an empty response. Please retry generation.",
                provider=self.provider,
            )
        return text
