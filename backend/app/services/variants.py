"""The variation-instruction engine (spec §Variants & A/B).

Every brief, contract, and prompt below is injected verbatim from the
IdeaForge AI Craft Pack (art_1tEpMRty §2 and §4) — this module is their
backend home, not their editor. What the engine adds is mechanics only:
brief selection with rotation (so regenerate always produces new
instructions), block assembly in the craft pack's §4.3 order, refusal
semantics (§4.4), and typed failures.

The defect this replaces: the scaffold's regenerate re-called generate_post
and returned identical output every time (backend audit §1.3 route 9).
"""

from __future__ import annotations

import math
from dataclasses import dataclass
from typing import Any

from app.models.research import TrendItem
from app.services.llm.provider import GenerationError, GenerationRefusedError

# --- format codes -----------------------------------------------------------
# Canonical snake_case codes (AI pack §1.1). The frontend ships kebab-case
# format ids from the scaffold era; both are accepted and normalized here.
_FORMAT_ALIASES: dict[str, str] = {
    "hot_take": "hot_take",
    "hot-take": "hot_take",
    "hot take": "hot_take",
    "carousel": "carousel",
    "story": "story",
    "listicle": "listicle",
    "how_to": "how_to",
    "how-to": "how_to",
    "how to": "how_to",
    "contrarian": "contrarian",
}

FORMAT_CODES = tuple(_FORMAT_ALIASES.values())


def normalize_format(format_raw: str) -> str:
    """Client format id → canonical snake_case code, or ValueError."""
    code = _FORMAT_ALIASES.get(format_raw.strip().lower())
    if code is None:
        raise ValueError(
            f"Unknown post format '{format_raw}' — pick from: {', '.join(FORMAT_CODES)}."
        )
    return code


# --- format contracts (AI pack §2.1, verbatim table rows) -------------------
FORMAT_CONTRACTS: dict[str, str] = {
    "hot_take": (
        "format: hot_take — one claim → stakes → optional micro-proof → close; "
        "120–200 words; claim is line 1; no preamble; one idea only."
    ),
    "carousel": (
        "format: carousel — title slide + 8–11 body slides + CTA slide; "
        "≤ 40 words per slide body; one idea per slide; slide 2 must earn the swipe."
    ),
    "story": (
        "format: story — scene → tension → turn → takeaway; "
        "200–350 words; first person; no moral opener; paragraphs ≤ 3 sentences."
    ),
    "listicle": (
        "format: listicle — intro line + 5–10 items + close; "
        "150–300 words; parallel item structure; bold lead-in per item."
    ),
    "how_to": (
        "format: how_to — outcome in line 1 + 3–7 steps + a failure note; "
        "150–300 words; imperative mood; each step self-sufficient."
    ),
    "contrarian": (
        "format: contrarian — steelman consensus → evidence → reframe → implication; "
        "200–350 words; steelman before breaking; ends on implication, not summary."
    ),
}

# Length band midpoints (words) per format — used for cost estimation only.
FORMAT_BAND_MIDPOINT_WORDS: dict[str, int] = {
    "hot_take": 160,
    "carousel": 280,
    "story": 275,
    "listicle": 225,
    "how_to": 225,
    "contrarian": 275,
}


# --- the 18 variation briefs (AI pack §2.2–§2.7, verbatim) -------------------
@dataclass(frozen=True)
class VariantBrief:
    brief_id: str
    name: str
    format_code: str
    angle_shift: str
    hook_strategy: str
    energy_register: str
    materiality_check: str


def _brief(
    brief_id: str,
    name: str,
    format_code: str,
    *,
    angle: str,
    hook: str,
    energy: str,
    materiality: str,
) -> VariantBrief:
    return VariantBrief(
        brief_id=brief_id,
        name=name,
        format_code=format_code,
        angle_shift=angle,
        hook_strategy=hook,
        energy_register=energy,
        materiality_check=materiality,
    )


VARIATION_BRIEFS: dict[str, tuple[VariantBrief, ...]] = {
    # §2.2 Hot Take
    "hot_take": (
        _brief(
            "HT-A",
            "Maximal Stance",
            "hot_take",
            angle=(
                "strip the idea to its single most defensible strong claim and stake it "
                "without qualifiers. The variant argues; it does not survey."
            ),
            hook=(
                "the claim IS line one, comma-free if possible. No \"In my experience\", no "
                "scene-setting. Compatible hooks: H01, H03, H21."
            ),
            energy=(
                "clipped declaratives, paragraphs of one or two sentences, zero hedging "
                "verbs, no rhetorical questions. Total length at the bottom of the format "
                "band — 120–150 words."
            ),
            materiality=(
                "a named group of practitioners would disagree out loud. If nobody would "
                "push back, this isn't variant A."
            ),
        ),
        _brief(
            "HT-B",
            "Confessed Convert",
            "hot_take",
            angle=(
                "the same claim, framed as a changed mind: what the author used to believe, "
                "the specific thing that broke it, the new position held with appropriate "
                "humility."
            ),
            hook=(
                "open on the old belief stated in full strength, then break it in line two "
                "or three (\"I used to argue the opposite\"). Compatible hooks: H12, H13."
            ),
            energy=(
                "conversational and warm — longer sentences than variant A, first person "
                "throughout, one moment of self-deprecation, contractions everywhere. "
                "150–200 words."
            ),
            materiality=(
                "the post contains a visible before-belief. A reader could quote what the "
                "author \"used to think.\""
            ),
        ),
        _brief(
            "HT-C",
            "Receipts First",
            "hot_take",
            angle=(
                "the claim framed as checkable — anchored to a sourced number or the "
                "author's own measured result, with the reasoning shown rather than asserted."
            ),
            hook=(
                "the stat or measured result is line one (hook tag `requires_source` or "
                "`requires_own_data`), claim arrives second. Compatible hooks: H09, H10, H32."
            ),
            energy=(
                "measured and precise — fewest pronouns of the three variants, numbers carry "
                "the emphasis, no exclamation points, one deliberate long sentence for the "
                "reasoning. 150–200 words."
            ),
            materiality=(
                "at least one claim in `sourced_claims` traces to the TREND CONTEXT block. "
                "No sourced stat → this brief refuses under the refusal semantics (§4.4)."
            ),
        ),
    ),
    # §2.3 Carousel Idea
    "carousel": (
        _brief(
            "CA-A",
            "The Teardown",
            "carousel",
            angle=(
                "don't explain the topic — dissect one concrete example of it, slide by "
                "slide, like an annotated artifact. The idea is taught through the instance, "
                "never through definitions."
            ),
            hook=(
                "slide one shows or names the real artifact (\"This AI agent's transcript "
                "cost a team their pilot\"); slide two states what the reader will see in "
                "it. Compatible hooks: H28, H31, H32."
            ),
            energy=(
                "second person, imperative, present tense — \"Look at line 3. That's where "
                "it broke.\" Punchy slide titles in ≤ 6 words; body slides lean, ≤ 40 words "
                "each. The CTA slide asks for one specific action (save, comment with their "
                "version)."
            ),
            materiality=(
                "a concrete artifact appears by slide 2. A carousel that could exist without "
                "the example isn't this variant."
            ),
        ),
        _brief(
            "CA-B",
            "The Mistake Ladder",
            "carousel",
            angle=(
                "structure the idea as cumulative errors: each slide is one mistake, its "
                "cost, and the fix — each slide's mistake presumes the previous slide's fix. "
                "The reader climbs from common error to expert judgment."
            ),
            hook=(
                "open on the most expensive mistake with its price attached (hook "
                "`requires_own_data`), e.g. H35, H36, H37. Slide two promises the ladder."
            ),
            energy=(
                "raw and first-person, past tense for the mistakes, present tense for the "
                "fixes. Each slide ends on the fix, not the failure — the rhythm is wound, "
                "then released, ten times. CTA slide: \"Which rung are you on?\""
            ),
            materiality=(
                "the slides are sequenced by cost, not by taxonomy — reordering them would "
                "break the narrative. If the order is arbitrary, it isn't this variant."
            ),
        ),
        _brief(
            "CA-C",
            "The Field Guide",
            "carousel",
            angle=(
                "a reference artifact — a taxonomy of N types/options/patterns within the "
                "topic, one per slide, each with a when-to-use line. The reader saves it to "
                "consult later rather than reads it once."
            ),
            hook=(
                "the shelf promise (\"8 retrieval patterns, one decision rule for each — "
                "save this\"), compatible hooks: H19, H20, H42."
            ),
            energy=(
                "calm, dense, neutral — the least personality of the three variants; no "
                "narrative, no jokes; parallel slide grammar throughout (same title shape, "
                "same body shape) so it scans like a table of contents. CTA slide: save + "
                "share with the teammate who needs it."
            ),
            materiality=(
                "every slide's title has identical grammar. If any slide breaks the parallel "
                "structure, it isn't this variant."
            ),
        ),
    ),
    # §2.4 Story Post
    "story": (
        _brief(
            "ST-A",
            "Scene Cold-Open",
            "story",
            angle=(
                "the idea emerges from one specific scene rendered with sensory detail — a "
                "moment, not a summary. The lesson is earned by the scene and stated once at "
                "the end."
            ),
            hook=(
                "start mid-scene, present tense, no context sentence: \"The demo was 40 "
                "seconds old when the agent cited a meeting that never happened.\" Compatible "
                "hooks: H06, H08, H44."
            ),
            energy=(
                "cinematic — short paragraphs (1–2 sentences) with deliberate line breaks at "
                "beats, sensory verbs, dialogue where it exists; the closing lesson is one "
                "plain sentence after the longest paragraph. 250–350 words."
            ),
            materiality=(
                "the first paragraph contains a time, a place, or a line of dialogue. "
                "Summary-first openings aren't this variant."
            ),
        ),
        _brief(
            "ST-B",
            "Letter to Past Self",
            "story",
            angle=(
                "retrospective address — the author writes to who they were before they knew "
                "the idea, advice-forward, generous in tone. The reader overhears mentorship."
            ),
            hook=(
                "direct address in line one (\"Dear the engineer who deleted the eval suite "
                "to hit the deadline—\"). Compatible hooks: H08, H43, H45."
            ),
            energy=(
                "warm, reflective, second person throughout; medium-length sentences, no "
                "jargon without a one-line gloss; ends with one thing the past self (and "
                "reader) should do this week. 200–300 words."
            ),
            materiality=(
                "the entire post is addressed to \"you.\" Any slide back into third-person "
                "analysis breaks it."
            ),
        ),
        _brief(
            "ST-C",
            "Two Doors",
            "story",
            angle=(
                "a decision-fork narrative — at the pivotal moment there were two options, "
                "the author took one, and the post honestly prices both paths before "
                "justifying the choice. The idea is what the choice taught."
            ),
            hook=(
                "name the fork and its stakes in line one, no resolution promised (\"We had "
                "two options that Friday, and one of them was about to cost us a client\"). "
                "Compatible hooks: H16, H31, H38."
            ),
            energy=(
                "measured and balanced — the unchosen path gets a genuine steelman (two or "
                "three sentences minimum), no gloating; slightly formal, fewer contractions "
                "than ST-B. 250–350 words."
            ),
            materiality=(
                "the rejected path is described concretely enough that the reader could have "
                "taken it. A strawman alternative isn't this variant."
            ),
        ),
    ),
    # §2.5 Listicle
    "listicle": (
        _brief(
            "LI-A",
            "Field-Tested Count",
            "listicle",
            angle=(
                "every item is something the author has personally done or watched fail — "
                "the list is ranked by how hard-won each lesson was, worst scar first. The "
                "idea is validated by mileage, not by novelty."
            ),
            hook=(
                "the count plus the surprise marker (\"6 things… #4 surprised me\"), "
                "compatible hooks: H18, H20, H42."
            ),
            energy=(
                "crisp and confident; each item is two sentences maximum — a bold lead-in "
                "claim, then the one-line proof from experience; parallel construction "
                "item-to-item; the close adds item N+1's lesson as a parting line instead of "
                "summarizing. 200–300 words."
            ),
            materiality=(
                "every item carries a first-person proof clause. A list of generic "
                "best-practices isn't this variant."
            ),
        ),
        _brief(
            "LI-B",
            "The Anti-List",
            "listicle",
            angle=(
                "invert the frame — N things NOT to do. Each item is a failure mode, why "
                "smart people still do it, and the cheaper alternative. The idea survives by "
                "negation."
            ),
            hook=(
                "the prohibition (\"5 things to stop doing with your AI budget today\"), "
                "compatible hooks: H03, H26, H41."
            ),
            energy=(
                "dry and a little wry — no cruelty toward the people who do these things, "
                "but no hedging either; items get a \"why it persists\" line, which is the "
                "wit engine; slightly longer items than LI-A, 250–300 words total."
            ),
            materiality=(
                "each item names the seductive reason the practice persists. A list of "
                "\"don'ts\" without the psychology isn't this variant."
            ),
        ),
        _brief(
            "LI-C",
            "The Curated Shelf",
            "listicle",
            angle=(
                "a genuinely useful roundup — tools, resources, or references, each with its "
                "exact use case and one honest limitation. The idea is serviced by "
                "generosity; the curation taste is the argument."
            ),
            hook=(
                "the shelf promise with the save instruction (\"Save this for your next "
                "model upgrade\"), compatible hooks: H19, H22, H48."
            ),
            energy=(
                "brisk, practical, even-keeled; each item: name → use case → limitation in "
                "three parallel clauses; the limitation line is non-negotiable — it's what "
                "separates curation from sponsorship; CTA is save-and-share, no "
                "question-bait. 150–250 words."
            ),
            materiality=(
                "every item includes a stated limitation. Missing limitations means it "
                "drifted into ad copy — not this variant."
            ),
        ),
    ),
    # §2.6 How-To
    "how_to": (
        _brief(
            "HW-A",
            "Zero-to-Done Walkthrough",
            "how_to",
            angle=(
                "complete procedural coverage — the reader goes from nothing to the working "
                "outcome with no assumed setup. Every step is testable: a reader following "
                "it can tell whether they did it right."
            ),
            hook=(
                "outcome first with a timeframe (\"Set up an eval suite for your AI feature "
                "in one afternoon\"), compatible hooks: H20, H30, H33."
            ),
            energy=(
                "imperative mood, numbered steps, one sentence of \"why\" per step so the "
                "reader can improvise when reality differs; no storytelling; the failure note "
                "(\"if step 4 fails, it's almost always X\") is mandatory and does the "
                "credibility work. 250–300 words."
            ),
            materiality=(
                "each step is independently actionable. A step like \"make sure your data is "
                "good\" isn't this variant."
            ),
        ),
        _brief(
            "HW-B",
            "Debug Walkthrough",
            "how_to",
            angle=(
                "problem-first — the reader arrives with a broken thing, and the steps are "
                "diagnostic (check this, rule that out) rather than constructive. The idea is "
                "taught through the debugging path."
            ),
            hook=(
                "name the symptom in the reader's own words (\"Your agent works in demos and "
                "fails in production — here's the diagnostic\"), compatible hooks: H35, H36, "
                "H27."
            ),
            energy=(
                "methodical and calm; each step is \"check → likely finding → fix\"; slightly "
                "longer than HW-A because each check carries reasoning; second person; ends "
                "with the general principle the specific bug taught. 250–300 words."
            ),
            materiality=(
                "the steps are ordered by information gain — each check eliminates the most "
                "probable cause first. A construction order (build it again better) isn't "
                "this variant."
            ),
        ),
        _brief(
            "HW-C",
            "Principles over Steps",
            "how_to",
            angle=(
                "for the senior reader — fewer steps, more judgment. The post teaches the "
                "three or four decisions that matter and explicitly refuses step-by-step "
                "detail (\"the exact commands depend on your stack; the trade-off doesn't\")."
            ),
            hook=(
                "the judgment claim (\"After building 5 of these, here's what actually "
                "predicts success\"), compatible hooks: H42, H43, H17."
            ),
            energy=(
                "measured, senior, low-energy in the best sense — longer sentences than "
                "HW-A, no exclamation marks, numbered principles each followed by its "
                "trade-off; comfortable admitting what it doesn't cover. 200–250 words."
            ),
            materiality=(
                "at least one principle names a trade-off the reader must choose on. Steps "
                "without choices are HW-A territory — not this variant."
            ),
        ),
    ),
    # §2.7 Contrarian Take
    "contrarian": (
        _brief(
            "CT-A",
            "The Maverick Brief",
            "contrarian",
            angle=(
                "a direct argument against what the reader's industry is currently doing — "
                "not against a strawman, but against the real, named, current practice. The "
                "reframe is the product of the post."
            ),
            hook=(
                "the most inflammatory defensible sentence the idea supports, line one, "
                "full stop (hooks H01, H02, H22)."
            ),
            energy=(
                "punchy and confident; short paragraphs; the consensus position gets exactly "
                "one respectful sentence before the break; the strongest material sits in "
                "the implications section — what changes Monday morning if this is right. "
                "250–300 words."
            ),
            materiality=(
                "a specific, named current practice is being argued against. Arguing against "
                "\"the old way\" in general isn't this variant."
            ),
        ),
        _brief(
            "CT-B",
            "The Reluctant Contrarian",
            "contrarian",
            angle=(
                "the author argues against their own tribe — the position costs them "
                "something with their peers, and the post says so. The reluctance is the "
                "credibility engine."
            ),
            hook=(
                "state the tribal cost first (\"Most people building AI products will hate "
                "this take, and I'll lose some of you\"), compatible hooks: H12, H46, H47."
            ),
            energy=(
                "careful and humane — hedges appear, but only where honest (\"I might be "
                "wrong about the timeline; I'm not wrong about the direction\"); longer, more "
                "considered sentences than CT-A; the disagreement gets acknowledged on its "
                "strongest point. 250–350 words."
            ),
            materiality=(
                "the post names what the author loses by holding the position. A "
                "free-floating hot take with no cost isn't this variant."
            ),
        ),
        _brief(
            "CT-C",
            "The Evidence Prosecution",
            "contrarian",
            angle=(
                "the case built almost entirely from sourced material — the consensus view "
                "is put on trial, and each exhibit is a claim traced to the trend context or "
                "the author's own data. Opinion appears only in the closing argument."
            ),
            hook=(
                "open on the exhibit, not the thesis — the sourced stat or receipt in line "
                "one (hooks H09, H11, H32; requires a sourced trend or own data)."
            ),
            energy=(
                "formal and restrained — the driest of the three; numbered exhibits ("
                "\"Exhibit A:\", \"Exhibit B:\") with the source name in the line; the verdict "
                "sentence lands alone in its own paragraph at the end. 300–350 words."
            ),
            materiality=(
                "≥ 2 claims in `sourced_claims` with distinct sources. Under-sourced → this "
                "brief refuses under the refusal semantics (§4.4). That refusal is correct "
                "behavior, not a bug."
            ),
        ),
    ),
}


def assign_briefs(format_code: str, n: int, generation_round: int = 0) -> list[VariantBrief]:
    """Pick n distinct briefs for the format, rotated by the generation round.

    Round 0 runs A/B/C; each later regenerate rotates the starting brief, so a
    regenerate always sends different instruction sets than the round before it
    (the audit's identical-output defect, fixed at the instruction level). One
    brief per variant, never merged (AI pack §2 design rules).
    """
    briefs = VARIATION_BRIEFS[format_code]
    if not 2 <= n <= 3:
        raise ValueError("Variant generation produces 2–3 variants.")
    if n > len(briefs):
        raise ValueError(f"Only {len(briefs)} briefs exist for '{format_code}'.")
    start = generation_round % len(briefs)
    return [briefs[(start + i) % len(briefs)] for i in range(n)]


def brief_block(brief: VariantBrief) -> str:
    """Render the brief verbatim for the master prompt's {variant_block} slot."""
    return (
        f'{brief.brief_id} "{brief.name}":\n'
        f"Angle shift: {brief.angle_shift}\n"
        f"Hook strategy: {brief.hook_strategy}\n"
        f"Energy register: {brief.energy_register}\n"
        f"Materiality check: {brief.materiality_check}"
    )


def brief_intent(brief: VariantBrief) -> str:
    """One-line column intent for the UI — the angle shift's first sentence."""
    first_sentence = brief.angle_shift.split(". ")[0].rstrip(".")
    return f"{first_sentence}."


# --- master generation prompt (AI pack §4.2, verbatim) -----------------------
MASTER_SYSTEM_PROMPT = """You are the ghostwriter for a LinkedIn author. You write the post they would have
written on their best day: their voice, their judgment, their stakes.

You receive blocks in the user message:
- IDEA: what the post is about.
- FORMAT CONTRACT: the post format you must produce, with its skeleton, length
  band, and hard rules.
- VARIANT INSTRUCTION: a brief that governs the post's angle, hook strategy, and
  energy register. Follow it over any default instinct where they conflict.
- HOOK: the pattern for your first line. Fill its placeholder slots with material
  from this post. Do not add the hook's example text; write a new one.
- TREND CONTEXT: research material, some of it with source labels.
- VOICE DNA: how the author writes (or a fallback note).

NON-NEGOTIABLE RULES:

1. FAIL LOUD, NEVER FAKE. You may only state as fact what appears in TREND CONTEXT
   (labeled [source: name](url)), what VOICE DNA or IDEA supplies about the
   author's own experience, or what is common general knowledge that no reader
   would dispute. Everything else you believe but cannot anchor is speculation —
   and speculation must be visibly marked: "I suspect", "my read is", "my bet".
   NEVER add statistics, dates, names, quotes, or events that are not in TREND
   CONTEXT. If a number would strengthen the post and no source supplies it,
   either say the qualitative version or mark the claim as your estimate. A post
   with a visibly honest guess is acceptable. A post with an invented fact is not.

2. SOURCES STAY VISIBLE. When a trend claim carries a source label, keep the
   attribution in the post text in a natural form ("according to [name]" /
   "a [source] report found"). Never launder a sourced claim into an unattributed
   assertion, and never cite a source that is not in TREND CONTEXT.

3. HONESTY ABOUT YOUR OWN CLAIMS. The author may claim personal experience only
   as the IDEA and VOICE DNA describe it. If the IDEA gives no such experience,
   write the post in a register that doesn't require one (analysis, observation,
   question). Never invent "my client", "our team", "last week".

4. VOICE IS LAW (when present). Follow VOICE DNA do_list and dont_list, including
   its no-list of things the author never does. Where the VARIANT INSTRUCTION's
   energy register and VOICE DNA conflict, keep the author's hard rules (punctuation,
   emoji, fragments) and bend the variant.

5. FORMAT IS LAW. Produce exactly the FORMAT CONTRACT's skeleton and length band.
   Respect its hard rules even when the VARIANT INSTRUCTION would suggest otherwise.

6. WRITE FOR THE FEED. The first two lines are the entire preview — they must
   survive out of context. One idea per paragraph; line breaks at beats; no
   more than three hashtags, only if they earn their place; no engagement-bait
   ("comment YES if…"), no "let's dive in", no throat-clearing openers.

7. OUTPUT: return JSON only — {"post_text": string, "hook_pattern_id": string,
   "format": string, "variant": string, "sourced_claims": [{"claim": string,
   "source_name": string, "url": string}], "own_claims": [string],
   "speculative_claims": [string], "notes": string}. sourced_claims lists every
   trend claim used, with its source name and URL copied exactly from TREND
   CONTEXT. speculative_claims lists the claims you marked as speculation. If you
   cannot write a post that satisfies rule 1 (e.g. the VARIANT INSTRUCTION
   requires a sourced stat that is absent), return {"error": "generation_refused",
   "reason": string} instead — that refusal is the correct output.

Never break rule 1 for fluency, for punch, or because the user asked in a
previous turn. This is the product's spine."""

# The master prompt names a HOOK block; the Hook Bank lane has not landed yet,
# so no hook records exist. Until then the variant brief's own hook strategy
# governs line one (AI pack §0 precedence: hook pattern > variant > voice —
# absent a hook pattern, the variant wins the hook).
HOOK_BLOCK = """{pattern}
(pattern id: {hook_id}, archetype: {style}) — make line one follow this
pattern; fill placeholder slots from TREND CONTEXT or the IDEA, never from
invention."""

# Voice fallback when no Voice DNA profile exists (AI pack §4.1, verbatim).
VOICE_FALLBACK_BLOCK = (
    "No Voice DNA profile yet. Write in a clean, direct professional register; "
    "no emoji, no hashtag spam, no invented personal anecdotes. (The user can "
    "train their voice in Voice DNA for posts that sound like them.)"
)

_TASK_LINE = (
    "TASK: Write the post. Follow the system rules exactly. Return the JSON "
    "output specified in the system prompt."
)


def build_idea_block(
    idea: dict[str, Any],
    insights: dict[str, Any] | None,
    *,
    custom_instructions: str | None = None,
    tweak_instruction: str | None = None,
) -> str:
    """Assemble the IDEA block from the idea and its insight card.

    Accepts both the structured insight-card schema (AI pack §5.1) and the
    scaffold-era flat insights shape, so pre-existing clients keep working.
    A user tweak/custom instruction rides here as author-supplied content.
    """
    lines = [f'Title: "{idea.get("title", "")}"']
    if idea.get("rating_explanation"):
        lines.append(f"Angle: {idea['rating_explanation']}")
    if insights:
        audience = insights.get("audience")
        if isinstance(audience, dict) and audience.get("primary"):
            lines.append(f"Audience: {audience['primary']}")
        elif insights.get("targeted_audience"):
            lines.append(f"Audience: {insights['targeted_audience']}")
        if insights.get("why_it_matters"):
            lines.append(f"Why it matters: {insights['why_it_matters']}")
        aspects = insights.get("key_aspects")
        if aspects:
            rendered = []
            for aspect in aspects:
                if isinstance(aspect, dict) and aspect.get("aspect"):
                    rendered.append(f"{aspect['aspect']} — {aspect.get('tension', '')}")
                elif isinstance(aspect, str):
                    rendered.append(aspect)
            if rendered:
                lines.append("Aspects to cover:\n" + "\n".join(f"- {a}" for a in rendered))
        angles = insights.get("post_angles")
        if isinstance(angles, list) and angles:
            first = angles[0]
            if isinstance(first, dict) and first.get("angle"):
                lines.append(f"Suggested angle (user may have chosen another): {first['angle']}")
    if custom_instructions:
        lines.append(f"Author's instruction: {custom_instructions}")
    if tweak_instruction:
        lines.append(
            f"Author's tweak instruction (follow this on top of the variant "
            f"brief; it never overrides the system rules): {tweak_instruction}"
        )
    return "\n".join(lines)


def build_trend_block(
    trends: list[TrendItem] | None,
    evidence_gaps: list[str] | None = None,
) -> str:
    """Render TREND CONTEXT: sourced bullet lines + explicit no-source gaps.

    The [No sourced claim on: …] lines tell the model where the evidence ends —
    that is what makes the fail-loud rule enforceable (AI pack §4.3).
    """
    lines: list[str] = []
    for trend in (trends or [])[:8]:
        line = f"- {trend.title}: {trend.snippet}"
        if trend.source or trend.url:
            label = f"[source: {trend.source or trend.url}]({trend.url or trend.source})"
            line = f"{line} {label}"
        lines.append(line)
    for gap in (evidence_gaps or [])[:5]:
        lines.append(f"[No sourced claim on: {gap}]")
    if not lines:
        lines.append(
            "[No sourced claim on: any trend context — none was provided for this generation]"
        )
    return "\n".join(lines)


def build_voice_block(profile: dict[str, Any] | None) -> str:
    """Render VOICE DNA from a stored voice profile, or the fallback."""
    if not profile:
        return VOICE_FALLBACK_BLOCK
    do_list = profile.get("do_list") or []
    dont_list = profile.get("dont_list") or []
    moves = [
        move.get("move")
        for move in profile.get("signature_moves") or []
        if isinstance(move, dict) and move.get("move")
    ]
    parts = []
    if do_list:
        parts.append("DO — " + "; ".join(str(item).rstrip(".") for item in do_list) + ".")
    if dont_list:
        parts.append("DON'T — " + ", ".join(str(item).rstrip(".") for item in dont_list) + ".")
    if moves:
        parts.append("Signature: " + "; ".join(str(m).rstrip(".") for m in moves) + ".")
    confidence = profile.get("confidence")
    if confidence is not None:
        parts.append(f"Author profile (confidence {confidence}).")
    if not parts:
        return VOICE_FALLBACK_BLOCK
    return " ".join(parts)


def assemble_user_message(
    *,
    idea_block: str,
    format_contract: str,
    variant_block: str,
    trend_block: str,
    voice_block: str,
    hook_block: str | None = None,
) -> str:
    """§4.3 assembly order: evidence first, instructions second, task last."""
    blocks = [
        f"=== IDEA ===\n{idea_block}",
        f"=== FORMAT CONTRACT ===\n{format_contract}",
        f"=== VARIANT INSTRUCTION ===\n{variant_block}",
    ]
    if hook_block:
        blocks.append(f"=== HOOK ===\n{hook_block}")
    blocks.append(f"=== TREND CONTEXT ===\n{trend_block}")
    blocks.append(f"=== VOICE DNA ===\n{voice_block}")
    blocks.append(_TASK_LINE)
    return "\n\n".join(blocks)


def parse_variant_output(parsed: Any, *, provider: str | None = None) -> dict[str, Any]:
    """Validate the master prompt's JSON output; refusals are typed, not retried.

    A `generation_refused` answer is a correct, truthful response (AI pack
    §4.4) — it becomes GenerationRefusedError with the model's reason. Any
    other malformed payload is a GenerationError; nothing is ever substituted.
    """
    if isinstance(parsed, dict) and parsed.get("error") == "generation_refused":
        reason = str(parsed.get("reason", "The model refused this variant's brief."))
        raise GenerationRefusedError(reason, provider=provider)
    if not isinstance(parsed, dict) or not str(parsed.get("post_text", "")).strip():
        raise GenerationError(
            "The model's variant response was missing a draft. Please retry generation.",
            provider=provider,
        )
    return {
        "post_text": str(parsed["post_text"]).strip(),
        "hook_pattern_id": parsed.get("hook_pattern_id") or None,
        "sourced_claims": parsed.get("sourced_claims") or [],
        "own_claims": parsed.get("own_claims") or [],
        "speculative_claims": parsed.get("speculative_claims") or [],
        "notes": parsed.get("notes") or "",
    }


__all__ = [
    "FORMAT_CODES",
    "FORMAT_CONTRACTS",
    "FORMAT_BAND_MIDPOINT_WORDS",
    "GenerationRefusedError",
    "MASTER_SYSTEM_PROMPT",
    "VARIATION_BRIEFS",
    "VariantBrief",
    "assemble_user_message",
    "assign_briefs",
    "brief_block",
    "brief_intent",
    "build_idea_block",
    "build_trend_block",
    "build_voice_block",
    "normalize_format",
    "parse_variant_output",
]

# math is used by cost estimation callers importing from here; keep the import
# honest by exposing the estimator used by the cost-hint service.
def estimate_output_tokens(format_code: str) -> int:
    """Estimated completion size: the format's band midpoint in tokens."""
    words = FORMAT_BAND_MIDPOINT_WORDS.get(format_code, 220)
    return math.ceil(words * 4 / 3)
