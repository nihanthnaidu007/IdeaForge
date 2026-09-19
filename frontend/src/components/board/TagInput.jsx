import { useId, useMemo, useRef, useState } from "react";
import { X } from "lucide-react";

// Backend bounds (app/routers/board.py: _MAX_TAGS / _TAG_MAX_LEN) mirrored —
// when the backend changes, this changes with it, so the client never sends a
// list the 422 would reject. The board is deliberately no-drag (UI pack §6.6):
// this control is the keyboard-first way tags get created and edited.
export const MAX_TAGS = 10;
export const MAX_TAG_LEN = 40;

// Mirror of board.normalize_tags: strip, truncate, exact-match dedupe
// preserving order, cap. One normalization on both sides of the wire so the
// PATCH full-list replace can never surprise the user with a reshaped list.
// The wire contract is strings (Pydantic list[str]) — non-strings are dropped,
// never coerced: String(null) would silently mint a "null" tag.
export function normalizeClientTags(rawTags) {
  const seen = [];
  for (const raw of rawTags ?? []) {
    if (typeof raw !== "string") continue;
    const tag = raw.trim().slice(0, MAX_TAG_LEN);
    if (tag && !seen.includes(tag)) seen.push(tag);
    if (seen.length >= MAX_TAGS) break;
  }
  return seen;
}

// A controlled tag editor: committed chips with remove buttons, an inline
// input that commits on Enter/comma, Backspace on empty pops the last chip,
// and arrow-key-navigable suggestions drawn from the existing tag set
// (GET /board/tags — creation autocompletes so the set stays consistent).
export default function TagInput({
  tags,
  onChange,
  suggestions = [],
  placeholder = "Add tag…",
  ariaLabel = "Tags",
  label,
  testId = "tag-input",
}) {
  const inputId = useId();
  const listId = useId();
  const inputRef = useRef(null);
  const [draft, setDraft] = useState("");
  const [activeIndex, setActiveIndex] = useState(-1);
  const [open, setOpen] = useState(false);

  const full = tags.length >= MAX_TAGS;

  const matches = useMemo(() => {
    const known = Array.isArray(suggestions) ? suggestions : [];
    const needle = draft.trim().toLowerCase();
    if (!needle) return [];
    return known
      .filter((s) => s.toLowerCase().includes(needle))
      .filter((s) => !tags.includes(s))
      .slice(0, 6);
  }, [draft, suggestions, tags]);

  const commit = (raw) => {
    const tag = String(raw).trim().slice(0, MAX_TAG_LEN);
    if (!tag || full || tags.includes(tag)) {
      setDraft("");
      return;
    }
    onChange([...tags, tag]);
    setDraft("");
  };

  const removeTag = (tag) => {
    onChange(tags.filter((t) => t !== tag));
    inputRef.current?.focus();
  };

  const onKeyDown = (event) => {
    if (event.key === "Enter" || event.key === ",") {
      event.preventDefault();
      if (open && matches.length > 0) {
        // Keyboard-first: Enter accepts the highlighted match — defaulting to
        // the first — so typing a prefix and pressing Enter picks the existing
        // tag instead of minting a near-duplicate.
        commit(activeIndex >= 0 ? matches[activeIndex] : matches[0]);
      } else {
        commit(draft);
      }
      setOpen(false);
      setActiveIndex(-1);
    } else if (event.key === "ArrowDown" && matches.length > 0) {
      event.preventDefault();
      setOpen(true);
      setActiveIndex((i) => (i + 1) % matches.length);
    } else if (event.key === "ArrowUp" && matches.length > 0) {
      event.preventDefault();
      setActiveIndex((i) => (i <= 0 ? matches.length - 1 : i - 1));
    } else if (event.key === "Escape" && (draft || open)) {
      // Consume Esc only when there is something to dismiss — inside dialogs
      // a bare Esc must keep closing the dialog itself.
      event.preventDefault();
      event.stopPropagation();
      setDraft("");
      setOpen(false);
      setActiveIndex(-1);
    } else if (event.key === "Backspace" && draft === "" && tags.length > 0) {
      event.preventDefault();
      removeTag(tags[tags.length - 1]);
    }
  };

  const pickSuggestion = (tag) => {
    commit(tag);
    setOpen(false);
    setActiveIndex(-1);
    inputRef.current?.focus();
  };

  return (
    <div
      role="group"
      aria-label={ariaLabel}
      data-testid={testId}
      className="flex flex-wrap items-center gap-1.5"
    >
      {tags.map((tag) => (
        <span
          key={tag}
          data-testid={`${testId}-chip`}
          className="inline-flex items-center rounded-full bg-white/5 border border-white/10 pl-2 pr-1 py-0.5 text-[11px] text-zinc-300"
        >
          {tag}
          <button
            type="button"
            onClick={() => removeTag(tag)}
            aria-label={`Remove tag ${tag}`}
            className="ml-0.5 rounded-full p-0.5 text-zinc-400 hover:text-white focus-visible:ring-1 focus-visible:ring-lime"
          >
            <X className="w-3 h-3" aria-hidden="true" />
          </button>
        </span>
      ))}
      <div className="relative">
        {label ? (
          <label htmlFor={inputId} className="sr-only">
            {label}
          </label>
        ) : null}
        <input
          ref={inputRef}
          id={inputId}
          type="text"
          role="combobox"
          aria-expanded={open && matches.length > 0}
          aria-controls={listId}
          aria-autocomplete="list"
          disabled={full}
          value={draft}
          onChange={(e) => {
            setDraft(e.target.value);
            setActiveIndex(-1);
            setOpen(true);
          }}
          onKeyDown={onKeyDown}
          onBlur={() => setOpen(false)}
          placeholder={full ? `Tag limit reached (${MAX_TAGS})` : placeholder}
          data-testid={`${testId}-input`}
          aria-label={label ? undefined : ariaLabel}
          className="h-7 w-28 rounded-md border border-white/10 bg-transparent px-2 text-xs text-white placeholder:text-zinc-500 focus:border-lime/40 focus:ring-1 focus:ring-lime/30"
        />
        {open && !full && matches.length > 0 && (
          <ul
            id={listId}
            role="listbox"
            aria-label={ariaLabel}
            data-testid={`${testId}-suggestions`}
            className="absolute left-0 top-8 z-10 min-w-32 rounded-md border border-white/10 bg-raised py-1 shadow-lg"
          >
            {matches.map((tag, i) => (
              <li key={tag} role="option" aria-selected={i === activeIndex} id={`${listId}-opt-${i}`}>
                <button
                  type="button"
                  // onMouseDown so the click lands before the input's blur
                  // closes the listbox.
                  onMouseDown={(e) => {
                    e.preventDefault();
                    pickSuggestion(tag);
                  }}
                  data-testid={`${testId}-suggestion`}
                  className={`block w-full px-3 py-1 text-left text-xs ${
                    i === activeIndex ? "bg-white/10 text-white" : "text-zinc-300"
                  }`}
                >
                  {tag}
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
