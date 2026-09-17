"""Shared fixtures: test env, settings builder, fake db, lifespan-managed client.

The conftest sets backend test env defaults BEFORE app modules import, because
``app.main`` executes ``app = create_app()`` at import time and must refuse to
boot without secrets (that refusal is itself tested in test_config.py).
"""

from __future__ import annotations

import base64
import os
from collections.abc import AsyncIterator
from typing import Any

import httpx
import pytest

# --- test env, before any app import ---------------------------------------
_TEST_ENV = {
    "MONGO_URL": "mongodb://localhost:27017",
    "JWT_SECRET": "test-only-jwt-secret-not-used-in-prod",
    "ENCRYPTION_MASTER_KEY": base64.b64encode(b"0" * 32).decode("ascii"),
}
for key, value in _TEST_ENV.items():
    os.environ.setdefault(key, value)

# Every env key make_settings may have written — scrubbed on the next call.
_TOUCHED_ENV_KEYS: set[str] = set(_TEST_ENV)

from app.config import Settings  # noqa: E402  (env must exist first)
from app.main import create_app  # noqa: E402

from tests.unit.fakes import FakeDatabase  # noqa: E402

VALID_MASTER_KEY = _TEST_ENV["ENCRYPTION_MASTER_KEY"]


def make_settings(**env_overrides: Any) -> Settings:
    """Build Settings from explicit env, bypassing any repo .env file.

    A ``None`` override removes the variable entirely — the honest way to test
    "required secret is missing" against a clean environment. Keys set by a
    previous call (e.g. ``ENV=prod``) are scrubbed first so tests stay isolated.
    """
    env = dict(_TEST_ENV)
    for key, value in env_overrides.items():
        name = key.upper()
        if value is None:
            env.pop(name, None)
        else:
            env[name] = str(value)
    for key in _TOUCHED_ENV_KEYS:
        os.environ.pop(key, None)
    for key, value in env.items():
        os.environ[key] = value
    _TOUCHED_ENV_KEYS.update(env)
    return Settings(_env_file=None)


@pytest.fixture
def fake_db() -> FakeDatabase:
    return FakeDatabase()


@pytest.fixture
def settings() -> Settings:
    return make_settings()


@pytest.fixture
def app(settings: Settings, fake_db: FakeDatabase):
    return create_app(settings=settings, db=fake_db)


@pytest.fixture
async def client(app) -> AsyncIterator[httpx.AsyncClient]:
    """ASGI client with the app lifespan (indexes, vault, http pool) running."""
    transport = httpx.ASGITransport(app=app, client=("203.0.113.7", 51234))
    async with app.router.lifespan_context(app):
        async with httpx.AsyncClient(
            transport=transport, base_url="http://testserver"
        ) as async_client:
            yield async_client


@pytest.fixture
async def auth_headers(client: httpx.AsyncClient) -> dict[str, str]:
    """Register a user and return bearer headers for authenticated calls."""
    response = await client.post(
        "/api/auth/register",
        json={
            "email": "creator@example.com",
            "password": "correct-horse-9",
            "name": "Creator",
        },
    )
    assert response.status_code == 200, response.text
    token = response.json()["token"]
    return {"Authorization": f"Bearer {token}"}


async def store_tavily_key(
    client: httpx.AsyncClient, headers: dict[str, str]
) -> None:
    """Store a Tavily key through the real (encrypted) preferences route."""
    response = await client.put(
        "/api/preferences",
        json={"tavily_api_key": "tvly-local-dev-key"},
        headers=headers,
    )
    assert response.status_code == 200, response.text
