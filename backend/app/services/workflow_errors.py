"""Typed workflow errors — board/queue domain failures mapped to honest HTTP.

Same contract as the provider taxonomy (``status_code`` + ``kind`` attrs,
consumed by ``app.errors``): the frontend branches on ``kind`` and the detail
line stays product-neutral. Workflow failures never carry provider semantics —
the board and queue run no provider calls (UI pack §3.7).
"""

from __future__ import annotations


class WorkflowError(Exception):
    """Base class for board/queue domain errors."""

    status_code = 422
    kind = "WORKFLOW_ERROR"


class InvalidTransition(WorkflowError):
    """A status move the pipeline disallows."""

    status_code = 422
    kind = "INVALID_TRANSITION"


class InvalidScheduleTime(WorkflowError):
    """A reminder time in the past (or otherwise unschedulable)."""

    status_code = 422
    kind = "INVALID_SCHEDULE_TIME"
