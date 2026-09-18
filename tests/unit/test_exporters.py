"""Exporter + LinkedIn-preview tests (spec criterion 4).

Acceptance bar: "Export: MD/CSV/ICS parse cleanly; preview surfaces
unicode/char-limit checks." CSV parses with the csv module, ICS is asserted
on RFC 5545 structure and escaping, Markdown round-trips its sections, and
the preview linter's five checks are exercised at their boundaries.
"""

from __future__ import annotations

import csv
import io
from datetime import UTC, datetime, timedelta

import pytest
from app.services.exporter import ideas_to_csv, ideas_to_markdown, scheduled_to_ics
from app.services.linkedin_preview import lint_for_linkedin

# --- fixtures ---------------------------------------------------------------


def sample_idea(**overrides) -> dict:
    base = {
        "id": "idea_1",
        "user_id": "user_1",
        "topic_title": "Agents eat SaaS",
        "rating": 8.5,
        "rating_explanation": "Fresh signal, strong argument angle.",
        "status": "drafting",
        "tags": ["agents", "saas"],
        "scheduled_for": "2026-09-18T09:00:00+00:00",
        "reminder_fired_at": None,
        "niche": "AI",
        "tone": "professional",
        "created_at": "2026-09-17T08:00:00+00:00",
        "is_bookmarked": False,
        "targeted_audience": "engineering leaders",
        "why_it_matters": "Budgets move from seats to outcomes.",
        "key_aspects": ["pricing pressure", "agent platforms"],
        "post_format": "hot-take",
        "generated_post": "Line one, the hook.\n\nLine two carries the argument.",
    }
    base.update(overrides)
    return base


# --- CSV ----------------------------------------------------------------------


def test_csv_parses_cleanly_and_round_trips():
    content = ideas_to_csv(
        [
            sample_idea(),
            sample_idea(id="idea_2", tags=["x,y"], generated_post='Quoted "text", with comma'),
        ]
    )
    rows = list(csv.reader(io.StringIO(content)))
    assert rows[0][0] == "id"
    assert rows[0][1] == "topic_title"
    assert len(rows) == 3  # header + 2 ideas
    assert rows[1][0] == "idea_1"
    assert rows[1][3] == "drafting"
    assert rows[1][4] == "agents|saas"  # tags pipe-joined, not CSV-embedded lists
    assert rows[2][14] == 'Quoted "text", with comma'  # csv module handled quoting
    assert content.endswith("\r\n") and "\r\n" in content  # house CRLF format


def test_csv_omits_optional_fields_cleanly():
    idea = sample_idea()
    idea.update(
        {
            "targeted_audience": None,
            "why_it_matters": None,
            "key_aspects": None,
            "generated_post": None,
            "scheduled_for": None,
            "post_format": None,
        }
    )
    rows = list(csv.reader(io.StringIO(ideas_to_csv([idea]))))
    assert all(cell == "" for cell in rows[1][5:6] + rows[1][10:15])


# --- Markdown -----------------------------------------------------------------


def test_markdown_includes_board_metadata_and_draft():
    content = ideas_to_markdown([sample_idea()])
    assert content.startswith("# IdeaForge board export")
    assert "## Agents eat SaaS" in content
    assert "Status: drafting" in content
    assert "Tags: agents, saas" in content
    assert "Scheduled: 2026-09-18T09:00:00+00:00" in content
    assert "**Why it matters:** Budgets move from seats to outcomes." in content
    assert "- pricing pressure" in content
    assert "**Draft:**" in content
    assert "    Line one, the hook." in content  # 4-space indent, draft verbatim


def test_markdown_draft_with_backticks_cannot_break_its_container():
    draft = "```\nfenced block inside a draft\n```"
    content = ideas_to_markdown([sample_idea(generated_post=draft)])
    draft_block = content.split("**Draft:**")[1]
    assert "    ```" in draft_block  # indented verbatim, fence intact
    assert "## " not in draft_block  # nothing leaks out of the block


def test_markdown_empty_board():
    assert ideas_to_markdown([]).startswith("# IdeaForge board export")


# --- ICS ------------------------------------------------------------------------


def test_ics_structure_and_utc_datetimes():
    content = scheduled_to_ics([sample_idea()])
    lines = content.split("\r\n")
    assert lines[0] == "BEGIN:VCALENDAR"
    assert lines[-2] == "END:VCALENDAR"  # final CRLF leaves trailing empty part
    assert "BEGIN:VEVENT" in lines and "END:VEVENT" in lines
    dtstart = next(line for line in lines if line.startswith("DTSTART:"))
    assert dtstart == "DTSTART:20260918T090000Z"  # RFC 5545 UTC form
    assert any(line.startswith("UID:idea_1@ideaforge") for line in lines)
    assert any(line == "BEGIN:VALARM" for line in lines)


def test_ics_escapes_text_specials():
    idea = sample_idea(
        topic_title="Agents; eat, SaaS",
        generated_post="line one\nline two, with; specials",
    )
    content = scheduled_to_ics([idea])
    summary = next(line for line in content.split("\r\n") if line.startswith("SUMMARY:"))
    assert "Agents\\; eat\\, SaaS" in summary
    description = next(line for line in content.split("\r\n") if line.startswith("DESCRIPTION:"))
    assert "line one\\nline two\\, with\\; specials" in description


def test_ics_folds_long_lines_to_75_octets():
    idea = sample_idea(topic_title="Long " * 60, generated_post=None, rating_explanation="x" * 400)
    content = scheduled_to_ics([idea])
    for line in content.split("\r\n"):
        assert len(line.encode("utf-8")) <= 75 or line.startswith(" ")  # continuations


def test_ics_skips_unscheduled_ideas():
    content = scheduled_to_ics([sample_idea(scheduled_for=None), sample_idea(id="idea_2")])
    assert content.count("BEGIN:VEVENT") == 1
    assert "idea_2@ideaforge" in content


def test_ics_empty_schedule_is_valid_calendar():
    content = scheduled_to_ics([sample_idea(scheduled_for=None)])
    assert content.startswith("BEGIN:VCALENDAR")
    assert "BEGIN:VEVENT" not in content


# --- LinkedIn preview linter ------------------------------------------------------


def test_preview_clean_post():
    result = lint_for_linkedin("Strong first line.\n\nThe argument, in plain text.", 3000)
    assert result["clean"] is True
    assert result["char_count"] == len("Strong first line.\n\nThe argument, in plain text.")
    assert all(c["severity"] != "error" for c in result["checks"])
    assert result["first_two_lines"].startswith("Strong first line.")


def test_preview_flags_markdown_remnants_as_error():
    result = lint_for_linkedin("This is **bold** and a\n\n### Heading\n\n- bullet", 3000)
    check = next(c for c in result["checks"] if c["id"] == "markdown_remnants")
    assert check["severity"] == "error"
    assert "** bold" in check["message"]


def test_preview_flags_unicode_fake_bold_as_warn():
    fake_bold = "𝗧𝗵𝗶𝘀 𝗹𝗼𝗼𝗸𝘀 𝗯𝗼𝗹𝗱 but is fake formatting."
    result = lint_for_linkedin(fake_bold, 3000)
    check = next(c for c in result["checks"] if c["id"] == "unicode_fake_formatting")
    assert check["severity"] == "warn"
    assert result["clean"] is False


def test_preview_char_limit_severities():
    over = lint_for_linkedin("x" * 3001, 3000)
    near = lint_for_linkedin("x" * 2700, 3000)
    comfy = lint_for_linkedin("x" * 100, 3000)
    assert next(c for c in over["checks"] if c["id"] == "char_limit")["severity"] == "error"
    assert "by 1 characters" in next(c for c in over["checks"] if c["id"] == "char_limit")["message"]
    assert next(c for c in near["checks"] if c["id"] == "char_limit")["severity"] == "warn"
    assert next(c for c in comfy["checks"] if c["id"] == "char_limit")["severity"] == "info"
    assert "2700 / 3000" in next(c for c in near["checks"] if c["id"] == "char_limit")["message"]


def test_preview_flags_collapsing_whitespace():
    result = lint_for_linkedin("One.\n\n\n\n\nTwo.", 3000)
    check = next(c for c in result["checks"] if c["id"] == "whitespace_structure")
    assert check["severity"] == "warn"


def test_preview_hashtag_restraint_levels():
    few = lint_for_linkedin("#one #two #three", 3000)
    some = lint_for_linkedin("#one #two #three #four", 3000)
    many = lint_for_linkedin(" ".join(f"#tag{i}" for i in range(12)), 3000)
    assert not any(c["id"] == "hashtag_restraint" for c in few["checks"])
    assert next(c for c in some["checks"] if c["id"] == "hashtag_restraint")["severity"] == "info"
    assert next(c for c in many["checks"] if c["id"] == "hashtag_restraint")["severity"] == "warn"


# --- export routes (auth, headers, filters) ----------------------------------------


@pytest.mark.asyncio
async def test_export_csv_route_auth_headers_and_filter(client, auth_headers, fake_db):
    await client.post(
        "/api/save-idea",
        json={"topic_title": "Filtered out", "rating": 5, "rating_explanation": "nope"},
        headers=auth_headers,
    )
    # Move the idea into 'forged', add a tag, then filter by status.
    all_ideas = await client.get("/api/board", headers=auth_headers)
    idea_id = all_ideas.json()[0]["id"]
    await client.post(
        f"/api/board/{idea_id}/transition", json={"to": "forged"}, headers=auth_headers
    )
    await client.patch(
        f"/api/board/{idea_id}/tags", json={"tags": ["agents"]}, headers=auth_headers
    )

    response = await client.get("/api/export/ideas.csv", headers=auth_headers)
    assert response.status_code == 200
    assert response.headers["content-type"].startswith("text/csv")
    assert "attachment" in response.headers["content-disposition"]
    rows = list(csv.reader(io.StringIO(response.text)))
    assert len(rows) == 2

    filtered = await client.get(
        "/api/export/ideas.csv?status=inbox", headers=auth_headers
    )
    assert len(list(csv.reader(io.StringIO(filtered.text)))) == 1  # header only


@pytest.mark.asyncio
async def test_export_markdown_route(client, auth_headers):
    await client.post(
        "/api/save-idea",
        json={"topic_title": "MD export", "rating": 7, "rating_explanation": "why"},
        headers=auth_headers,
    )
    response = await client.get("/api/export/ideas.md", headers=auth_headers)
    assert response.status_code == 200
    assert response.headers["content-type"].startswith("text/markdown")
    assert "# IdeaForge board export" in response.text
    assert "## MD export" in response.text


@pytest.mark.asyncio
async def test_export_routes_record_posts_exported_with_count(client, auth_headers, fake_db):
    await client.post(
        "/api/save-idea",
        json={"topic_title": "Counted export", "rating": 7, "rating_explanation": "why"},
        headers=auth_headers,
    )
    for path in ("/api/export/ideas.md", "/api/export/ideas.csv"):
        assert (await client.get(path, headers=auth_headers)).status_code == 200

    events = [e for e in fake_db.usage_events.docs.values() if e["event"] == "posts_exported"]
    assert [e.get("count") for e in events] == [1, 1]


@pytest.mark.asyncio
async def test_export_ics_route_only_scheduled(client, auth_headers):
    await client.post(
        "/api/save-idea",
        json={"topic_title": "Scheduled", "rating": 8, "rating_explanation": "why"},
        headers=auth_headers,
    )
    all_ideas = await client.get("/api/board", headers=auth_headers)
    idea_id = all_ideas.json()[0]["id"]
    due = datetime.now(UTC) + timedelta(hours=1)
    await client.post(
        f"/api/queue/{idea_id}/schedule",
        json={"scheduled_for": due.isoformat()},
        headers=auth_headers,
    )
    response = await client.get("/api/export/reminders.ics", headers=auth_headers)
    assert response.status_code == 200
    assert response.headers["content-type"].startswith("text/calendar")
    assert response.text.startswith("BEGIN:VCALENDAR")
    assert response.text.count("BEGIN:VEVENT") == 1


@pytest.mark.asyncio
async def test_export_routes_require_auth(client):
    for path in ("/api/export/ideas.md", "/api/export/ideas.csv", "/api/export/reminders.ics"):
        assert (await client.get(path)).status_code in (401, 403)


@pytest.mark.asyncio
async def test_preview_route(client, auth_headers):
    response = await client.post(
        "/api/preview/linkedin",
        json={"text": "Clean text.\n\nNo issues."},
        headers=auth_headers,
    )
    assert response.status_code == 200
    body = response.json()
    assert body["clean"] is True
    assert body["char_limit"] == 3000
    assert body["first_two_lines"] == "Clean text.\n"  # first two lines: text + blank

    flagged = await client.post(
        "/api/preview/linkedin",
        json={"text": "**bold** " + "x" * 3000},
        headers=auth_headers,
    )
    assert flagged.status_code == 200
    assert flagged.json()["clean"] is False
    assert any(c["severity"] == "error" for c in flagged.json()["checks"])


@pytest.mark.asyncio
async def test_preview_route_requires_auth(client):
    response = await client.post("/api/preview/linkedin", json={"text": "hello"})
    assert response.status_code in (401, 403)
