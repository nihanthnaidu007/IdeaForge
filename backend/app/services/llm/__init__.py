"""LLM provider layer: direct Anthropic/OpenAI SDK clients + the provider seam."""

from app.services.llm.anthropic_client import AnthropicLLM
from app.services.llm.openai_client import OpenAILLM
from app.services.llm.provider import (
    GenerationError,
    LLMProvider,
    MissingKeyError,
    ProviderAuthError,
    ProviderError,
    ProviderQuotaError,
    ProviderRateLimitedError,
    ProviderUnavailableError,
    complete_json_with_retry,
    parse_json_output,
    resolve_user_key,
)

__all__ = [
    "AnthropicLLM",
    "GenerationError",
    "LLMProvider",
    "MissingKeyError",
    "OpenAILLM",
    "ProviderAuthError",
    "ProviderError",
    "ProviderQuotaError",
    "ProviderRateLimitedError",
    "ProviderUnavailableError",
    "complete_json_with_retry",
    "parse_json_output",
    "resolve_user_key",
]
