"""In-process asyncio reminder dispatcher (spec §Deploy — reminder delivery).

Design constraints, per spec and the locked compliance ceiling:
- No external scheduler in v1. A cron that posts to LinkedIn is the ToS line
  we don't cross; the queue schedules REMINDERS — in-app notifications by
  default, SMTP_URL optionally adds an email copy. Nothing here ever posts.
- Overdue sweep on boot: the first scan fires every overdue reminder, so
  nothing is lost while the process was down (spec acceptance bar).
- Honest delivery: each reminder is claimed by setting ``reminder_fired_at``
  in one conditional update BEFORE dispatch — a restart, a re-run, or a second
  worker can never double-fire the same reminder.

Testability seams: ``now_fn`` injects the clock (fake clock in tests),
``scan_once`` is the tick a test can call directly, and the email sender is
injectable so no test ever touches a real SMTP server.
"""

from __future__ import annotations

import asyncio
import logging
import smtplib
from collections.abc import Callable
from contextlib import suppress
from datetime import UTC, datetime
from email.message import EmailMessage
from typing import Any
from urllib.parse import unquote, urlparse
from uuid import uuid4

from app.services.usage import REMINDER_FIRED, record_usage_event

logger = logging.getLogger(__name__)

DEFAULT_SCAN_INTERVAL_SECONDS = 60.0


def parse_smtp_url(smtp_url: str) -> dict[str, Any]:
    """Parse an SMTP connection URL into connection parameters (pure).

    Supported: ``smtp://user:pass@host:port`` (STARTTLS) and
    ``smtps://user:pass@host:port`` (implicit TLS). Percent-encoded
    credentials are decoded.
    """
    parsed = urlparse(smtp_url)
    if parsed.scheme not in ("smtp", "smtps"):
        raise ValueError(
            f"Unsupported smtp_url scheme {parsed.scheme or '(none)'} — "
            "expected smtp:// or smtps://"
        )
    if not parsed.hostname:
        raise ValueError("smtp_url has no host — expected smtp://host:port")
    return {
        "host": parsed.hostname,
        "port": parsed.port or (465 if parsed.scheme == "smtps" else 587),
        "username": unquote(parsed.username) if parsed.username else None,
        "password": unquote(parsed.password) if parsed.password else None,
        "use_tls": parsed.scheme == "smtps",
    }


def send_reminder_email(smtp_url: str, to_addr: str, subject: str, body: str) -> None:
    """Synchronous SMTP send — the worker runs it via ``asyncio.to_thread``."""
    cfg = parse_smtp_url(smtp_url)
    client: smtplib.SMTP
    if cfg["use_tls"]:
        client = smtplib.SMTP_SSL(cfg["host"], cfg["port"], timeout=15)
    else:
        client = smtplib.SMTP(cfg["host"], cfg["port"], timeout=15)
    with client:
        if not cfg["use_tls"]:
            client.starttls()
        if cfg["username"] and cfg["password"]:
            client.login(cfg["username"], cfg["password"])
        msg = EmailMessage()
        msg["From"] = cfg["username"] or "ideaforge@localhost"
        msg["To"] = to_addr
        msg["Subject"] = subject
        msg.set_content(body)
        client.send_message(msg)


def _parse_iso(value: str) -> datetime | None:
    try:
        parsed = datetime.fromisoformat(value)
    except (TypeError, ValueError):
        return None
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=UTC)  # stored-naive timestamps are UTC
    return parsed


class ReminderWorker:
    """Scans the draft queue on an interval and fires due reminders."""

    def __init__(
        self,
        db: Any,
        settings: Any | None = None,
        *,
        interval_seconds: float = DEFAULT_SCAN_INTERVAL_SECONDS,
        now_fn: Callable[[], datetime] | None = None,
        email_sender: Callable[[str, str, str, str], None] | None = None,
    ) -> None:
        self._db = db
        self._settings = settings
        self._interval = interval_seconds
        self._now_fn = now_fn or (lambda: datetime.now(UTC))
        self._email_sender = email_sender or send_reminder_email
        self._task: asyncio.Task[None] | None = None

    def start(self) -> None:
        if self._task is None or self._task.done():
            self._task = asyncio.get_running_loop().create_task(self._run())

    async def stop(self) -> None:
        task, self._task = self._task, None
        if task is None:
            return
        task.cancel()
        with suppress(asyncio.CancelledError):
            await task

    async def _run(self) -> None:
        # Boot sweep first — fire everything that came due while the process
        # was down — then poll. A failed tick must not kill the dispatcher:
        # log it with the traceback and keep the loop alive.
        try:
            await self.scan_once()
        except Exception:
            logger.exception("reminder boot sweep failed")
        while True:
            await asyncio.sleep(self._interval)
            try:
                await self.scan_once()
            except Exception:
                logger.exception("reminder scan failed")

    async def scan_once(self) -> int:
        """Fire every due reminder once. Returns the count fired.

        The scan reads the collection and filters in Python: the repository
        fakes in the test tier implement equality-only matching, and a
        Python-side filter keeps the due computation identical in both tiers.
        Overdue items (scheduled_at <= now, unclaimed) fire immediately — the
        boot sweep is just the first scan.
        """
        now = self._now_fn()
        now_iso = now.isoformat()
        docs = await self._db.saved_ideas.find({}, {"_id": 0}).to_list(None)
        due: list[tuple[datetime, dict[str, Any]]] = []
        for doc in docs:
            scheduled = doc.get("scheduled_for")
            if not scheduled or doc.get("reminder_fired_at"):
                continue
            due_at = _parse_iso(scheduled)
            if due_at is not None and due_at <= now:
                due.append((due_at, doc))
        due.sort(key=lambda pair: pair[0])

        fired = 0
        for _, doc in due:
            claimed = await self._db.saved_ideas.find_one_and_update(
                {"id": doc["id"], "reminder_fired_at": None},
                {"$set": {"reminder_fired_at": now_iso}},
            )
            if claimed is None:
                continue  # lost the claim — already fired, never double-send
            await self._db.notifications.insert_one(
                {
                    "id": str(uuid4()),
                    "user_id": doc["user_id"],
                    "idea_id": doc["id"],
                    "idea_title": doc.get("topic_title", "Untitled idea"),
                    "channel": "in_app",
                    "fired_at": now_iso,
                    "read": False,
                }
            )
            if self._settings is not None and self._settings.smtp_url:
                await self._send_email_copy(doc, now_iso)
            await record_usage_event(self._db, doc["user_id"], REMINDER_FIRED)
            fired += 1
        return fired

    async def _send_email_copy(self, doc: dict[str, Any], now_iso: str) -> None:
        """Optional email copy of the reminder (secondary channel).

        An email failure is logged with full context and never blocks the
        in-app reminder that has already fired — SMTP is an enhancement, and
        the queue's honesty lives in the in-app notification.
        """
        try:
            user = await self._db.users.find_one(
                {"id": doc["user_id"]}, {"_id": 0, "email": 1}
            )
            if not user or not user.get("email"):
                logger.warning(
                    "reminder email skipped — user %s has no email on file",
                    doc["user_id"],
                )
                return
            title = doc.get("topic_title", "Untitled idea")
            await asyncio.to_thread(
                self._email_sender,
                self._settings.smtp_url,
                user["email"],
                f"IdeaForge reminder: {title} is due",
                "Your scheduled draft is due now. Open IdeaForge to preview it, "
                "copy it, and post it yourself.",
            )
            await self._db.notifications.insert_one(
                {
                    "id": str(uuid4()),
                    "user_id": doc["user_id"],
                    "idea_id": doc["id"],
                    "idea_title": title,
                    "channel": "email",
                    "fired_at": now_iso,
                    "read": True,  # the delivery is its own receipt
                }
            )
        except Exception:
            logger.exception(
                "reminder email dispatch failed for user %s (idea %s)",
                doc["user_id"],
                doc["id"],
            )
