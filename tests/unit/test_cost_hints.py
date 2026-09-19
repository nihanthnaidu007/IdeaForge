"""Cost-hint strings and rendering: the research hint covers what the combined
research→forge run actually spends — and promises nothing the UI does not do.

Wave 1 cost-hint work item (spec art_YGBAEBjk): the first spend in the product
must carry a hedged estimate before it fires, and the string must never
advertise a phantom affordance — the old "re-use the last research" line
described an action the UI does not offer.
"""

from __future__ import annotations

import json

from app.services.cost_hints import COST_HINTS, UNPRICED_HINT, build_cost_hint

from tests.conftest import make_settings

PRICED_MODEL = "gpt-test"
PRICE_TABLE = {PRICED_MODEL: {"input_per_1k": 1.0, "output_per_1k": 2.0}}


def _priced_settings():
    return make_settings(provider_price_table=json.dumps(PRICE_TABLE))


def test_research_hint_drops_the_phantom_reuse_affordance() -> None:
    """The corrected string never promises an action the UI does not offer."""
    hint = COST_HINTS["research"]
    assert "re-use" not in hint.lower()
    assert "instead" not in hint.lower()


def test_research_hint_covers_research_and_generation() -> None:
    """By end of wave the run = Tavily search + trend enrichment + one ideas
    call — "a few model calls" keeps the hint accurate as the wave lands."""
    hint = COST_HINTS["research"]
    assert "research" in hint
    assert "idea generation" in hint
    assert "model calls" in hint
    assert "{est_usd}" in hint


def test_build_cost_hint_research_renders_a_priced_estimate() -> None:
    result = build_cost_hint(
        "research",
        settings=_priced_settings(),
        provider="openai",
        model=PRICED_MODEL,
        prompt_chars=6000,
    )
    assert result["estimated_usd"] is not None
    assert result["hint"].startswith("Heads up:")
    assert "about $" in result["hint"]
    assert "re-use" not in result["hint"].lower()


def test_build_cost_hint_research_unpriced_stays_honest() -> None:
    """No price for the model → the honest fallback line, never a number."""
    result = build_cost_hint(
        "research",
        settings=make_settings(),
        provider="openai",
        model=PRICED_MODEL,
        prompt_chars=6000,
    )
    assert result["estimated_usd"] is None
    assert result["hint"] == UNPRICED_HINT


async def test_cost_estimate_route_serves_a_research_hint_without_the_phantom(
    client, auth_headers
) -> None:
    """Route wiring: /cost-estimate?action=research serves the hint the
    dashboard shows before the first spend — never the re-use affordance."""
    stored = await client.put(
        "/api/preferences",
        json={"openai_api_key": "sk-openai-local-test-key-0123456789"},
        headers=auth_headers,
    )
    assert stored.status_code == 200, stored.text

    response = await client.get(
        "/api/cost-estimate?action=research", headers=auth_headers
    )
    assert response.status_code == 200, response.text
    body = response.json()
    assert body["action"] == "research"
    assert "re-use" not in body["hint"].lower()
