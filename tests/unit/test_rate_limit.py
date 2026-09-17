"""Rate limiting: sliding-window unit behavior + the 429 auth-path contract."""

from __future__ import annotations

import httpx
import pytest
from app.main import create_app
from app.rate_limit import RateLimitExceeded, SlidingWindowLimiter

from tests.conftest import make_settings
from tests.unit.fakes import FakeDatabase


class FakeClock:
    def __init__(self) -> None:
        self.now = 1000.0

    def __call__(self) -> float:
        return self.now

    def advance(self, seconds: float) -> None:
        self.now += seconds


def test_limiter_allows_up_to_limit() -> None:
    clock = FakeClock()
    limiter = SlidingWindowLimiter(3, 60.0, clock=clock)
    for _ in range(3):
        limiter.check("k1")  # must not raise
    with pytest.raises(RateLimitExceeded):
        limiter.check("k1")


def test_limiter_raises_with_retry_after() -> None:
    clock = FakeClock()
    limiter = SlidingWindowLimiter(1, 60.0, clock=clock)
    limiter.check("k")
    with pytest.raises(RateLimitExceeded) as exc_info:
        limiter.check("k")
    assert exc_info.value.retry_after >= 1


def test_window_slide_frees_capacity() -> None:
    clock = FakeClock()
    limiter = SlidingWindowLimiter(2, 60.0, clock=clock)
    limiter.check("k")
    limiter.check("k")
    clock.advance(61.0)  # both hits age out of the window
    limiter.check("k")  # must not raise
    limiter.check("k")


def test_keys_are_independent() -> None:
    limiter = SlidingWindowLimiter(1, 60.0, clock=FakeClock())
    limiter.check("a")
    limiter.check("b")  # different key: unaffected


def test_reset_clears_state() -> None:
    limiter = SlidingWindowLimiter(1, 60.0, clock=FakeClock())
    limiter.check("k")
    limiter.reset()
    limiter.check("k")


def _limited_app(limit: int, *, trusted_proxy: bool = False):
    settings = make_settings(
        rate_limit_auth_per_minute=limit, TRUSTED_PROXY=trusted_proxy
    )
    return create_app(settings=settings, db=FakeDatabase())


async def test_auth_path_returns_429_with_retry_after() -> None:
    app = _limited_app(2)
    transport = httpx.ASGITransport(app=app, client=("198.51.100.5", 9999))
    async with app.router.lifespan_context(app):
        async with httpx.AsyncClient(
            transport=transport, base_url="http://testserver"
        ) as scoped:
            payload = {"email": "rl@example.com", "password": "whatever-123"}
            first = await scoped.post("/api/auth/login", json=payload)
            second = await scoped.post("/api/auth/login", json=payload)
            third = await scoped.post("/api/auth/login", json=payload)

            assert first.status_code == 401  # unknown user — but the attempt counts
            assert second.status_code == 401
            assert third.status_code == 429
            assert third.headers.get("retry-after") is not None
            assert third.json()["kind"] == "RATE_LIMITED"


async def test_non_auth_paths_are_not_limited() -> None:
    app = _limited_app(1)
    transport = httpx.ASGITransport(app=app, client=("198.51.100.5", 9999))
    async with app.router.lifespan_context(app):
        async with httpx.AsyncClient(
            transport=transport, base_url="http://testserver"
        ) as scoped:
            for _ in range(5):
                response = await scoped.get("/api/")
                assert response.status_code == 200


async def test_trusted_proxy_isolates_forwarded_clients() -> None:
    app = _limited_app(1, trusted_proxy=True)
    transport = httpx.ASGITransport(app=app, client=("10.0.0.1", 9999))
    async with app.router.lifespan_context(app):
        async with httpx.AsyncClient(
            transport=transport, base_url="http://testserver"
        ) as scoped:
            headers_a = {"X-Forwarded-For": "203.0.113.10"}
            headers_b = {"X-Forwarded-For": "203.0.113.11"}
            payload = {"email": "p@example.com", "password": "whatever-123"}

            r1 = await scoped.post("/api/auth/login", json=payload, headers=headers_a)
            r2 = await scoped.post("/api/auth/login", json=payload, headers=headers_a)
            r3 = await scoped.post("/api/auth/login", json=payload, headers=headers_b)

            assert r1.status_code == 401
            assert r2.status_code == 429  # same forwarded IP as r1
            assert r3.status_code == 401  # different forwarded IP: independent
