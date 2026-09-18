"""BYOK cost hints (AI Craft Pack §6, art_1tEpMRty — the strings are verbatim).

The locked spec decision: every generation action shows a cost estimate before
it runs, because the user pays with their own API key. Estimation inputs are
token counts (prompt chars / 4, output from the format's length band); the
price table is operator-supplied via PROVIDER_PRICE_TABLE (JSON:
{"<model>": {"input_per_1k": float, "output_per_1k": float}}). When no price
exists for the model, the hint says so — never a fabricated number.
"""

from __future__ import annotations

import json
import math
from typing import Any

from app.config import Settings

# AI pack §6 cost-hint strings — exact copy, {placeholders} filled at render.
COST_HINTS: dict[str, str] = {
    "research": (
        "Heads up: this runs research and idea generation together — a live web search "
        "plus a few model calls at your configured model rates, about {est_usd}."
    ),
    "forge_ideas": (
        "Forging {n} ideas runs one model call on your key — about {est_usd}. Ideas are "
        "saved; re-forging is a new charge."
    ),
    "insight_card_first": (
        "First card for this idea runs one model call — about {est_usd}. It's cached after "
        "that."
    ),
    "insight_card_refresh": (
        "Refreshing discards the current card and runs a new model call — about {est_usd}."
    ),
    "generate_post": (
        "Each generated draft runs a model call on your API key — about {est_usd} ({model})."
    ),
    "generate_variant": (
        "Variant {k} is a full new generation on your key — about {est_usd}. Compare "
        "variants side by side before generating more."
    ),
    "swap_hook": (
        "New hook, new draft — about {est_usd} on your key. The variant stays the same."
    ),
    "voice_extract": (
        "Voice extraction runs one model call on your key — about {est_usd}. You can re-run "
        "it anytime; each run costs the same."
    ),
    "carousel": (
        "Carousels are the longest format — about {est_usd} per generation on your key. "
        "Still one call, no per-slide charges."
    ),
}

# AI pack §6: when no price table is available for the user's model, show this —
# never a fabricated number.
UNPRICED_HINT = "on your own API key (cost depends on your provider pricing)"


def _price_table(settings: Settings) -> dict[str, dict[str, float]]:
    raw = settings.provider_price_table
    if not raw:
        return {}
    try:
        parsed = json.loads(raw)
    except json.JSONDecodeError:
        return {}
    return parsed if isinstance(parsed, dict) else {}


def _render_usd(usd: float) -> str:
    # Round UP to the cent (AI pack §6); a $0.00 estimate would read as free.
    cents = max(1, math.ceil(usd * 100))
    return f"${cents / 100:.2f}"


def build_cost_hint(
    action: str,
    *,
    settings: Settings,
    provider: str,
    model: str,
    prompt_chars: int,
    output_tokens: int | None = None,
    n: int | None = None,
    k: int | None = None,
) -> dict[str, Any]:
    """Render a §6 string with {est_usd} computed from the operator price table.

    Returns {action, hint, estimated_usd, provider, model}; estimated_usd is
    None when no price exists for the model (the honest unpriced line).
    """
    table = _price_table(settings)
    prices = table.get(model)
    estimated_usd: float | None = None
    if prices:
        tokens_in = math.ceil(prompt_chars / 4)
        tokens_out = output_tokens if output_tokens is not None else 512
        estimated_usd = (
            tokens_in / 1000 * float(prices.get("input_per_1k", 0))
            + tokens_out / 1000 * float(prices.get("output_per_1k", 0))
        )

    if estimated_usd is None:
        return {
            "action": action,
            "hint": UNPRICED_HINT,
            "estimated_usd": None,
            "provider": provider,
            "model": model,
        }

    template = COST_HINTS[action]
    hint = template.format(
        est_usd=_render_usd(estimated_usd),
        model=model,
        n=n if n is not None else "",
        k=k if k is not None else "",
    )
    return {
        "action": action,
        "hint": hint,
        "estimated_usd": round(estimated_usd, 4),
        "provider": provider,
        "model": model,
    }


__all__ = ["COST_HINTS", "UNPRICED_HINT", "build_cost_hint"]
