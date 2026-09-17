"""In-process reminder dispatcher — PLACEHOLDER.

The draft queue (schedule → reminder → export) is a separate release PR. This
worker owns the lifespan wiring and the shutdown contract now, so that PR
plugs its queue scan into a running task instead of re-plumbing the app.
No external scheduler in v1 by design — nothing here ever posts to LinkedIn.
"""

from __future__ import annotations

import asyncio
import logging

logger = logging.getLogger(__name__)


class ReminderWorker:
    def __init__(self, interval_seconds: float = 60.0) -> None:
        self._interval = interval_seconds
        self._task: asyncio.Task[None] | None = None

    def start(self) -> None:
        self._task = asyncio.get_running_loop().create_task(self._run())

    async def stop(self) -> None:
        if self._task is None:
            return
        self._task.cancel()
        try:
            await self._task
        except asyncio.CancelledError:
            pass
        self._task = None

    async def _run(self) -> None:
        while True:
            await asyncio.sleep(self._interval)
            # Draft-queue scan lands with the queue PR; the loop keeps the
            # dispatch cadence and shutdown contract warm until then.
            logger.debug("reminder worker tick (queue scan not yet wired)")
