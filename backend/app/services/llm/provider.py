"""LLM provider seam and the fail-loud provider error taxonomy.

The direct Anthropic/OpenAI SDK clients (:mod:`app.services.llm.anthropic_client`,
:mod:`app.services.llm.openai_client`) implement the ``LLMProvider`` protocol
below. What this module owns permanently:

- the ``LLMProvider`` protocol generation routes program against,
- key resolution (user BYOK → server env default → typed MissingKeyError),
- typed provider errors mapped to honest HTTP statuses,
- JSON output parsing that raises instead of substituting canned content.
"""

from __future__ import annotations

import json
from dataclasses import dataclass
from typing import Any, Literal, Protocol, runtime_checkable

from app.config import Settings
from app.services.audit import build_key_audit_event
from app.services.vault import Vault, VaultDecryptionError

Provider = Literal["anthropic", "openai", "tavily"]

_KEY_MISSING_COPY: dict[str, str] = {
    "tavily": "No Tavily API key configured. Please add your key in Settings.",
    "anthropic": "No Anthropic API key configured. Please add your key in Settings.",
    "openai": "No OpenAI API key configured. Please add your key in Settings.",
}


class ProviderError(Exception):
    """Base for typed provider failures — routers map these to honest statuses."""

    status_code = 500
    kind = "PROVIDER_ERROR"

    def __init__(self, message: str, *, provider: str | None = None) -> None:
        super().__init__(message)
        self.provider = provider


class MissingKeyError(ProviderError):
    status_code = 400
    kind = "MISSING_KEYS"


class ProviderAuthError(ProviderError):
    status_code = 401
    kind = "PROVIDER_AUTH"


class ProviderQuotaError(ProviderError):
    status_code = 402
    kind = "PROVIDER_QUOTA"


class ProviderRateLimitedError(ProviderError):
    """Provider rate limit (HTTP 429) — carries an optional Retry-After hint."""

    status_code = 429
    kind = "PROVIDER_RATE_LIMITED"

    def __init__(
        self,
        message: str,
        *,
        provider: str | None = None,
        retry_after: int | None = None,
    ) -> None:
        super().__init__(message, provider=provider)
        self.retry_after = retry_after


class ProviderUnavailableError(ProviderError):
    status_code = 503
    kind = "PROVIDER_UNAVAILABLE"


class GenerationError(ProviderError):
    status_code = 502
    kind = "GENERATION_FAILED"


class GenerationRefusedError(GenerationError):
    """The model declined per the fail-loud rules (craft pack §4.4).

    A refusal is the model telling the truth about its inputs — it is a valid,
    correct response, never retried silently and never replaced with canned
    content. Surfaced as its own kind so the UI can render the per-variant
    "needs sources" state while sibling variants stand.
    """

    status_code = 502
    kind = "GENERATION_REFUSED"


class InsufficientEvidenceError(GenerationError):
    """Insight-card input cannot support the idea (craft pack §5.2).

    Distinct from a malformed response: the model answered correctly that the
    trend context cannot source this idea. The fix is better research, not a
    retry — the kind tells the UI to say exactly that.
    """

    status_code = 502
    kind = "INSUFFICIENT_EVIDENCE"


@dataclass(frozen=True)
class TokenUsage:
    """Token counts of one completed LLM call, as reported by the provider SDK.

    Feeds usage events (honest analytics — the user's own spend made visible).
    ``last_usage`` on the concrete clients holds the usage of the most recent
    successful ``complete()``; fakes that don't track usage simply don't set it
    (``last_usage_of`` returns None and the event omits token counts).
    """

    tokens_in: int
    tokens_out: int


def last_usage_of(llm: Any) -> TokenUsage | None:
    """Read the usage of the last completed call from a provider instance."""
    usage = getattr(llm, "last_usage", None)
    if isinstance(usage, TokenUsage):
        return usage
    return None


@runtime_checkable
class LLMProvider(Protocol):
    async def complete(
        self,
        *,
        system: str,
        prompt: str,
        json_mode: bool = False,
        max_tokens: int = 2_000,
    ) -> str: ...


_JSON_RETRY_INSTRUCTION = (
    "Your previous response was not valid JSON. Respond again with ONLY the JSON "
    "value — no prose, no markdown fences. Do not change the data, only its shape."
)


async def complete_json_with_retry(
    llm: LLMProvider,
    *,
    system: str,
    prompt: str,
    max_tokens: int = 2_000,
    provider: str | None = None,
) -> Any:
    """Generate JSON via json_mode, retrying once if the output is unparseable.

    Returns the parsed value or raises GenerationError — never returns canned
    content (spec: fail-loud data honesty).
    """
    response = await llm.complete(
        system=system, prompt=prompt, json_mode=True, max_tokens=max_tokens
    )
    try:
        return parse_json_output(response, provider=provider)
    except GenerationError:
        pass  # exactly one structured-output retry (spec), then fail loud
    retry = await llm.complete(
        system=system,
        prompt=f"{prompt}\n\n{_JSON_RETRY_INSTRUCTION}",
        json_mode=True,
        max_tokens=max_tokens,
    )
    return parse_json_output(retry, provider=provider)


async def resolve_user_key(
    db: Any, vault: Vault, user_id: str, provider: str, settings: Settings
) -> str:
    """User BYOK (decrypted) → server env default → MissingKeyError.

    No scaffold-layer fallback: an absent key is a typed error, never a
    third-party proxy key.
    """
    prefs = await db.user_preferences.find_one({"user_id": user_id}, {"_id": 0})
    blob = ((prefs or {}).get("keys") or {}).get(provider)
    if blob:
        try:
            api_key = vault.decrypt(user_id, provider, blob)
        except VaultDecryptionError as exc:
            # Audit the use-failure before surfacing it — decrypt failures are
            # exactly when a key may have been tampered with or orphaned.
            await db.key_audit.insert_one(
                build_key_audit_event(user_id, provider, "use_failure")
            )
            raise ProviderAuthError(
                "Stored API key could not be decrypted — please re-save it in Settings.",
                provider=provider,
            ) from exc
        # M5: BYOK use-success is audited with the request id, so the ledger
        # shows every request that consumed this key — not only its failures.
        await db.key_audit.insert_one(build_key_audit_event(user_id, provider, "used"))
        return api_key

    env_key = getattr(settings, f"{provider}_api_key", None)
    if env_key:
        return str(env_key)

    raise MissingKeyError(_KEY_MISSING_COPY[provider], provider=provider)


def strip_code_fences(text: str) -> str:
    clean = text.strip()
    if clean.startswith("```"):
        clean = clean.split("```")[1]
        if clean.startswith("json"):
            clean = clean[4:]
    return clean.strip()


def parse_json_output(text: str, *, provider: str | None = None) -> Any:
    """Parse model JSON output or raise GenerationError — never canned content."""
    try:
        return json.loads(strip_code_fences(text))
    except json.JSONDecodeError as exc:
        raise GenerationError(
            "The model returned unparseable JSON. Please retry generation.",
            provider=provider,
        ) from exc

