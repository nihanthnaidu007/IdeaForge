"""LLM provider seam and the fail-loud provider error taxonomy.

The direct Anthropic/OpenAI SDK clients land in the next release PR; today the
seam returns :class:`UnconfiguredLLM`, which fails loud (503) instead of
pretending. What this module owns permanently:

- the ``LLMProvider`` protocol generation routes program against,
- key resolution (user BYOK → server env default → typed MissingKeyError),
- typed provider errors mapped to honest HTTP statuses,
- JSON output parsing that raises instead of substituting canned content.
"""

from __future__ import annotations

import json
from typing import Any, Literal, Protocol, runtime_checkable

from app.config import Settings
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


class ProviderUnavailableError(ProviderError):
    status_code = 503
    kind = "PROVIDER_UNAVAILABLE"


class GenerationError(ProviderError):
    status_code = 502
    kind = "GENERATION_FAILED"


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


class UnconfiguredLLM:
    """Stub provider until the direct-SDK provider layer lands (next release PR).

    Fails loud with PROVIDER_UNAVAILABLE — it never returns synthetic content.
    """

    def __init__(self, provider: str) -> None:
        self.provider = provider

    async def complete(
        self,
        *,
        system: str,
        prompt: str,
        json_mode: bool = False,
        max_tokens: int = 2_000,
    ) -> str:
        raise ProviderUnavailableError(
            "LLM provider clients are not wired yet — the provider layer lands "
            "in the next release PR.",
            provider=self.provider,
        )


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
            return vault.decrypt(user_id, provider, blob)
        except VaultDecryptionError as exc:
            raise ProviderAuthError(
                "Stored API key could not be decrypted — please re-save it in Settings.",
                provider=provider,
            ) from exc

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
