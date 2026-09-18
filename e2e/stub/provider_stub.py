"""Provider stub server — the E2E mock boundary (E2E pack §2.2).

Serves canned §5 fixtures with Tavily/Anthropic/OpenAI response shapes on
port 9001. Deterministic: fixed ids, fixed token counts, request records
indexed monotonically — no wall clock, no randomness. ``/admin/*`` switches
scenarios and exposes what the backend actually sent (the wire-level proof
the journeys assert on).
"""
from __future__ import annotations

import json
import logging
import sys
from pathlib import Path
from typing import Any

from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse, Response, StreamingResponse
from pydantic import BaseModel

ROOT = Path(__file__).resolve().parent.parent
SCENARIOS = ROOT / "fixtures" / "scenarios"
PROVIDERS = ROOT / "fixtures" / "providers"

app = FastAPI(title="IdeaForge provider stub")
_state: dict[str, str] = {"scenario": "research-ok"}
_seq = 0
_records: list[dict[str, Any]] = []
_sequence_idx: dict[int, int] = {}

# Request-level trace (#16): one line per provider call so a red E2E run
# answers "did the call arrive and what returned" from the CI log alone.
# Uvicorn only configures its own loggers — without an explicit handler the
# root logger's WARNING floor would swallow INFO lines.
_trace = logging.getLogger("e2e.stub.trace")
if not _trace.handlers:
    # stderr, not stdout: the E2E harness pipes webServer stderr into the test
    # output (uvicorn banners, backend JSON logs all surface there) while
    # stdout — uvicorn's access stream — is swallowed (#16: zero HTTP/1.1
    # lines in CI). stderr is also line-buffered under pipes.
    _handler = logging.StreamHandler(sys.stderr)
    _handler.setFormatter(logging.Formatter("%(message)s"))
    _trace.addHandler(_handler)
_trace.setLevel(logging.INFO)
_trace.propagate = False


def _trace_call(provider: str, rule: dict[str, Any] | None, resp: str, seq: str | None = None) -> None:
    parts = [
        "STUB-CALL",
        f"provider={provider}",
        f"scenario={_state['scenario']}",
        f"rule={(rule or {}).get('_idx', '-')}",
    ]
    if seq is not None:
        parts.append(f"seq={seq}")
    parts.append(f"resp={resp}")
    _trace.info(" ".join(parts))


def _fixture(name: str) -> Any:
    return json.loads((PROVIDERS / f"{name}.json").read_text(encoding="utf-8"))


class ScenarioIn(BaseModel):
    scenario: str


@app.post("/admin/scenario")
async def set_scenario(data: ScenarioIn) -> Any:
    path = SCENARIOS / f"{data.scenario}.json"
    if not path.exists():
        return JSONResponse(status_code=404, content={"detail": f"unknown scenario '{data.scenario}'"})
    _state["scenario"] = data.scenario
    _sequence_idx.clear()
    _trace.info("STUB-ADMIN scenario=%s sequence_counters=cleared", data.scenario)
    return {"loaded": data.scenario}


@app.get("/admin/scenario")
async def get_scenario() -> dict[str, str]:
    return {"active": _state["scenario"]}


@app.get("/admin/requests")
async def get_requests() -> list[dict[str, Any]]:
    return list(reversed(_records))


@app.delete("/admin/requests")
async def clear_requests() -> dict[str, bool]:
    _records.clear()
    return {"cleared": True}


def _record(provider: str, request: Request, body: Any) -> None:
    global _seq
    _seq += 1
    # Auth-header VALUES are recorded deliberately (sentinels only): J02
    # asserts the probe used the user's key, not a server default.
    headers = {
        k.lower(): v
        for k, v in request.headers.items()
        if k.lower() in ("x-api-key", "authorization")
    }
    _records.append(
        {"provider": provider, "path": request.url.path, "headers": headers, "body": body, "at": _seq}
    )


def _rules(provider: str) -> list[dict[str, Any]]:
    doc = json.loads((SCENARIOS / f"{_state['scenario']}.json").read_text(encoding="utf-8"))
    return doc.get(provider, [])


def _matched(rule: dict[str, Any], body: dict[str, Any]) -> bool:
    for key, frag in (rule.get("match_body_contains") or {}).items():
        if frag not in json.dumps(body.get(key, ""), default=str):
            return False
    if "match_query_contains" in rule and rule["match_query_contains"] not in str(body.get("query", "")):
        return False
    if "match_max_tokens" in rule and body.get("max_tokens") != rule["match_max_tokens"]:
        return False
    return True


def _inner_text(fixture: Any) -> str:
    if isinstance(fixture, dict) and "__raw_text__" in fixture:
        return str(fixture["__raw_text__"])
    return json.dumps(fixture, separators=(",", ":"))


def _wrap(inner: str, provider: str) -> dict[str, Any]:
    # §5.3 envelope rule: fixed ids/usage so responses are byte-identical.
    if provider == "anthropic":
        return {
            "id": "msg_e2e_fixed",
            "type": "message",
            "role": "assistant",
            "model": "claude-sonnet-4-5",
            "content": [{"type": "text", "text": inner}],
            "stop_reason": "end_turn",
            "usage": {"input_tokens": 1200, "output_tokens": 450},
        }
    return {
        "id": "chatcmpl-e2e_fixed",
        "object": "chat.completion",
        "model": "gpt-5.2",
        "choices": [{"index": 0, "message": {"role": "assistant", "content": inner}, "finish_reason": "stop"}],
        "usage": {"prompt_tokens": 1200, "completion_tokens": 450},
    }


def _serve(rule: dict[str, Any], provider: str) -> Any:
    if rule.get("close_connection"):
        # Mid-flight network failure (§4 F06): headers sent, body truncated —
        # the SDK raises RemoteProtocolError → ResearchError.
        _trace_call(provider, rule, "stream:midflight-reset")

        async def partial():
            yield b'{"results": [{"title": "partial'
            raise ConnectionResetError("stub simulated mid-flight reset")

        return StreamingResponse(partial(), media_type="application/json")
    if "sequence" in rule:
        # Keyed by (scenario, provider, rule position) — the scenario file is
        # re-read per request, so id(rule) would reset the counter each call.
        key = (_state["scenario"], rule.get("_provider"), rule.get("_idx"))
        idx = _sequence_idx.get(key, 0)
        _sequence_idx[key] = idx + 1
        # Sequences wrap modulo — exhaustion cannot index out of range (#16).
        total = len(rule["sequence"])
        pos = idx % total
        _trace_call(provider, rule, f"fixture:{rule['sequence'][pos]}", seq=f"{idx}({pos}/{total})")
        return _fixture(rule["sequence"][pos])
    if "serve_status" in rule:
        content = _fixture(rule["serve_fixture"]) if rule.get("serve_fixture") else {"detail": "stub error"}
        _trace_call(provider, rule, f"status:{rule['serve_status']}")
        return JSONResponse(status_code=int(rule["serve_status"]), content=content)
    if rule.get("serve_fixture"):
        _trace_call(provider, rule, f"fixture:{rule['serve_fixture']}")
        return _fixture(rule["serve_fixture"])
    _trace_call(provider, rule, "noaction:404")
    return JSONResponse(status_code=404, content={"detail": "stub rule has no serve action"})


def _handle(provider: str, request: Request, body: dict[str, Any], wrap: bool) -> Any:
    _record(provider, request, body)
    for idx, rule in enumerate(_rules(provider)):
        rule["_provider"] = provider
        rule["_idx"] = idx
        if _matched(rule, body):
            served = _serve(rule, provider)
            if isinstance(served, Response):
                return served
            return _wrap(_inner_text(served), provider) if wrap else served
    _trace_call(provider, None, "nomatch:404")
    return JSONResponse(status_code=404, content={"detail": f"no {provider} rule matched"})


@app.post("/tavily/search")
async def tavily_search(request: Request) -> Any:
    return _handle("tavily", request, await request.json(), wrap=False)


@app.post("/v1/messages")
async def anthropic_messages(request: Request) -> Any:
    return _handle("anthropic", request, await request.json(), wrap=True)


@app.post("/v1/chat/completions")
async def openai_chat(request: Request) -> Any:
    return _handle("openai", request, await request.json(), wrap=True)


@app.get("/v1/models")
async def openai_models(request: Request) -> Any:
    # Both SDKs probe key validity via GET /v1/models; the caller is
    # distinguished by auth header — Anthropic sends x-api-key, OpenAI a
    # Bearer token — and served the matching model-list shape.
    is_anthropic = "x-api-key" in request.headers
    provider = "anthropic" if is_anthropic else "openai"
    _record(provider, request, {})
    for idx, rule in enumerate(_rules(provider)):
        rule["_provider"] = provider
        rule["_idx"] = idx
        if "serve_status" in rule:
            return _serve(rule, provider)
    if is_anthropic:
        return {
            "data": [
                {
                    "id": "claude-sonnet-4-5",
                    "type": "model",
                    "display_name": "Claude Sonnet 4.5",
                }
            ],
            "first_id": "claude-sonnet-4-5",
            "has_more": False,
            "last_id": "claude-sonnet-4-5",
        }
    return {"object": "list", "data": [{"id": "gpt-5.2", "object": "model"}]}
