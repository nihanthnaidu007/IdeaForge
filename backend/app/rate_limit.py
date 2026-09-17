"""In-process sliding-window rate limiting for auth endpoints.

Redis-backed shared state arrives when the deployment is multi-worker
(REDIS_URL); per-process limits are the honest default for v1.
"""

from __future__ import annotations

import threading
import time
from collections import deque
from collections.abc import Callable


class RateLimitExceeded(Exception):
    def __init__(self, retry_after: int) -> None:
        super().__init__(f"Rate limit exceeded, retry after {retry_after}s")
        self.retry_after = retry_after


class SlidingWindowLimiter:
    """Fixed-count sliding window keyed by arbitrary string (e.g. ``path:ip``)."""

    # Bound on distinct tracked keys — with sane identity this never trips;
    # it caps memory growth if a deployment ever keys on attacker-controlled
    # space again (L2).
    MAX_KEYS = 10_000

    def __init__(
        self,
        limit: int,
        window_seconds: float = 60.0,
        *,
        clock: Callable[[], float] = time.monotonic,
    ) -> None:
        self._limit = limit
        self._window = window_seconds
        self._clock = clock
        self._hits: dict[str, deque[float]] = {}
        self._lock = threading.Lock()

    def check(self, key: str) -> None:
        """Count one hit or raise :class:`RateLimitExceeded` with the retry window."""
        now = self._clock()
        with self._lock:
            if key not in self._hits and len(self._hits) >= self.MAX_KEYS:
                self._hits.pop(next(iter(self._hits)))  # evict oldest-inserted
            hits = self._hits.setdefault(key, deque())
            while hits and (now - hits[0] > self._window):
                hits.popleft()
            hits.append(now)
            if len(hits) > self._limit:
                retry_after = max(1, int(self._window - (now - hits[0]) + 1))
                raise RateLimitExceeded(retry_after)

    def reset(self) -> None:
        with self._lock:
            self._hits.clear()
