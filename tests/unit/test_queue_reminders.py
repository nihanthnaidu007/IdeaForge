"""Draft queue + reminder dispatcher tests (spec criterion 4).

Covers: future-time validation (typed error), scheduling/unscheduling/
snoozing, the fake clock firing a reminder exactly at due time, the overdue
boot sweep, claim-based no-double-fire, notification read state, usage
events, and SMTP URL parsing (pure). Email sending is exercised with an
injected sender — no test touches a real SMTP server.
"""

from __future__ import annotations

import asyncio
from datetime import UTC, datetime, timedelta
from types import SimpleNamespace

import pytest
from app.services.reminders import ReminderWorker, parse_smtp_url

# --- helpers -----------------------------------------------------------------


async def seed_idea(client, headers, *, title="Scheduled draft") -> str:
    response = await client.post(
        "/api/save-idea",
        json={"topic_title": title, "rating": 7.5, "rating_explanation": "Timely."},
        headers=headers,
    )
    assert response.status_code == 200, response.text
    return response.json()["id"]


def fixed_clock(start: datetime):
    state = {"now": start}

    def now() -> datetime:
        return state["now"]

    def advance(**kwargs) -> None:
        state["now"] = state["now"] + timedelta(**kwargs)

    return now, advance


# --- scheduling routes ---------------------------------------------------------


@pytest.mark.asyncio
async def test_schedule_sets_time_and_appears_in_queue(client, auth_headers):
    idea_id = await seed_idea(client, auth_headers)
    due = datetime.now(UTC) + timedelta(hours=1)
    response = await client.post(
        f"/api/queue/{idea_id}/schedule",
        json={"scheduled_for": due.isoformat()},
        headers=auth_headers,
    )
    assert response.status_code == 200, response.text
    assert response.json()["reminder_fired_at"] is None

    queue = await client.get("/api/queue", headers=auth_headers)
    assert queue.json()["email_enabled"] is False
    assert [i["id"] for i in queue.json()["items"]] == [idea_id]


@pytest.mark.asyncio
async def test_schedule_rejects_past_time_with_typed_error(client, auth_headers):
    idea_id = await seed_idea(client, auth_headers)
    response = await client.post(
        f"/api/queue/{idea_id}/schedule",
        json={"scheduled_for": (datetime.now(UTC) - timedelta(minutes=5)).isoformat()},
        headers=auth_headers,
    )
    assert response.status_code == 422
    assert response.json()["kind"] == "INVALID_SCHEDULE_TIME"


@pytest.mark.asyncio
async def test_schedule_treats_naive_time_as_utc(client, auth_headers):
    idea_id = await seed_idea(client, auth_headers)
    naive_due = (datetime.now(UTC) + timedelta(hours=2)).replace(tzinfo=None).isoformat()
    response = await client.post(
        f"/api/queue/{idea_id}/schedule",
        json={"scheduled_for": naive_due},
        headers=auth_headers,
    )
    assert response.status_code == 200, response.text


@pytest.mark.asyncio
async def test_schedule_unknown_idea_is_404(client, auth_headers):
    response = await client.post(
        "/api/queue/nope/schedule",
        json={"scheduled_for": (datetime.now(UTC) + timedelta(hours=1)).isoformat()},
        headers=auth_headers,
    )
    assert response.status_code == 404


@pytest.mark.asyncio
async def test_unschedule_clears_queue_entry(client, auth_headers):
    idea_id = await seed_idea(client, auth_headers)
    due = datetime.now(UTC) + timedelta(hours=1)
    await client.post(
        f"/api/queue/{idea_id}/schedule",
        json={"scheduled_for": due.isoformat()},
        headers=auth_headers,
    )
    response = await client.delete(f"/api/queue/{idea_id}/schedule", headers=auth_headers)
    assert response.status_code == 200
    assert response.json()["scheduled_for"] is None

    queue = await client.get("/api/queue", headers=auth_headers)
    assert queue.json()["items"] == []


@pytest.mark.asyncio
async def test_snooze_reschedules_and_rearms(client, auth_headers, fake_db):
    idea_id = await seed_idea(client, auth_headers)
    now, advance = fixed_clock(datetime.now(UTC))
    due = now() + timedelta(minutes=30)
    await client.post(
        f"/api/queue/{idea_id}/schedule", json={"scheduled_for": due.isoformat()}, headers=auth_headers
    )
    worker = ReminderWorker(fake_db, None, now_fn=now)
    advance(minutes=31)
    assert await worker.scan_once() == 1  # fired

    response = await client.post(
        f"/api/queue/{idea_id}/snooze", json={"hours": 2}, headers=auth_headers
    )
    assert response.status_code == 200, response.text
    assert response.json()["reminder_fired_at"] is None
    assert response.json()["scheduled_for"] is not None


# --- reminder worker ------------------------------------------------------------


@pytest.mark.asyncio
async def test_worker_fires_at_due_time_under_fake_clock(client, auth_headers, fake_db):
    idea_id = await seed_idea(client, auth_headers)
    now, advance = fixed_clock(datetime.now(UTC))
    due = now() + timedelta(minutes=30)
    await client.post(
        f"/api/queue/{idea_id}/schedule",
        json={"scheduled_for": due.isoformat()},
        headers=auth_headers,
    )

    worker = ReminderWorker(fake_db, None, now_fn=now)
    assert await worker.scan_once() == 0  # not due yet — nothing invented
    assert list(fake_db.notifications.docs.values()) == []

    advance(minutes=31)
    assert await worker.scan_once() == 1
    notifications = list(fake_db.notifications.docs.values())
    assert len(notifications) == 1
    assert notifications[0]["idea_id"] == idea_id
    assert notifications[0]["channel"] == "in_app"
    assert notifications[0]["read"] is False

    doc = await fake_db.saved_ideas.find_one({"id": idea_id})
    assert doc["reminder_fired_at"] is not None

    events = [e["event"] for e in fake_db.usage_events.docs.values()]
    assert events[-1] == "reminder_fired"


@pytest.mark.asyncio
async def test_worker_never_double_fires(client, auth_headers, fake_db):
    idea_id = await seed_idea(client, auth_headers)
    now, advance = fixed_clock(datetime.now(UTC))
    due = now() + timedelta(minutes=30)
    await client.post(
        f"/api/queue/{idea_id}/schedule", json={"scheduled_for": due.isoformat()}, headers=auth_headers
    )
    worker = ReminderWorker(fake_db, None, now_fn=now)
    advance(minutes=31)
    assert await worker.scan_once() == 1
    assert await worker.scan_once() == 0  # claim holds — no duplicate
    assert len(list(fake_db.notifications.docs.values())) == 1


@pytest.mark.asyncio
async def test_overdue_reminder_fires_on_boot_sweep(client, auth_headers, fake_db):
    """A reminder that came due while the process was down fires on boot."""
    idea_id = await seed_idea(client, auth_headers)
    now, advance = fixed_clock(datetime.now(UTC))
    due = now() + timedelta(hours=12)
    await client.post(
        f"/api/queue/{idea_id}/schedule", json={"scheduled_for": due.isoformat()}, headers=auth_headers
    )
    # Downtime passes, then the worker boots with its clock past the due time.
    advance(days=1)
    worker = ReminderWorker(fake_db, None, now_fn=now)
    worker.start()
    await asyncio.sleep(0.05)  # let the boot sweep run
    await worker.stop()

    notifications = list(fake_db.notifications.docs.values())
    assert len(notifications) == 1
    assert notifications[0]["idea_id"] == idea_id


@pytest.mark.asyncio
async def test_worker_loop_scans_until_stopped(fake_db):
    worker = ReminderWorker(fake_db, None, interval_seconds=0.01)
    worker.start()
    await asyncio.sleep(0.05)
    await worker.stop()
    assert worker._task is None or worker._task.done()


@pytest.mark.asyncio
async def test_email_copy_sent_when_smtp_configured(client, auth_headers, fake_db):
    idea_id = await seed_idea(client, auth_headers)
    now, advance = fixed_clock(datetime.now(UTC))
    due = now() + timedelta(minutes=30)
    await client.post(
        f"/api/queue/{idea_id}/schedule", json={"scheduled_for": due.isoformat()}, headers=auth_headers
    )
    user = await fake_db.users.find_one({}, {"_id": 0, "email": 1})
    sent: list[tuple[str, str, str, str]] = []

    def fake_sender(smtp_url, to_addr, subject, body):
        sent.append((smtp_url, to_addr, subject, body))

    settings = SimpleNamespace(smtp_url="smtp://mailer:pw@smtp.example.com:587")
    worker = ReminderWorker(fake_db, settings, now_fn=now, email_sender=fake_sender)
    advance(minutes=31)
    assert await worker.scan_once() == 1

    assert len(sent) == 1
    assert sent[0][1] == user["email"]

    channels = {n["channel"] for n in fake_db.notifications.docs.values()}
    assert channels == {"in_app", "email"}


# --- notifications API ----------------------------------------------------------


@pytest.mark.asyncio
async def test_notification_read_state_roundtrip(client, auth_headers, fake_db):
    idea_id = await seed_idea(client, auth_headers)
    now, advance = fixed_clock(datetime.now(UTC))
    due = now() + timedelta(minutes=30)
    await client.post(
        f"/api/queue/{idea_id}/schedule", json={"scheduled_for": due.isoformat()}, headers=auth_headers
    )
    worker = ReminderWorker(fake_db, None, now_fn=now)
    advance(minutes=31)
    await worker.scan_once()

    listing = await client.get("/api/queue/notifications", headers=auth_headers)
    assert listing.status_code == 200
    assert len(listing.json()) == 1
    assert listing.json()[0]["read"] is False

    notification_id = listing.json()[0]["id"]
    marked = await client.post(
        f"/api/queue/notifications/{notification_id}/read", headers=auth_headers
    )
    assert marked.status_code == 200
    assert marked.json()["read"] is True

    missing = await client.post(
        "/api/queue/notifications/nope/read", headers=auth_headers
    )
    assert missing.status_code == 404


@pytest.mark.asyncio
async def test_queue_requires_auth(client):
    response = await client.get("/api/queue")
    assert response.status_code in (401, 403)


# --- SMTP URL parsing (pure) ------------------------------------------------------


def test_parse_smtp_url_variants():
    cfg = parse_smtp_url("smtp://user:p%40ss@smtp.example.com:587")
    assert cfg["host"] == "smtp.example.com"
    assert cfg["port"] == 587
    assert cfg["username"] == "user"
    assert cfg["password"] == "p@ss"
    assert cfg["use_tls"] is False

    tls = parse_smtp_url("smtps://smtp.example.com")
    assert tls["port"] == 465
    assert tls["use_tls"] is True
    assert tls["username"] is None

    with pytest.raises(ValueError):
        parse_smtp_url("https://nope.example.com")
