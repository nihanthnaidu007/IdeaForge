"""Fail-loud error taxonomy → HTTP mapping.

Typed service errors (provider, research) become honest statuses with a
``kind`` field the frontend can branch on; anything unhandled is a 500 with
the request id and a stack trace in the structured log. No handler here ever
fabricates content — that was the defect this rebuild removes.
"""

from __future__ import annotations

import logging

from fastapi import FastAPI, Request
from starlette.responses import JSONResponse

from app.logging_setup import get_request_id
from app.services.llm.provider import (
    MissingKeyError,
    ProviderAuthError,
    ProviderError,
    ProviderQuotaError,
    ProviderRateLimitedError,
    ProviderUnavailableError,
)
from app.services.research import ResearchError

logger = logging.getLogger("app.errors")

_TYPED_ERRORS: tuple[type[Exception], ...] = (
    MissingKeyError,
    ProviderAuthError,
    ProviderQuotaError,
    ProviderRateLimitedError,
    ProviderUnavailableError,
    ProviderError,
    ResearchError,
)


def register_exception_handlers(app: FastAPI) -> None:
    for exc_cls in _TYPED_ERRORS:
        app.add_exception_handler(exc_cls, _typed_error_handler)
    app.add_exception_handler(Exception, _unhandled_handler)


async def _typed_error_handler(request: Request, exc: Exception) -> JSONResponse:
    status = getattr(exc, "status_code", 500)
    kind = getattr(exc, "kind", exc.__class__.__name__.upper())
    provider = getattr(exc, "provider", None)
    body: dict[str, object] = {"detail": str(exc), "kind": kind}
    if provider:
        body["provider"] = provider
    request_id = get_request_id()
    if request_id:
        body["request_id"] = request_id
    logger.warning("typed error: %s (%s)", kind, exc)
    headers: dict[str, str] | None = None
    retry_after = getattr(exc, "retry_after", None)
    if retry_after:
        headers = {"Retry-After": str(int(retry_after))}
    return JSONResponse(status_code=status, content=body, headers=headers)


async def _unhandled_handler(request: Request, exc: Exception) -> JSONResponse:
    logger.exception("unhandled error on %s %s", request.method, request.url.path)
    body: dict[str, object] = {
        "detail": "Internal server error",
        "kind": "INTERNAL_ERROR",
    }
    request_id = get_request_id()
    if request_id:
        body["request_id"] = request_id
    return JSONResponse(status_code=500, content=body)
