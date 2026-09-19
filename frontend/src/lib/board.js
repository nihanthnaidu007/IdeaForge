// Content Board domain model (spec §What We Build — Content Board row).
// Status pipeline and adjacency MIRROR backend/app/models/board.py — when the
// backend enum changes, this changes with it (the backend rejects invalid
// moves with INVALID_TRANSITION; this mirror just keeps invalid buttons off
// the cards so the user never sees a 400).

// Column presentation. `hint` is the column-empty drop-target line (UI pack
// honest-empty pattern: name the state, promise nothing).
export const STATUS_COLUMNS = [
  { id: "inbox", label: "Inbox", hint: "Nothing is in the inbox yet." },
  { id: "forged", label: "In the forge", hint: "Nothing is in the forge yet." },
  { id: "drafting", label: "Polishing", hint: "Nothing is being polished yet." },
  { id: "ready", label: "Ready", hint: "Nothing is ready yet." },
];

// Adjacent-step transitions only (backend TransitionRules.VALID). Forward and
// backward one stage; the board is a pipeline, not a free-for-all.
const ADJACENCY = {
  inbox: ["forged"],
  forged: ["inbox", "drafting"],
  drafting: ["forged", "ready"],
  ready: ["drafting"],
};

export const validTargets = (status) => ADJACENCY[status] ?? [];

export const columnLabel = (status) =>
  STATUS_COLUMNS.find((col) => col.id === status)?.label ?? status;

// Absolute + relative schedule rendering. One formatter so cards and queue
// rows agree.
export function formatSchedule(iso) {
  if (!iso) return null;
  const when = new Date(iso);
  const absolute = when.toLocaleString(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
  const diffMs = when.getTime() - Date.now();
  const relative =
    diffMs > 0
      ? `in ${humanizeDelay(diffMs)}`
      : `${humanizeDelay(-diffMs)} ago`;
  return { absolute, relative, overdue: diffMs <= 0 };
}

function humanizeDelay(ms) {
  const minutes = Math.round(ms / 60000);
  if (minutes < 1) return "moments";
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} hr${hours === 1 ? "" : "s"}`;
  const days = Math.round(hours / 24);
  return `${days} day${days === 1 ? "" : "s"}`;
}

// Quick picks (UI pack §5.5): resolved dates for the two presets.
export function quickPick(name, now = new Date()) {
  const when = new Date(now);
  if (name === "tomorrow") {
    when.setDate(when.getDate() + 1);
  } else if (name === "monday") {
    const daysToMonday = (8 - when.getDay()) % 7 || 7;
    when.setDate(when.getDate() + daysToMonday);
  } else {
    return null;
  }
  when.setHours(9, 0, 0, 0);
  return when;
}

export const QUICK_PICKS = [
  { id: "tomorrow", label: "Tomorrow 9:00" },
  { id: "monday", label: "Monday 9:00" },
];
