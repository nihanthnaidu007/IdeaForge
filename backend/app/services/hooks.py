"""Hook Bank: seed catalog, idempotent seeding, and prompt conditioning.

The 48 hook patterns below are the AI Craft Pack's catalog (art_1tEpMRty §1):
drafted from established hook archetypes — contrarian openings, personal-story
bridges, stat-led data hooks, save-bait listicles, insider reframes — not
scraped from any live LinkedIn surface. Source basis: craft pack §1.2
(archetype-derived patterns authored for IdeaForge); do not renumber the
stable H-IDs — later seed updates append, never reshuffle, so posts that
reference `hook_pattern_id: "H09"` keep pointing at the same pattern.

Seeding scheme (craft pack §1.3): one document per pattern×format — 48
patterns with a combined formats list yield ~117 documents — so the Hook
Picker filters cleanly by format. Gating tags ride on the pattern:
`requires_source` hooks demand a sourced claim in context (never invent a
statistic), `requires_own_data` hooks demand the author's own numbers or
experiences (marked with an amber flag in the picker, always offered).
"""

from __future__ import annotations

import re
from datetime import UTC, datetime
from typing import Any

from pymongo.errors import DuplicateKeyError

# Hook archetypes (style axis) — the 17 the catalog is curated across.
HOOK_STYLES = [
    "contrarian",
    "story",
    "data",
    "vulnerability",
    "question",
    "listicle",
    "prediction",
    "myth_bust",
    "behind_the_scenes",
    "result",
    "curiosity",
    "failure",
    "challenge",
    "comparison",
    "authority",
    "observation",
    "insider",
]

# Post formats (format axis) — hooks are seeded one doc per format they serve.
HOOK_FORMATS = ["hot_take", "story", "how_to", "listicle", "carousel", "contrarian"]

_SOURCE_SLOTS = ("{stat}", "{source_name}")


def _hook(
    hid: str, pattern: str, style: str, formats: list[str], tags: list[str]
) -> dict[str, Any]:
    return {
        "id": hid,
        "text_pattern": pattern,
        "style": style,
        "formats": formats,
        "tags": tags,
    }


# The catalog. ids H01–H48 are stable; append new patterns at the end.
HOOK_SEED: list[dict[str, Any]] = [
    _hook("H01", "Unpopular opinion: {claim}.", "contrarian", ["hot_take", "contrarian"], ["bold", "low_risk"]),
    _hook("H02", "Everyone is optimizing {topic}. The actual bottleneck is {stake}.", "contrarian", ["hot_take", "contrarian", "carousel"], ["high_specificity"]),
    _hook("H03", "Stop {common practice}. It's {honest cost} — and {alternative} gets you further.", "contrarian", ["hot_take", "contrarian"], ["bold"]),
    _hook("H04", "{Common advice} works — until you scale. Then it quietly becomes {failure mode}.", "contrarian", ["contrarian", "story", "carousel"], ["beginner_safe"]),
    _hook("H05", "{Timeframe} ago, {before}. Today, {after}. The gap is the whole post.", "story", ["story", "carousel"], ["low_risk", "requires_own_data"]),
    _hook("H06", "The {event} that taught me most about {topic} wasn't {expected event}. It was {unexpected event}.", "story", ["story"], ["low_risk"]),
    _hook("H07", "A {role} once told me: \"{quote}\". I thought they were wrong. Here's what changed my mind.", "story", ["story", "contrarian"], ["low_risk"]),
    _hook("H08", "It took {n} {timeframe} of {unglamorous work} before {breakthrough}. Nobody posts about that part.", "story", ["story", "carousel"], ["vulnerable", "requires_own_data"]),
    _hook("H09", "{stat}. That number isn't the story. What it says about {topic} is.", "data", ["hot_take", "carousel"], ["requires_source", "high_specificity"]),
    _hook("H10", "I analyzed {n} {artifacts} from {own context}. {Finding} showed up more than anything else.", "data", ["carousel", "listicle", "hot_take"], ["requires_own_data", "high_specificity"]),
    _hook("H11", "{source_name} just published {artifact}. Everyone is quoting {obvious part}. The line that matters is {key line}.", "data", ["hot_take", "carousel"], ["requires_source", "bold"]),
    _hook("H12", "I was wrong about {topic}. Publicly. Here's what happened.", "vulnerability", ["story", "contrarian"], ["vulnerable"]),
    _hook("H13", "Confession: {mistake}. If it saves one person the same {cost}, this post was worth it.", "vulnerability", ["story", "listicle"], ["vulnerable", "low_risk"]),
    _hook("H14", "The hardest part of {topic} isn't {assumed hard thing}. It's {actual hard thing}.", "vulnerability", ["hot_take", "carousel", "how_to"], ["beginner_safe"]),
    _hook("H15", "Quick question for {audience}: {question}? My answer below — I want yours.", "question", ["hot_take", "story"], ["low_risk", "engagement"]),
    _hook("H16", "You inherit {scenario}. You have {constraint}. What do you do first?", "question", ["story", "carousel", "how_to"], ["engagement"]),
    _hook("H17", "I keep getting asked {question}. Same answer every time: {compressed answer}. So here it is in full.", "question", ["how_to", "listicle", "story"], ["save_bait"]),
    _hook("H18", "{n} things {doing the hard thing} taught me about {topic}. {k} surprised me.", "listicle", ["listicle", "carousel"], ["save_bait", "requires_own_data"]),
    _hook("H19", "{n} {tools/resources/habits} that {outcome} — with the exact use case for each. Save this for {occasion}.", "listicle", ["listicle", "carousel"], ["save_bait", "beginner_safe"]),
    _hook("H20", "The {n}-step playbook we used to {result}:", "listicle", ["listicle", "carousel", "how_to"], ["save_bait", "requires_own_data"]),
    _hook("H21", "Prediction: by {timeframe}, {claim}. Bookmark this and check back.", "prediction", ["hot_take", "contrarian"], ["bold", "save_bait"]),
    _hook("H22", "Everyone's watching {obvious trend}. The shift that will actually matter: {underappreciated trend}.", "prediction", ["contrarian", "hot_take", "carousel"], ["bold"]),
    _hook("H23", "{Industry} in {year} will look less like {today's assumption} and more like {replacement}. Reasoning:", "prediction", ["contrarian", "carousel"], ["bold", "high_specificity"]),
    _hook("H24", "\"{Widely believed claim}\" is half true. The missing half: {correction}.", "myth_bust", ["contrarian", "hot_take", "carousel"], ["beginner_safe", "bold"]),
    _hook("H25", "Where did \"{pervasive claim}\" come from? Not from {assumed origin}. I traced it — here's the chain.", "myth_bust", ["carousel", "story"], ["high_specificity", "save_bait"]),
    _hook("H26", "{Framework X} isn't dead. The lazy version of it is. Here's the version that still works.", "myth_bust", ["contrarian", "listicle", "how_to"], ["low_risk"]),
    _hook("H27", "This is what {desirable outcome} actually looked like at {embarrassing stage}: {artifact description}. Process below.", "behind_the_scenes", ["story", "carousel"], ["low_risk", "vulnerable"]),
    _hook("H28", "A realistic day of {role} work with {tool}: {hour block 1}. {hour block 2}. {hour block 3}. No productivity porn, just the log.", "behind_the_scenes", ["story", "carousel", "listicle"], ["low_risk"]),
    _hook("H29", "Building {artifact} in public. Week {n}: what worked ({win}), what didn't ({failure}), and the number that matters ({own metric}).", "behind_the_scenes", ["story", "listicle"], ["requires_own_data"]),
    _hook("H30", "{Result} in {timeframe}. No new headcount, no {expected expensive input}. Here's exactly how.", "result", ["story", "carousel", "how_to"], ["requires_own_data", "high_specificity"]),
    _hook("H31", "Before: {before state}. After: {after state}. The difference wasn't {obvious cause} — it was {actual cause}.", "result", ["story", "carousel", "hot_take"], ["requires_own_data", "high_specificity"]),
    _hook("H32", "{Implausible-sounding own metric}. I expected you not to believe it, so here's the raw data.", "result", ["carousel", "story", "hot_take"], ["requires_own_data", "bold"]),
    _hook("H33", "Nobody tells you this about {topic}: {unexpected truth}. It changes how you think about {adjacent thing}.", "curiosity", ["hot_take", "story", "carousel"], ["save_bait"]),
    _hook("H34", "I've seen something about {topic} I can't share yet. I can tell you this much: {disclosable fragment}.", "curiosity", ["hot_take", "story"], ["bold", "engagement"]),
    _hook("H35", "{Project/initiative} failed. Post-mortem in public: what we'd do differently, starting with {first change}.", "failure", ["story", "listicle", "carousel"], ["vulnerable", "save_bait"]),
    _hook("H36", "{Mistake} cost us {quantified cost}. The lesson was cheaper than the tuition. Here it is:", "failure", ["story", "contrarian"], ["vulnerable", "high_specificity"]),
    _hook("H37", "{n} days of {experiment}. Results, unedited: what worked, what didn't, what I'd never do again.", "challenge", ["story", "listicle", "carousel"], ["requires_own_data", "save_bait"]),
    _hook("H38", "I committed to {goal} {timeframe} ago. Scoreboard: {n} done, {m} skipped, {lesson} learned.", "challenge", ["story", "hot_take"], ["vulnerable", "requires_own_data"]),
    _hook("H39", "Everyone compares {option A} vs {option B} on {surface dimension}. The difference that actually matters: {depth dimension}.", "comparison", ["hot_take", "carousel", "contrarian"], ["high_specificity"]),
    _hook("H40", "There are two kinds of {profession}: those who {habit A} and those who {habit B}. The gap shows up in {outcome}.", "comparison", ["hot_take", "story"], ["bold", "engagement"]),
    _hook("H41", "Stop comparing {thing 1} to {thing 2}. One is {category}, the other is {category}. Here's the question to ask instead:", "comparison", ["hot_take", "contrarian"], ["bold"]),
    _hook("H42", "After {n} years in {field}, I've narrowed it to {small number} principles. Here they are, with the mistakes that taught me each.", "authority", ["listicle", "carousel", "story"], ["save_bait"]),
    _hook("H43", "If I had to restart my {career/project} in {year}, here's exactly what I'd do — and what I'd skip.", "authority", ["listicle", "carousel", "story"], ["save_bait", "beginner_safe"]),
    _hook("H44", "Small detail, big signal: {observation from your own work or feed}. It says more about {topic} than any forecast.", "observation", ["hot_take", "story"], ["low_risk", "high_specificity"]),
    _hook("H45", "A number I've been quietly tracking: {own metric over timeframe}. The direction matters more than the size.", "observation", ["hot_take", "carousel"], ["requires_own_data"]),
    _hook("H46", "The public version of {debate}: {public framing}. The version {insider group} argue about privately: {real framing}.", "insider", ["contrarian", "carousel", "hot_take"], ["bold", "high_specificity"]),
    _hook("H47", "{Group} keeps {doing unexpected thing}. Most people read it as {wrong reading}. It's actually about {real meaning}.", "insider", ["hot_take", "story", "contrarian"], ["bold"]),
    _hook("H48", "{Source_name} just shipped {release}. Translate that from marketing into engineering: {plain-language implication}.", "insider", ["hot_take", "carousel"], ["requires_source", "save_bait"]),
]


def seed_documents() -> list[dict[str, Any]]:
    """Flatten the catalog to one document per pattern×format (craft §1.3)."""
    docs: list[dict[str, Any]] = []
    now = datetime.now(UTC)
    for pattern in HOOK_SEED:
        for fmt in pattern["formats"]:
            docs.append(
                {
                    "id": pattern["id"],
                    "text_pattern": pattern["text_pattern"],
                    "style": pattern["style"],
                    "format": fmt,
                    "tags": list(pattern["tags"]),
                    "is_builtin": True,
                    "created_at": now,
                }
            )
    return docs


async def seed_hooks(db: Any) -> int:
    """Idempotent seeding: insert only missing (id, format) pairs.

    Called from the app lifespan after ensure_indexes; the unique (id, format)
    index makes concurrent boots safe. Returns the number inserted. Existing
    documents are never rewritten — H-IDs are frozen.
    """
    existing = await db.hooks.find({}, {"id": 1, "format": 1}).to_list(None)
    seen = {(row["id"], row["format"]) for row in existing}
    inserted = 0
    for doc in seed_documents():
        if (doc["id"], doc["format"]) in seen:
            continue
        try:
            await db.hooks.insert_one(doc)
            inserted += 1
        except DuplicateKeyError:
            continue  # concurrent boot won the race; the doc exists
    return inserted


def pattern_needs_source(pattern: str) -> bool:
    """True when the pattern has a slot only a sourced claim may fill."""
    return any(slot in pattern for slot in _SOURCE_SLOTS)


def extract_slots(pattern: str) -> list[str]:
    """The {placeholder} slots a generation model must fill from context."""
    return re.findall(r"\{[^{}]+\}", pattern)


def build_hook_block(hook: dict[str, Any]) -> str:
    """The HOOK block generation prompts condition on: the pattern governs
    ONLY the first line — everything else keeps following the brief/voice
    (craft pack §4.3). Slot-filling is evidence-bound: a {stat} slot with no
    sourced number available must be rewritten away, never invented."""
    slots = ", ".join(extract_slots(hook["text_pattern"]))
    return (
        f'HOOK (first line only, id: {hook["id"]}, archetype: {hook["style"]}): '
        f'"{hook["text_pattern"]}"\n'
        "Make the post's first line follow this pattern; every other line stays "
        "under the brief above."
        + (f" Slots to fill: {slots}." if slots else "")
        + " Fill placeholder slots only with material from the idea and trend "
        "context. Never invent a statistic or attribute a number to a source — "
        "if a slot needs a sourced number and none is provided, rewrite the "
        "line without that slot."
    )


def hook_response(doc: dict[str, Any]) -> dict[str, Any]:
    """API shape for one hook document."""
    return {
        "id": doc["id"],
        "text_pattern": doc["text_pattern"],
        "style": doc["style"],
        "format": doc["format"],
        "tags": doc.get("tags", []),
        "is_builtin": doc.get("is_builtin", False),
    }
