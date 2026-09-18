"""Export serializers — Markdown, CSV, and ICS (spec §Draft Queue & Export).

Pure functions only: routers own the response headers, these own the bytes.
Parseability is an acceptance criterion (spec verification #4), so CSV uses
the csv module with QUOTE_ALL and ICS follows RFC 5545 escaping and folding.
"""

from __future__ import annotations

import csv
import io
from datetime import UTC, datetime
from typing import Any


def _idea_rows(ideas: list[dict[str, Any]]) -> tuple[list[str], list[list[str]]]:
    """Stable column order shared by the CSV and Markdown writers."""
    headers = [
        "id",
        "topic_title",
        "rating",
        "status",
        "tags",
        "scheduled_for",
        "niche",
        "tone",
        "created_at",
        "rating_explanation",
        "targeted_audience",
        "why_it_matters",
        "key_aspects",
        "post_format",
        "generated_post",
    ]
    rows = []
    for idea in ideas:
        rows.append(
            [
                idea.get("id", ""),
                idea.get("topic_title", ""),
                str(idea.get("rating", "")),
                idea.get("status", "inbox"),
                "|".join(idea.get("tags") or []),
                idea.get("scheduled_for") or "",
                idea.get("niche", ""),
                idea.get("tone", ""),
                idea.get("created_at", ""),
                idea.get("rating_explanation", ""),
                idea.get("targeted_audience") or "",
                idea.get("why_it_matters") or "",
                "|".join(idea.get("key_aspects") or []),
                idea.get("post_format") or "",
                idea.get("generated_post") or "",
            ]
        )
    return headers, rows


def ideas_to_csv(ideas: list[dict[str, Any]]) -> str:
    """CSV of ideas and their drafts. QUOTE_ALL + CRLF per the house format."""
    headers, rows = _idea_rows(ideas)
    buffer = io.StringIO()
    writer = csv.writer(buffer, quoting=csv.QUOTE_ALL, lineterminator="\r\n")
    writer.writerow(headers)
    writer.writerows(rows)
    return buffer.getvalue()


def ideas_to_markdown(ideas: list[dict[str, Any]]) -> str:
    """Human-readable Markdown of the board; drafts render verbatim.

    Draft bodies use a 4-space indent block instead of fencing so a draft
    containing backticks can never break its own container.
    """
    lines: list[str] = ["# IdeaForge board export", ""]
    for idea in ideas:
        lines.append(f"## {idea.get('topic_title', 'Untitled')}")
        tags = idea.get("tags") or []
        scheduled = idea.get("scheduled_for")
        meta = [
            f"Status: {idea.get('status', 'inbox')}",
            f"Rating: {idea.get('rating', '-')}/10",
            f"Tags: {', '.join(tags) if tags else 'none'}",
            f"Scheduled: {scheduled or 'not scheduled'}",
            f"Created: {idea.get('created_at', '')}",
        ]
        lines.append(f"*{' · '.join(meta)}*")
        lines.append("")
        if idea.get("rating_explanation"):
            lines.append(f"{idea['rating_explanation']}")
            lines.append("")
        if idea.get("why_it_matters"):
            lines.append(f"**Why it matters:** {idea['why_it_matters']}")
            lines.append("")
        key_aspects = idea.get("key_aspects") or []
        if key_aspects:
            lines.append("**Key aspects:**")
            lines.extend(f"- {aspect}" for aspect in key_aspects)
            lines.append("")
        if idea.get("generated_post"):
            lines.append("**Draft:**")
            lines.extend(
                f"    {line}" for line in idea["generated_post"].splitlines() or ["    "]
            )
            lines.append("")
    return "\n".join(lines).rstrip() + "\n"


# --- ICS ----------------------------------------------------------------------


def _ics_escape(value: str) -> str:
    """RFC 5545 §3.3.11 TEXT escaping: backslash, semicolon, comma, newline."""
    return (
        value.replace("\\", "\\\\")
        .replace(";", "\\;")
        .replace(",", "\\,")
        .replace("\r\n", "\\n")
        .replace("\n", "\\n")
    )


def _ics_fold(line: str) -> list[str]:
    """RFC 5545 §3.1: content lines SHOULD be <= 75 octets, folded with CRLF
    + a single leading space on continuations."""
    encoded = line.encode("utf-8")
    if len(encoded) <= 75:
        return [line]
    chunks: list[str] = []
    current = bytearray()
    limit = 75
    for char in line:
        char_bytes = char.encode("utf-8")
        if len(current) + len(char_bytes) > limit:
            chunks.append(current.decode("utf-8"))
            current = bytearray()
            limit = 74  # continuation lines start with one space
        current.extend(char_bytes)
    if current:
        chunks.append(current.decode("utf-8"))
    return [chunks[0]] + [f" {chunk}" for chunk in chunks[1:]]


def _ics_datetime(iso_value: str) -> str:
    """ISO-8601 (naive treated as UTC) -> RFC 5545 UTC form 20260917T120000Z."""
    value = iso_value.strip()
    if value.endswith("Z"):
        value = value[:-1] + "+00:00"
    dt = datetime.fromisoformat(value)
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=UTC)
    return dt.astimezone(UTC).strftime("%Y%m%dT%H%M%SZ")


def scheduled_to_ics(ideas: list[dict[str, Any]]) -> str:
    """VCALENDAR with one VEVENT per scheduled reminder (never a posting job)."""
    stamp = datetime.now(UTC).strftime("%Y%m%dT%H%M%SZ")
    lines = [
        "BEGIN:VCALENDAR",
        "VERSION:2.0",
        "PRODID:-//IdeaForge//Draft Queue Reminders//EN",
        "CALSCALE:GREGORIAN",
        "METHOD:PUBLISH",
    ]
    for idea in ideas:
        scheduled = idea.get("scheduled_for")
        if not scheduled:
            continue
        summary = f"Reminder: {idea.get('topic_title', 'Draft')} is due"
        lines.extend(
            [
                "BEGIN:VEVENT",
                f"UID:{idea.get('id', 'unknown')}@ideaforge",
                f"DTSTAMP:{stamp}",
                f"DTSTART:{_ics_datetime(scheduled)}",
                f"SUMMARY:{_ics_escape(summary)}",
                f"DESCRIPTION:{_ics_escape(idea.get('generated_post') or idea.get('rating_explanation') or '')}",
                "BEGIN:VALARM",
                "ACTION:DISPLAY",
                f"DESCRIPTION:{_ics_escape(idea.get('topic_title', 'Draft reminder'))}",
                "TRIGGER:-PT0M",
                "END:VALARM",
                "END:VEVENT",
            ]
        )
    lines.append("END:VCALENDAR")

    folded: list[str] = []
    for line in lines:
        folded.extend(_ics_fold(line))
    return "\r\n".join(folded) + "\r\n"
