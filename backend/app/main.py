"""App factory + lifespan: settings, db, vault, middleware, routers.

`create_app` is the single entrypoint (uvicorn/gunicorn target
`app.main:app`). Tests call it directly with an injected db / settings —
no module-level client is ever created at import time.
"""

from __future__ import annotations

import contextlib

import httpx
from fastapi import FastAPI
from starlette.middleware.cors import CORSMiddleware

from app.config import Settings, get_settings
from app.db import create_client, ensure_indexes, get_database
from app.errors import register_exception_handlers
from app.logging_setup import configure_logging
from app.middleware import AuthRateLimitMiddleware, RequestContextMiddleware
from app.rate_limit import SlidingWindowLimiter
from app.routers import api_router, health
from app.services.hooks import seed_hooks
from app.services.reminders import ReminderWorker
from app.services.vault import build_vault

DEFAULT_RATE_LIMIT_WINDOW_S = 60.0


def create_app(
    *,
    settings: Settings | None = None,
    db: object | None = None,
) -> FastAPI:
    settings = settings if settings is not None else get_settings()
    configure_logging(settings.log_level)

    app = FastAPI(title="IdeaForge API", lifespan=_build_lifespan(settings, db))

    app.include_router(api_router)
    # Probes stay at root — infrastructure endpoints, outside the /api surface.
    app.include_router(health.live_router)
    register_exception_handlers(app)

    # add_middleware prepends, so the last-added runs first. CORS outermost;
    # then RequestContext (assigns X-Request-ID, logs every request including
    # 429s); the pure-ASGI auth limiter innermost short-circuits to 429 while
    # still being wrapped — those responses carry a request id.
    limiter = SlidingWindowLimiter(
        settings.rate_limit_auth_per_minute, window_seconds=DEFAULT_RATE_LIMIT_WINDOW_S
    )
    app.add_middleware(AuthRateLimitMiddleware, limiter=limiter, settings=settings)
    app.add_middleware(RequestContextMiddleware, settings=settings)

    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.cors_origins,  # explicit list; '*' never reaches prod
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )
    return app


def _build_lifespan(settings: Settings, db: object | None):
    """Lifespan wired with injected db (tests) or a real client (runtime)."""

    @contextlib.asynccontextmanager
    async def lifespan(app: FastAPI):
        if db is not None:
            app.state.db = db
        else:
            client = create_client(settings)
            app.state.db = get_database(client, settings)
        app.state.settings = settings
        app.state.vault = build_vault(settings.encryption_master_key)
        app.state.http_client = httpx.AsyncClient(timeout=30.0)
        # In-process reminder dispatcher: overdue sweep on boot, then a scan
        # each interval. Reminders only — nothing here ever posts (spec
        # compliance ceiling).
        worker = ReminderWorker(app.state.db, settings)
        app.state.reminders = worker

        await ensure_indexes(app.state.db)
        await seed_hooks(app.state.db)  # idempotent Hook Bank catalog seed
        worker.start()
        yield
        await worker.stop()
        await app.state.http_client.aclose()

    return lifespan


app = create_app()
