"""LinkedIn-accurate preview linter (spec §Draft Queue & Export; UI pack §6.1).

Pure functions: the router binds them to settings and HTTP. The five checks
and their severities follow the UI & Copy Craft Pack (art_qZtHOeYC §6.1);
the strings here are the pack's shipped messages — copy for the frontend to
render, with severities the UI maps to colors (error=red, warn=amber, info=zinc).
"""

from __future__ import annotations

import re
from typing import Any, Literal

CheckSeverity = Literal["info", "warn", "error"]

# Mathematical Alphanumeric Symbols + Letterlike Symbols: the styled-letter
# blocks people paste as "fake bold/italic". (UI pack §6.1 check 2.)
_FAKE_FORMAT_BLOCKS: tuple[tuple[int, int], ...] = (
    (0x1D400, 0x1D7FF),
    (0x2100, 0x214F),
)

_MARKDOWN_PATTERNS: tuple[tuple[str, re.Pattern[str]], ...] = (
    ("** bold", re.compile(r"\*\*")),
    ("__ underline/bold", re.compile(r"__")),
    ("### heading", re.compile(r"#{1,6}\s*\S")),
    ("* bullet", re.compile(r"(?m)^\s*\*\s+\S")),
    ("- bullet", re.compile(r"(?m)^\s*-\s+\S")),
)

_HASHTAG_PATTERN = re.compile(r"#\w+")


def _markdown_remnants(text: str) -> list[str]:
    found: list[str] = []
    for label, pattern in _MARKDOWN_PATTERNS:
        if pattern.search(text):
            found.append(label)
    return found


def _fake_format_chars(text: str) -> int:
    return sum(
        1
        for char in text
        if any(start <= ord(char) <= end for start, end in _FAKE_FORMAT_BLOCKS)
    )


def _first_two_lines(text: str) -> str:
    lines = [line for line in text.splitlines()]
    return "\n".join(lines[:2])


def lint_for_linkedin(text: str, char_limit: int) -> dict[str, Any]:
    """Run the UI pack §6.1's five checks. Severity levels follow the pack:
    markdown remnants error; fake-bold warn; count info/warn/error; gaps warn;
    hashtags info>3, warn>10."""
    checks: list[dict[str, Any]] = []

    # Check 1 — markdown remnants (error): LinkedIn renders the marks literally.
    remnants = _markdown_remnants(text)
    if remnants:
        checks.append(
            {
                "id": "markdown_remnants",
                "severity": "error",
                "message": "LinkedIn shows these markdown marks literally: "
                + ", ".join(remnants[:3])
                + ". Edit them out or the symbols publish with your post.",
            }
        )

    # Check 2 — unicode pseudo-formatting (warn): renders inconsistently and
    # screen readers announce the letters wrong.
    fake_chars = _fake_format_chars(text)
    if fake_chars:
        checks.append(
            {
                "id": "unicode_fake_formatting",
                "severity": "warn",
                "message": "This post uses unicode fake-bold. It may render "
                "inconsistently across LinkedIn's apps — and screen readers "
                "announce the letters wrong. Plain text with a strong first "
                "line formats better.",
            }
        )

    # Check 3 — character count vs the feed limit (info/warn/error). The limit
    # is a config constant because feed policy drifts (UI pack §9.2 #1).
    count = len(text)
    if count > char_limit:
        checks.append(
            {
                "id": "char_limit",
                "severity": "error",
                "message": f"Over the LinkedIn limit by {count - char_limit} "
                "characters — trim or split into a carousel.",
            }
        )
    elif count >= int(char_limit * 0.9):
        checks.append(
            {
                "id": "char_limit",
                "severity": "warn",
                "message": f"{count} / {char_limit} characters — you're close "
                "to the feed limit.",
            }
        )
    else:
        checks.append(
            {
                "id": "char_limit",
                "severity": "info",
                "message": f"{count} / {char_limit} characters",
            }
        )

    # Check 4 — whitespace structure (warn): LinkedIn collapses long gaps.
    if re.search(r"\n{3,}", text):
        checks.append(
            {
                "id": "whitespace_structure",
                "severity": "warn",
                "message": "LinkedIn collapses long gaps — 3+ blank lines will "
                "render as fewer. Keep single blank lines between thoughts.",
            }
        )

    # Check 5 — hashtag restraint (info above 3, warn above 10).
    hashtags = _HASHTAG_PATTERN.findall(text)
    if len(hashtags) > 10:
        checks.append(
            {
                "id": "hashtag_restraint",
                "severity": "warn",
                "message": f"First 3 hashtags earn their keep; {len(hashtags)} "
                "reads as spam to the feed.",
            }
        )
    elif len(hashtags) > 3:
        checks.append(
            {
                "id": "hashtag_restraint",
                "severity": "info",
                "message": f"First 3 hashtags earn their keep; {len(hashtags)} "
                "reads as spam to the feed.",
            }
        )

    clean = not any(check["severity"] in ("error", "warn") for check in checks)
    return {
        "char_count": count,
        "char_limit": char_limit,
        "clean": clean,
        "checks": checks,
        "first_two_lines": _first_two_lines(text),
    }
