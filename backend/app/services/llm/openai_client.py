"""Direct OpenAI SDK client — LLMProvider over the user's (or server's) key.

Replaces the scaffold's third-party LLM proxy hop: no universal-key shortcut, no
scaffold session layer. SDK failures are classified by exception TYPE
(:func:`map_openai_error`) into the typed provider errors — never by matching
message text. The one structured-body read is OpenAI's documented
``insufficient_quota`` error code on a 429, which distinguishes "out of credit"
(402) from a plain rate limit (429).
"""

from __future__ import annotations

from typing import Any

from openai import (
    APIConnectionError,
    APIStatusError,
    AsyncOpenAI,
    AuthenticationError,
    BadRequestError,
    InternalServerError,
    OpenAIError,
    PermissionDeniedError,
    RateLimitError,
    UnprocessableEntityError,
)

from app.services.llm.provider import (
    GenerationError,
    ProviderAuthError,
    ProviderError,
    ProviderQuotaError,
    ProviderRateLimitedError,
    ProviderUnavailableError,
    TokenUsage,
)

_DEFAULT_TIMEOUT_SECONDS = 60.0

# OpenAI signals exhausted credit with HTTP 429 and error.code
# "insufficient_quota" (documented, structured). Everything else on 429 is a
# genuine rate limit.
_QUOTA_BODY_CODES = frozenset({"insufficient_quota"})


def _body_code(exc: APIStatusError) -> str | None:
    body = exc.body
    if not isinstance(body, dict):
        return None
    # The SDK flattens OpenAI's {"error": {...}} envelope into the body
    # itself — accept both the wrapped and flattened shapes.
    error = body.get("error")
    if isinstance(error, dict) and error.get("code"):
        return str(error["code"])
    if body.get("code"):
        return str(body["code"])
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


def map_openai_error(exc: OpenAIError, provider: str) -> ProviderError:
    """Classify an SDK failure by type into the honest error taxonomy."""
    if isinstance(exc, AuthenticationError):
        return ProviderAuthError(
            "OpenAI rejected the API key — please check Settings.", provider=provider
        )
    if isinstance(exc, PermissionDeniedError):
        return ProviderAuthError(
            "This OpenAI key is not allowed to use the requested model — "
            "please check Settings.",
            provider=provider,
        )
    if isinstance(exc, RateLimitError):
        if _body_code(exc) in _QUOTA_BODY_CODES:
            return ProviderQuotaError(
                "Your OpenAI account is out of credit (quota exceeded) — please "
                "top up or switch keys in Settings.",
                provider=provider,
            )
        return ProviderRateLimitedError(
            "OpenAI rate limit hit — please retry shortly.",
            provider=provider,
            retry_after=_retry_after_seconds(exc),
        )
    if isinstance(exc, InternalServerError):
        return ProviderUnavailableError(
            "OpenAI is temporarily unavailable — please retry.",
            provider=provider,
        )
    if isinstance(exc, (BadRequestError, UnprocessableEntityError)):
        return GenerationError(
            "OpenAI rejected the generation request. Please retry — if it "
            "persists, check the request in Settings.",
            provider=provider,
        )
    if isinstance(exc, APIConnectionError):
        return ProviderUnavailableError(
            "Could not reach OpenAI — check connectivity and retry.",
            provider=provider,
        )
    return GenerationError(
        "OpenAI generation failed unexpectedly. Please retry.",
        provider=provider,
    )


def _response_text(response: Any) -> str:
    """Extract the assistant message text from a Chat Completions response."""
    choices = getattr(response, "choices", None)
    if not choices:
        return ""
    message = getattr(choices[0], "message", None)
    content = getattr(message, "content", None)
    return content if isinstance(content, str) else ""


class OpenAILLM:
    """LLMProvider implementation over the direct ``openai`` async SDK."""

    def __init__(
        self,
        *,
        api_key: str,
        model: str,
        timeout_seconds: float = _DEFAULT_TIMEOUT_SECONDS,
        base_url: str | None = None,
        sdk: AsyncOpenAI | None = None,
    ) -> None:
        # An injected sdk (tests) replaces the real client entirely.
        self.provider_name = "openai"
        self.model_name = model
        self._sdk = sdk if sdk is not None else AsyncOpenAI(
            api_key=api_key, timeout=timeout_seconds, base_url=base_url
        )
        self._model = model
        self.provider = "openai"

    async def complete(
        self,
        *,
        system: str,
        prompt: str,
        json_mode: bool = False,
        max_tokens: int = 2_000,
    ) -> str:
        messages: list[dict[str, Any]] = [
            {"role": "system", "content": system},
            {"role": "user", "content": prompt},
        ]
        return await self._create(messages, max_tokens=max_tokens, json_mode=json_mode)

    async def _create(
        self,
        messages: list[dict[str, Any]],
        *,
        max_tokens: int,
        json_mode: bool = False,
    ) -> str:
        try:
            # json_object mode requires the word JSON in the messages — every
            # json_mode caller's prompt asks for JSON output by contract.
            response = await self._sdk.chat.completions.create(
                model=self._model,
                messages=messages,
                max_completion_tokens=max_tokens,
                **({"response_format": {"type": "json_object"}} if json_mode else {}),
            )
        except OpenAIError as exc:
            raise map_openai_error(exc, self.provider) from exc
        self._record_usage(getattr(response, "usage", None))
        text = _response_text(response)
        if not text.strip():
            raise GenerationError(
                "OpenAI returned an empty response. Please retry generation.",
                provider=self.provider,
            )
        return text

    def _record_usage(self, usage: Any) -> None:
        """Capture the SDK usage block; absent usage stays None, never zero."""
        if usage is None:
            self.last_usage = None
            return
        tokens_in = getattr(usage, "prompt_tokens", None)
        tokens_out = getattr(usage, "completion_tokens", None)
        if isinstance(tokens_in, int) and isinstance(tokens_out, int):
            self.last_usage = TokenUsage(tokens_in=tokens_in, tokens_out=tokens_out)
