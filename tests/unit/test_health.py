"""Health routes: root ping, /health/live, /health/ready (Mongo ping)."""

from __future__ import annotations

import httpx
from app.main import create_app

from tests.unit.fakes import FakeDatabase


async def test_root_ping(client) -> None:
    response = await client.get("/api/")
    assert response.status_code == 200
    assert response.json() == {"message": "IdeaForge API is running"}


async def test_health_live(client) -> None:
    response = await client.get("/health/live")
    assert response.status_code == 200
    assert response.json() == {"status": "ok"}


async def test_health_ready_with_mongo(client, fake_db) -> None:
    response = await client.get("/health/ready")
    assert response.status_code == 200
    assert response.json() == {"status": "ok", "mongo": "ok"}
    assert fake_db.commands_run  # the ping actually ran


async def test_health_ready_reports_unreachable_mongo() -> None:
    app = create_app(db=FakeDatabase(mongo_ok=False))
    transport = httpx.ASGITransport(app=app)
    async with app.router.lifespan_context(app):
        async with httpx.AsyncClient(
            transport=transport, base_url="http://testserver"
        ) as scoped:
            response = await scoped.get("/health/ready")
    assert response.status_code == 503
    assert response.json()["mongo"] == "unreachable"


async def test_every_response_carries_request_id(client) -> None:
    response = await client.get("/api/")
    assert response.headers.get("x-request-id")

    propagated = await client.get("/api/", headers={"X-Request-ID": "corr-123"})
    assert propagated.headers["x-request-id"] == "corr-123"
