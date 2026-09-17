"""Pure aggregation for honest analytics.

Everything here is a function over event documents — no I/O — so the math
(streaks, timelines, period comparison) is directly unit-testable and the
router stays a thin fetch-and-project layer.

Honesty invariants the shapes enforce:
- Counts are real zeros when nothing happened; there is no synthetic fill.
- Days are bucketed in the *user's* local time (``tz_offset`` follows the JS
  ``getTimezoneOffset()`` convention: minutes east of UTC, e.g. UTC+2 → -120),
  because "streak" and "this week" are claims about the user's days.
"""

from __future__ import annotations

from collections import Counter
from datetime import UTC, date, datetime, timedelta

# Aggregation window — one year of history is the honest-analytics horizon.
WINDOW_DAYS = 366
_TIMELINE_DAYS = 30
# JS getTimezoneOffset() convention, clamped to ±14h (widest real offsets).
_MAX_TZ_OFFSET = 840

_METRIC_FIELDS = ("impressions", "reactions", "comments", "reposts")


def _event_day(value: datetime, tz_offset: int) -> date:
    """UTC event timestamp → the user's local calendar day."""
    if value.tzinfo is not None:
        value = value.astimezone(UTC).replace(tzinfo=None)
    return (value - timedelta(minutes=tz_offset)).date()


def _clamp_offset(tz_offset: int) -> int:
    return max(-_MAX_TZ_OFFSET, min(_MAX_TZ_OFFSET, tz_offset))


def _consecutive_run(days: list[date], start: date) -> int:
    run = 0
    day = start
    active = set(days)
    while day in active:
        run += 1
        day -= timedelta(days=1)
    return run


def compute_streaks(event_days: list[date], today: date) -> dict[str, int]:
    """Current streak (consecutive active local days), longest run, 30-day activity."""
    unique_days = sorted(set(event_days))
    if not unique_days:
        return {"current": 0, "longest": 0, "active_days_30": 0}

    # Today not yet active ≠ streak broken — count from yesterday.
    anchor = today if today in set(unique_days) else today - timedelta(days=1)
    current = _consecutive_run(unique_days, anchor)

    longest = 1
    run = 1
    for prev, curr in zip(unique_days, unique_days[1:], strict=False):
        run = run + 1 if (curr - prev).days == 1 else 1
        longest = max(longest, run)

    window_start = today - timedelta(days=_TIMELINE_DAYS - 1)
    active_days_30 = sum(1 for day in unique_days if window_start <= day <= today)
    return {"current": current, "longest": longest, "active_days_30": active_days_30}


def _period_counts(
    events: list[dict[str, object]], tz_offset: int, start: date, end: date
) -> dict[str, object]:
    by_event: Counter[str] = Counter()
    total = 0
    for event in events:
        day = _event_day(event["at"], tz_offset)  # type: ignore[arg-type]
        if start <= day <= end:
            by_event[event["event"]] += 1  # type: ignore[index]
            total += 1
    return {"by_event": dict(by_event), "total": total}


def _week_periods(today: date) -> tuple[tuple[date, date], tuple[date, date]]:
    """This and last calendar week, Monday-start."""
    this_start = today - timedelta(days=today.weekday())
    last_start = this_start - timedelta(days=7)
    return (
        (this_start, today),
        (last_start, this_start - timedelta(days=1)),
    )


def _month_periods(today: date) -> tuple[tuple[date, date], tuple[date, date]]:
    """This and last calendar month."""
    this_start = today.replace(day=1)
    last_start = (this_start - timedelta(days=1)).replace(day=1)
    return (
        (this_start, today),
        (last_start, this_start - timedelta(days=1)),
    )


def aggregate_usage(
    events: list[dict[str, object]], now_utc: datetime, tz_offset: int = 0
) -> dict[str, object]:
    """Aggregate usage events into the analytics summary payload.

    ``events`` are user-scoped documents with at least ``event`` (str) and
    ``at`` (datetime, UTC or naive-UTC). All output zeros are real zeros.
    """
    offset = _clamp_offset(tz_offset)
    now = now_utc.astimezone(UTC).replace(tzinfo=None) if now_utc.tzinfo else now_utc
    today = _event_day(now, offset)

    by_event: Counter[str] = Counter(event["event"] for event in events)  # type: ignore[index]
    event_days = [_event_day(event["at"], offset) for event in events]  # type: ignore[arg-type]

    window_start = today - timedelta(days=_TIMELINE_DAYS - 1)
    timeline: list[dict[str, object]] = []
    timeline_days: list[tuple[date, dict[str, object]]] = [
        (window_start + timedelta(days=i), {"by_event": Counter(), "total": 0})
        for i in range(_TIMELINE_DAYS)
    ]
    for event, day in zip(events, event_days, strict=False):
        if window_start <= day <= today:
            index = (day - window_start).days
            bucket = timeline_days[index][1]
            bucket["by_event"][event["event"]] += 1  # type: ignore[index]
            bucket["total"] += 1  # type: ignore[index]
    for day, bucket in timeline_days:
        by_event_bucket = bucket["by_event"]
        assert isinstance(by_event_bucket, Counter)  # narrows for the serializer
        timeline.append(
            {
                "date": day.isoformat(),
                "total": bucket["total"],
                "by_event": dict(by_event_bucket),
            }
        )

    week = _week_periods(today)
    month = _month_periods(today)
    comparison = {
        "week": {
            "current": _period_counts(events, offset, *week[0]),
            "previous": _period_counts(events, offset, *week[1]),
        },
        "month": {
            "current": _period_counts(events, offset, *month[0]),
            "previous": _period_counts(events, offset, *month[1]),
        },
    }

    return {
        "streaks": compute_streaks(event_days, today),
        "counts": {"by_event": dict(by_event), "total": len(events)},
        "timeline": timeline,
        "comparison": comparison,
        "total_events": len(events),
    }


def _empty_metrics() -> dict[str, int]:
    return {field: 0 for field in _METRIC_FIELDS} | {"count": 0}


def aggregate_manual_metrics(
    entries: list[dict[str, object]], today: date
) -> dict[str, object]:
    """Sum user-entered post metrics over the same calendar periods as usage.

    ``entries`` carry ``posted_on`` ("YYYY-MM-DD" string or date) plus the
    _METRIC_FIELDS counters — numbers the user pasted from their own LinkedIn
    dashboard, never scraped.
    """
    week = _week_periods(today)
    month = _month_periods(today)

    def period_sums(start: date, end: date) -> dict[str, int]:
        sums = _empty_metrics()
        for entry in entries:
            posted = entry["posted_on"]
            day = (
                posted
                if isinstance(posted, date)
                else date.fromisoformat(str(posted))
            )
            if not (start <= day <= end):
                continue
            sums["count"] += 1
            for field in _METRIC_FIELDS:
                value = entry.get(field, 0)
                sums[field] += value if isinstance(value, int) else 0
        return sums

    return {
        "week": {
            "current": period_sums(*week[0]),
            "previous": period_sums(*week[1]),
        },
        "month": {
            "current": period_sums(*month[0]),
            "previous": period_sums(*month[1]),
        },
    }
