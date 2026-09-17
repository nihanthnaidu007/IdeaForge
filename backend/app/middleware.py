"""HTTP middleware: request-id correlation, request logging, and auth rate limiting.

RequestContext uses BaseHTTPMiddleware for ergonomics; the rate limiter is
pure ASGI so it adds no task switching and stays transparent to the lifespan.
"""

from __future__ import annotations

import logging
import time
import uuid

from starlette.middleware.base import BaseHTTPMiddleware, RequestResponseEndpoint
from starlette.requests import Request
from starlette.responses import JSONResponse, Response
from starlette.types import ASGIApp, Receive, Scope, Send

from app.config import Settings
from app.logging_setup import request_id_var
from app.rate_limit import RateLimitExceeded, SlidingWindowLimiter

logger = logging.getLogger(__name__)

_AUTH_RATE_LIMIT_PATHS = ("/api/auth/register", "/api/auth/login")


class RequestContextMiddleware(BaseHTTPMiddleware):
    """Assigns/propagates an X-Request-ID and emits one structured log line per request."""

    async def dispatch(
        self, request: Request, call_next: RequestResponseEndpoint
    ) -> Response:
        request_id = request.headers.get("x-request-id") or uuid.uuid4().hex[:16]
        token = request_id_var.set(request_id)
        started = time.perf_counter()
        try:
            response = await call_next(request)
        finally:
            request_id_var.reset(token)
        response.headers["x-request-id"] = request_id
        logging.getLogger("app.http").info(
            "request",
            extra={
                "method": request.method,
                "path": request.url.path,
                "duration_ms": round((time.perf_counter() - started) * 1000, 2),
            },
        )
        return response


class AuthRateLimitMiddleware:
    """Pure-ASGI limiter guarding register/login against brute force (429)."""

    def __init__(
        self,
        app: ASGIApp,
        limiter: SlidingWindowLimiter,
        *,
        settings: Settings,
    ) -> None:
        self.app = app
        self.limiter = limiter
        self.settings = settings

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] == "http" and scope["path"] in _AUTH_RATE_LIMIT_PATHS:
            key = self._key(scope)
            try:
                self.limiter.check(key)
            except RateLimitExceeded as exc:
                response = JSONResponse(
                    status_code=429,
                    content={
                        "detail": "Too many attempts. Please try again shortly.",
                        "kind": "RATE_LIMITED",
                        "retry_after": exc.retry_after,
                    },
                    headers={"Retry-After": str(exc.retry_after)},
                )
                await response(scope, receive, send)
                return
        await self.app(scope, receive, send)

    def _key(self, scope: Scope) -> str:
        path = scope.get("path", "")
        client = scope.get("client")
        host = client[0] if client else "unknown"
        if self.settings.trusted_proxy:
            headers = dict(scope.get("headers", []))
            forwarded = headers.get(b"x-forwarded-for")
            if forwarded:
                host = forwarded.split(b",")[0].decode().strip()
        return f"{path}:{host}"
