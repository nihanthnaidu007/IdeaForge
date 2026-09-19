"""Voice DNA extraction and retrieval-into-prompt conditioning.

The extraction prompt pair and the VoiceDNAProfile schema are the AI Craft
Pack's §3.2/§3.1, consumed verbatim — this module only fills template slots,
validates the extractor's JSON against the pydantic model, and builds the
VOICE DNA block generation prompts condition on. Retrieval-into-prompt, never
fine-tuning (spec, Voice DNA row; hardening research §7).
"""

from __future__ import annotations

from typing import Any

from pydantic import ValidationError

from app.models.voice import VoiceDNAProfile
from app.services.llm.provider import GenerationError

EXTRACTION_SYSTEM_PROMPT = """You are a writing-style analyst. You will receive N LinkedIn posts (N between 3 and 5) written by the same author, plus optional context about their niche.

Your job: produce a structured style profile as one JSON object, strictly matching the VoiceDNAProfile schema the user message includes. No prose outside the JSON.

Rules of evidence:
- Every descriptor must be grounded in the samples. If you cannot point to at least one sample that shows it, do not write it.
- signature_phrases contains EXACT phrases that recur across samples, quoted verbatim. Never invent or normalize a phrase. If nothing recurs, return an empty array — an empty array is correct when the samples don't share phrases.
- signature_moves each carry "evidence": a verbatim quote from a sample. Summarize the move in your own words; quote the evidence exactly.
- Do not flatter. "The author writes with exceptional clarity" is not a descriptor. Describe mechanics, not quality.
- When samples conflict (e.g., some posts use emojis and others don't, or tone shifts between formats), record BOTH patterns in "notes" and lower "confidence". A profile that hides a conflict will make generation sound wrong on half the author's posts.
- sentence_rhythm.avg_sentence_length_words: estimate from the samples. It does not need to be perfect; state it to one decimal.
- do_list / dont_list items are instructions to a generation model. Write them as imperatives a model can follow: "Open posts with a direct claim, not a greeting", "Never use emoji", "Prefer fragments for punch lines". Each item must trace to the samples.
- If a sample is clearly not a LinkedIn post or is unusable (empty, truncated mid-sentence), ignore it, decrement sample_count accordingly, and note what you ignored. If fewer than 1 usable sample remains, return {"error": "insufficient_samples"} as the entire output.

Output exactly one JSON object. No markdown fences, no commentary."""

_USER_TEMPLATE = """VOICE SAMPLES ({n} of a maximum 5, same author):
{samples_block}

AUTHOR CONTEXT (optional, may be empty):
- Niche: {niche}
- Stated audience: {audience}

TASK:
Analyze the samples and return the VoiceDNAProfile JSON object exactly matching the schema below. Remember: evidence for every descriptor, verbatim quotes for signature_phrases and signature_moves.evidence, both sides of any conflict recorded in notes with confidence lowered.

SCHEMA:
{voice_dna_schema}"""

# The JSON schema text sent to the extractor — the single source of truth is
# the pydantic VoiceDNAProfile below (validated server-side), but the prompt
# carries the craft pack's explicit schema so the model sees the field
# descriptions ("Never invented", evidence rules) that pydantic can't express.
VOICE_DNA_SCHEMA_TEXT = """{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "title": "VoiceDNAProfile",
  "type": "object",
  "additionalProperties": false,
  "required": ["schema_version", "sample_count", "structure", "vocabulary",
               "energy", "sentence_rhythm", "signature_moves",
               "do_list", "dont_list", "confidence", "notes"],
  "properties": {
    "schema_version": { "const": 1 },
    "sample_count": { "type": "integer", "minimum": 1, "maximum": 5 },
    "structure": {
      "type": "object", "additionalProperties": false,
      "required": ["opening_pattern", "body_pattern", "closing_pattern", "paragraph_style", "line_break_habit"],
      "properties": {
        "opening_pattern": { "type": "string", "description": "How posts reliably begin: claim-first, scene-first, question, stat, etc." },
        "body_pattern": { "type": "string", "description": "How the middle is organized: list, narrative arc, argument blocks, fragments." },
        "closing_pattern": { "type": "string", "description": "How posts reliably end: CTA type, question, one-liner, no close." },
        "paragraph_style": { "type": "string", "description": "Typical paragraph shape: one-line, 1-3 sentences, long blocks." },
        "line_break_habit": { "enum": ["every_sentence", "beat_based", "dense_blocks", "mixed"] }
      }
    },
    "vocabulary": {
      "type": "object", "additionalProperties": false,
      "required": ["register", "jargon_level", "signature_phrases", "verb_energy"],
      "properties": {
        "register": { "type": "string", "description": "Formal / conversational / technical-casual / mixed, with evidence." },
        "jargon_level": { "enum": ["none", "light", "moderate", "heavy"], "description": "How much domain jargon the author uses unexplained." },
        "signature_phrases": { "type": "array", "maxItems": 8, "items": { "type": "string" }, "description": "Exact recurring phrases from the samples. Never invented." },
        "verb_energy": { "type": "string", "description": "Verb character: declarative, hedged, kinetic, analytic." }
      }
    },
    "energy": {
      "type": "object", "additionalProperties": false,
      "required": ["overall_level", "punctuation_style", "emoji_use", "emphasis_tactics"],
      "properties": {
        "overall_level": { "type": "integer", "minimum": 1, "maximum": 10, "description": "1 = measured and dry, 10 = high-intensity." },
        "punctuation_style": { "type": "string", "description": "e.g. 'no exclamation marks, uses em-dashes heavily'." },
        "emoji_use": { "enum": ["none", "rare", "frequent"] },
        "emphasis_tactics": { "type": "string", "description": "How emphasis is produced: caps, unicode bold, bare assertion, repetition." }
      }
    },
    "sentence_rhythm": {
      "type": "object", "additionalProperties": false,
      "required": ["avg_sentence_length_words", "variation", "fragment_use"],
      "properties": {
        "avg_sentence_length_words": { "type": "number", "minimum": 1 },
        "variation": { "type": "string", "description": "The author's long-short pattern, e.g. 'long setup, then a 3-word punch line'." },
        "fragment_use": { "enum": ["never", "occasional", "frequent"] }
      }
    },
    "signature_moves": {
      "type": "array", "minItems": 2, "maxItems": 6,
      "items": {
        "type": "object", "additionalProperties": false,
        "required": ["move", "evidence"],
        "properties": {
          "move": { "type": "string", "description": "A repeatable behavior, e.g. 'ends a claim with a one-line proof from own data'." },
          "evidence": { "type": "string", "description": "Verbatim quote from a sample demonstrating the move." }
        }
      }
    },
    "do_list": { "type": "array", "minItems": 3, "maxItems": 8, "items": { "type": "string" },
      "description": "Imperative instructions a generation model should follow to sound like this author." },
    "dont_list": { "type": "array", "minItems": 3, "maxItems": 8, "items": { "type": "string" },
      "description": "Anti-instructions: things the author visibly never does." },
    "confidence": { "type": "number", "minimum": 0, "maximum": 1,
      "description": "Lower it when samples conflict or are few; 0.9+ only when all samples agree." },
    "notes": { "type": "string", "description": "Conflicts, ambiguities, and anything the generation model should know." }
  }
}"""


def build_extraction_user_prompt(
    samples: list[str], *, niche: str = "", audience: str = ""
) -> str:
    """Fill the craft pack's user template: numbered samples, context, schema."""
    numbered = "\n".join(
        f"--- SAMPLE {i + 1} (format: text post, posted: unknown) ---\n{text.strip()}"
        for i, text in enumerate(samples)
    )
    return _USER_TEMPLATE.format(
        n=len(samples),
        samples_block=numbered,
        niche=niche or "unknown",
        audience=audience or "unknown",
        voice_dna_schema=VOICE_DNA_SCHEMA_TEXT,
    )


def validate_voice_profile(payload: Any) -> dict[str, Any]:
    """Validate extractor JSON against the profile model or raise GenerationError.

    The structured-output retry already happened at the JSON-parse layer; a
    schema mismatch after that is a 502 — never a canned profile.
    """
    if isinstance(payload, dict) and payload.get("error") == "insufficient_samples":
        raise GenerationError(
            "The samples didn't contain a usable LinkedIn post — check the pasted "
            "posts and try again."
        )
    try:
        profile = VoiceDNAProfile.model_validate(payload)
    except ValidationError as exc:
        raise GenerationError(
            "The model's style profile wasn't usable after a retry. Please try again."
        ) from exc
    # by_alias keeps the craft pack's "register" key in storage and responses.
    return profile.model_dump(by_alias=True)


def voice_fallback_block() -> str:
    """Neutral block when the user has no profile (AI Craft Pack §4.1)."""
    return (
        "=== VOICE DNA ===\n"
        "No Voice DNA profile yet. Write in a clean, direct professional register; "
        "no emoji, no hashtag spam, no invented personal anecdotes. (The user can "
        "train their voice in Voice DNA for posts that sound like them.)"
    )


def build_voice_block(profile: dict[str, Any]) -> str:
    """Build the VOICE DNA block generation prompts condition on.

    Takes a stored version document: descriptors nested under ``style``,
    do/don't lists and notes at the top level. The do/don't lists are the
    load-bearing conditioning (UI pack §6.3: a user editing their profile is
    really editing these lists).
    """
    style = profile.get("style") or {}
    structure = style.get("structure") or {}
    vocab = style.get("vocabulary") or {}
    energy = style.get("energy") or {}
    moves = style.get("signature_moves") or []
    do_items = "\n".join(f"- {item}" for item in profile.get("do_list", []))
    dont_items = "\n".join(f"- {item}" for item in profile.get("dont_list", []))
    move_items = "\n".join(
        f"- {move.get('move', '')}" for move in moves if isinstance(move, dict)
    )
    notes = profile.get("notes", "")

    lines = [
        "=== VOICE DNA ===",
        "How the author writes, extracted from their own past posts — follow it:",
        f"- Structure: {structure.get('opening_pattern', '')} … "
        f"{structure.get('body_pattern', '')} … closes: {structure.get('closing_pattern', '')}",
        f"- Paragraphs: {structure.get('paragraph_style', '')} "
        f"(line breaks: {structure.get('line_break_habit', '')})",
        f"- Vocabulary: {vocab.get('register', '')}; jargon level: "
        f"{vocab.get('jargon_level', '')}; verb energy: {vocab.get('verb_energy', '')}",
        f"- Energy: {energy.get('overall_level', '')}/10; punctuation: "
        f"{energy.get('punctuation_style', '')}; emoji: {energy.get('emoji_use', '')}; "
        f"emphasis: {energy.get('emphasis_tactics', '')}",
    ]
    phrases = vocab.get("signature_phrases") or []
    if phrases:
        lines.append(f"- Signature phrases (use verbatim where natural): {', '.join(phrases)}")
    if move_items:
        lines.append("Signature moves:")
        lines.append(move_items)
    if do_items:
        lines.append("DO:")
        lines.append(do_items)
    if dont_items:
        lines.append("DON'T:")
        lines.append(dont_items)
    if notes:
        lines.append(f"Notes: {notes}")
    return "\n".join(lines)


def profile_version_response(
    version_doc: dict[str, Any], *, total_versions: int
) -> dict[str, Any]:
    """Active-version response body — the full profile plus its version metadata."""
    return {
        "profile": version_doc.get("style"),
        "sentence_rhythm": version_doc.get("sentence_rhythm"),
        "do_list": version_doc.get("do_list", []),
        "dont_list": version_doc.get("dont_list", []),
        "notes": version_doc.get("notes", ""),
        "confidence": version_doc.get("confidence"),
        "sample_count": version_doc.get("sample_count"),
        "source": version_doc.get("source"),
        "version": version_doc.get("version"),
        "total_versions": total_versions,
        "extracted_at": version_doc.get("extracted_at"),
    }


def version_summaries(versions: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Newest-first summaries for the version-history drawer (UI pack §6.3)."""
    return [
        {
            "version": v.get("version"),
            "source": v.get("source"),
            "sample_count": v.get("sample_count"),
            "confidence": v.get("confidence"),
            "notes": v.get("notes", ""),
            "do_list": v.get("do_list", []),
            "dont_list": v.get("dont_list", []),
            "style": v.get("style"),
            "extracted_at": v.get("extracted_at"),
        }
        for v in sorted(versions, key=lambda v: v.get("version", 0), reverse=True)
    ]
