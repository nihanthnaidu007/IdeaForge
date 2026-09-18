import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { api } from "@/api/client";
import { POST_FORMATS } from "@/lib/constants";
import { Check, Copy, HelpCircle, Loader2, Lock, MousePointerClick, Pencil, RefreshCw, Trash2 } from "lucide-react";

// HookPicker, per the UI & Copy Craft Pack §6.2: filter chips by style, a
// per-row source gate (requires_source hooks unlock only when the idea's
// trend context carries a sourced claim), the own-data flag, and the
// swap-into-draft action with its §6.5 cost line.
//
// Cost copy: AI Craft Pack §6 #7 owns the swap string; its {est_usd} slot
// needs a backend price table that doesn't exist yet, and the pack forbids
// a fabricated number — the estimate clause uses the sanctioned fallback.
const SWAP_COST_HINT =
  "New hook, new draft — runs one model call on your key; cost depends on your provider pricing. The variant stays the same.";

// Pattern bounds mirror the backend's HookCreate/HookUpdate Field constraints
// (models/hooks.py): the same wrong input produces the same inline sentence
// the backend's 422 would map to (UI craft pack §5.4 client pre-validation).
const PATTERN_MIN = 3;
const PATTERN_MAX = 280;
const PATTERN_TOO_SHORT = `Pattern is required — at least ${PATTERN_MIN} characters.`;
const PATTERN_TOO_LONG = `Pattern is too long — ${PATTERN_MAX} characters max.`;
const DELETE_CONFIRM_TEXT = "Delete this hook? This can't be undone.";

const styleLabel = (style) => String(style ?? "").replace(/_/g, " ");

const formatLabel = (id) => POST_FORMATS.find((f) => f.id === id)?.name ?? id;

// Backend hook formats are snake_case enums; frontend POST_FORMATS ids are
// kebab-case (models/hooks.py maps the two).
const toApiFormat = (id) => String(id ?? "").replace(/-/g, "_");

const HookRow = ({ hook, locked, selected, hasOriginal, swapping, onUse, onRemove, onSwap, onSaveCopy, copying, editing, editValue, editError, savingEdit, onEditChange, onStartEdit, onSaveEdit, onCancelEdit, deleteConfirmOpen, deleting, onRequestDelete, onConfirmDelete, onCancelDelete }) => {
  const [whyOpen, setWhyOpen] = useState(false);
  const isUserHook = !hook.is_builtin;
  const requiresOwnData = hook.tags?.includes("requires_own_data");

  return (
    <li
      className={`rounded-lg border px-3 py-3 ${
        selected
          ? "border-lime/60 bg-lime/5"
          : locked
            ? "border-white/10 bg-void opacity-60"
            : "border-white/10 bg-void"
      }`}
      data-testid={`hook-row-${hook.id}`}
    >
      <p className="font-mono text-sm text-white break-words">{hook.text_pattern}</p>
      <div className="flex items-center gap-2 flex-wrap mt-2">
        <span className="text-xs text-zinc-400 border border-white/10 rounded-full px-2 py-0.5 capitalize">
          {styleLabel(hook.style)}
        </span>
        {locked && (
          <span className="text-xs text-zinc-400 flex items-center gap-1">
            <Lock className="w-3 h-3" aria-hidden="true" />
            Source-locked
          </span>
        )}
        {requiresOwnData && !locked && (
          <span
            className="text-xs text-rating-mid border border-rating-mid/30 bg-rating-mid/10 rounded-full px-2 py-0.5"
            data-testid={`hook-own-data-${hook.id}`}
          >
            Wants your own numbers — add your result, or it reads generic.
          </span>
        )}
        {selected && (
          <span
            className="text-xs text-lime border border-lime/30 bg-lime/10 rounded-full px-2 py-0.5"
            data-testid={`hook-applied-${hook.id}`}
          >
            Applied
          </span>
        )}
      </div>
      <div className="flex items-center gap-3 mt-3 flex-wrap">
        {locked ? (
          <>
            <button
              type="button"
              onClick={() => setWhyOpen((v) => !v)}
              aria-expanded={whyOpen}
              data-testid={`hook-why-${hook.id}`}
              className="text-xs text-zinc-400 hover:text-white flex items-center gap-1"
            >
              <HelpCircle className="w-3 h-3" aria-hidden="true" />
              Why?
            </button>
            {whyOpen && (
              <p className="text-xs text-zinc-400 basis-full" data-testid={`hook-why-text-${hook.id}`}>
                Needs a sourced stat. This idea's trend context has no sources yet — run research
                or pick a trend with sources, then this hook unlocks.
              </p>
            )}
          </>
        ) : selected ? (
          <Button
            variant="outline"
            size="sm"
            onClick={onRemove}
            data-testid={`hook-remove-${hook.id}`}
            className="border-white/10 text-white hover:bg-white/5"
          >
            <XIcon />
            Remove
          </Button>
        ) : hasOriginal ? (
          <Button
            variant="outline"
            size="sm"
            onClick={onSwap}
            disabled={swapping}
            data-testid={`hook-swap-${hook.id}`}
            className="border-white/10 text-white hover:bg-white/5"
          >
            {swapping ? (
              <>
                <Loader2 className="w-3 h-3 animate-spin" aria-hidden="true" />
                Swapping…
              </>
            ) : (
              <>
                <RefreshCw className="w-3 h-3" aria-hidden="true" />
                Swap into draft
              </>
            )}
          </Button>
        ) : (
          <Button
            size="sm"
            onClick={onUse}
            data-testid={`hook-use-${hook.id}`}
            className="bg-lime text-void hover:bg-lime-hover"
          >
            <MousePointerClick className="w-3 h-3" aria-hidden="true" />
            Use hook
          </Button>
        )}
        {hook.is_builtin && (
          <Button
            variant="outline"
            size="sm"
            onClick={onSaveCopy}
            disabled={copying}
            data-testid={`hook-save-copy-${hook.id}`}
            className="border-white/10 text-white hover:bg-white/5"
          >
            {copying ? (
              <>
                <Loader2 className="w-3 h-3 animate-spin" aria-hidden="true" />
                Saving…
              </>
            ) : (
              <>
                <Copy className="w-3 h-3" aria-hidden="true" />
                Save a copy
              </>
            )}
          </Button>
        )}
        {isUserHook && !editing && !deleteConfirmOpen && (
          <>
            <Button
              variant="outline"
              size="sm"
              onClick={onStartEdit}
              data-testid={`hook-edit-${hook.id}`}
              className="border-white/10 text-white hover:bg-white/5"
            >
              <Pencil className="w-3 h-3" aria-hidden="true" />
              Edit
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={onRequestDelete}
              data-testid={`hook-delete-${hook.id}`}
              className="border-red-500/40 text-red-400 hover:bg-red-500/10"
            >
              <Trash2 className="w-3 h-3" aria-hidden="true" />
              Delete
            </Button>
          </>
        )}
      </div>

      {isUserHook && deleteConfirmOpen && (
        <div
          className="mt-3 space-y-2"
          data-testid={`hook-delete-confirm-${hook.id}`}
          role="alertdialog"
          aria-label="Confirm hook deletion"
        >
          <p className="text-sm text-zinc-300">{DELETE_CONFIRM_TEXT}</p>
          <div className="flex gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={onConfirmDelete}
              disabled={deleting}
              data-testid={`hook-delete-confirm-btn-${hook.id}`}
              className="border-red-500/40 text-red-400 hover:bg-red-500/10"
            >
              {deleting ? (
                <>
                  <Loader2 className="w-3 h-3 animate-spin" aria-hidden="true" />
                  Deleting…
                </>
              ) : (
                <>
                  <Trash2 className="w-3 h-3" aria-hidden="true" />
                  Delete hook
                </>
              )}
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={onCancelDelete}
              disabled={deleting}
              data-testid={`hook-delete-cancel-${hook.id}`}
              className="text-zinc-400 hover:text-white"
            >
              Cancel
            </Button>
          </div>
        </div>
      )}

      {isUserHook && editing && (
        <div className="mt-3 space-y-2" data-testid={`hook-edit-form-${hook.id}`}>
          <label
            htmlFor={`hook-edit-input-${hook.id}`}
            className="block text-xs text-zinc-400"
          >
            Edit your pattern
          </label>
          <Textarea
            id={`hook-edit-input-${hook.id}`}
            value={editValue}
            onChange={(e) => onEditChange(e.target.value)}
            rows={2}
            disabled={savingEdit}
            data-testid={`hook-edit-input-${hook.id}`}
            className="bg-void border-white/10 text-white text-sm"
            aria-invalid={editError ? "true" : undefined}
            aria-describedby={editError ? `hook-edit-error-${hook.id}` : undefined}
          />
          {editError && (
            <p className="text-xs text-red-400" data-testid={`hook-edit-error-${hook.id}`}>
              {editError}
            </p>
          )}
          <div className="flex gap-2">
            <Button
              size="sm"
              onClick={onSaveEdit}
              disabled={savingEdit}
              data-testid={`hook-edit-save-${hook.id}`}
              className="bg-lime text-void hover:bg-lime-hover"
            >
              {savingEdit ? (
                <>
                  <Loader2 className="w-3 h-3 animate-spin" aria-hidden="true" />
                  Saving…
                </>
              ) : (
                "Save changes"
              )}
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={onCancelEdit}
              disabled={savingEdit}
              data-testid={`hook-edit-cancel-${hook.id}`}
              className="text-zinc-400 hover:text-white"
            >
              Cancel
            </Button>
          </div>
        </div>
      )}
    </li>
  );
};

const XIcon = () => <Check className="w-3 h-3 mr-1" aria-hidden="true" />;

const HookPicker = ({ format, selectedHookId, onSelect, originalPost, onSwapped, hasSourcedClaims = false, idea = null, tone = "professional" }) => {
  const [phase, setPhase] = useState("loading"); // loading | error | ready
  const [hooks, setHooks] = useState([]);
  const [styleFilter, setStyleFilter] = useState("all");
  const [mineOnly, setMineOnly] = useState(false);
  const [swappingId, setSwappingId] = useState(null);
  const [copyingId, setCopyingId] = useState(null);
  const [editingId, setEditingId] = useState(null);
  const [editPattern, setEditPattern] = useState("");
  const [editError, setEditError] = useState(null);
  const [savingEdit, setSavingEdit] = useState(false);
  const [deleteConfirmId, setDeleteConfirmId] = useState(null);
  const [deletingId, setDeletingId] = useState(null);

  const apiFormat = toApiFormat(format);

  const fetchHooks = async () => {
    const data = await api.get(`/hooks?format=${apiFormat}`);
    setHooks(Array.isArray(data?.hooks) ? data.hooks : []);
  };

  const load = async () => {
    setPhase("loading");
    // Any reload (format switch, retry) starts the CRUD surfaces clean.
    setEditingId(null);
    setEditError(null);
    setEditPattern("");
    setDeleteConfirmId(null);
    try {
      await fetchHooks();
      setPhase("ready");
    } catch (error) {
      setPhase("error");
      toast.error(error.message);
    }
  };

  // Post-mutation reload: a create/edit/delete that succeeded must not flash
  // the full skeleton — only a failed re-read escalates to the error state
  // (whose copy already says the saved data is safe).
  const refresh = async () => {
    try {
      await fetchHooks();
    } catch (error) {
      setPhase("error");
      toast.error(error.message);
    }
  };

  useEffect(() => {
    setStyleFilter("all");
    setMineOnly(false);
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [apiFormat]);

  const styles = useMemo(
    () => [...new Set(hooks.map((h) => h.style).filter(Boolean))],
    [hooks],
  );

  const hasUserHooks = useMemo(() => hooks.some((h) => !h.is_builtin), [hooks]);

  const filtered = useMemo(
    () =>
      hooks.filter((h) => {
        if (mineOnly && h.is_builtin) return false;
        if (styleFilter !== "all" && h.style !== styleFilter) return false;
        return true;
      }),
    [hooks, styleFilter, mineOnly],
  );

  const swap = async (hook) => {
    if (!originalPost) return;
    setSwappingId(hook.id);
    try {
      const data = await api.post("/swap-hook", {
        // SwapHookRequest contract: original_post, hook_id, idea, format, tone —
        // the rewrite conditions the new opener on the same idea evidence.
        original_post: originalPost,
        hook_id: hook.id,
        idea,
        format: apiFormat,
        tone,
      });
      onSwapped?.(data.post);
      toast.success(`Swapped in hook ${hook.id}`);
    } catch (error) {
      toast.error(error.message);
    } finally {
      setSwappingId(null);
    }
  };

  // Save a copy (built-ins only): duplicates the pattern into the user's set
  // via the existing POST /hooks route — built-ins stay read-only. The
  // backend re-derives the requires_source tag; the copy carries the
  // original's style/format so the Mine view keeps the same axes.
  const saveCopy = async (hook) => {
    setCopyingId(hook.id);
    try {
      await api.post("/hooks", {
        text_pattern: hook.text_pattern,
        style: hook.style,
        format: hook.format,
        tags: hook.tags ?? [],
      });
      toast.success("Copy saved to your Mine set — edit it there.");
      await refresh();
      // Reveal the duplicate where the toast says it lives. Only after the
      // refresh lands, so Mine never flashes its empty state.
      setMineOnly(true);
    } catch (error) {
      toast.error(error.message);
    } finally {
      setCopyingId(null);
    }
  };

  // Edit (user hooks only): the editor opens pre-filled with the row's
  // pattern; a failed PUT keeps the user's text on screen — nothing lost.
  const startEdit = (hook) => {
    setEditingId(hook.id);
    setEditPattern(hook.text_pattern);
    setEditError(null);
    setDeleteConfirmId(null);
  };

  const cancelEdit = () => {
    setEditingId(null);
    setEditPattern("");
    setEditError(null);
  };

  const saveEdit = async (hook) => {
    const pattern = editPattern.trim();
    if (pattern.length < PATTERN_MIN) {
      setEditError(PATTERN_TOO_SHORT);
      return;
    }
    if (pattern.length > PATTERN_MAX) {
      setEditError(PATTERN_TOO_LONG);
      return;
    }
    setSavingEdit(true);
    try {
      // HookUpdate forbids extra fields (models/hooks.py) — the pattern is
      // the only editable axis; style/format/tags stay as saved.
      await api.put(`/hooks/${hook.id}`, { text_pattern: pattern });
      toast.success("Hook updated.");
      cancelEdit();
      await refresh();
    } catch (error) {
      toast.error(error.message);
    } finally {
      setSavingEdit(false);
    }
  };

  // Delete (user hooks only): inline two-step confirm — the app's existing
  // pattern (VoiceDNAEditor's re-extract confirm). First click asks, the
  // second commits; Cancel makes no request.
  const requestDelete = (hook) => {
    setDeleteConfirmId(hook.id);
    setEditingId(null);
    setEditError(null);
  };

  const confirmDelete = async (hook) => {
    setDeletingId(hook.id);
    try {
      await api.delete(`/hooks/${hook.id}`);
      toast.success("Hook deleted.");
      setDeleteConfirmId(null);
      await refresh();
    } catch (error) {
      toast.error(error.message);
    } finally {
      setDeletingId(null);
    }
  };

  return (
    <div className="glass-card rounded-xl p-6 mb-8" data-testid="hook-picker">
      <h3 className="font-heading text-xl font-semibold text-white mb-1">
        Hooks for your {formatLabel(format)} post
      </h3>
      <p className="text-zinc-400 text-sm mb-4">
        Pick the opener pattern — it governs the first line only.
      </p>

      {phase === "loading" && (
        <p className="text-zinc-400 text-sm flex items-center gap-2" data-testid="hooks-loading" aria-busy="true">
          <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" />
          Loading hooks…
        </p>
      )}

      {phase === "error" && (
        <div data-testid="hooks-error" role="alert">
          <p className="text-white text-sm font-medium mb-1">The hook library didn't load.</p>
          <p className="text-zinc-400 text-sm mb-3">
            Nothing was changed — built-ins and your saved patterns are safe in the database.
            Retry brings the list back.
          </p>
          <Button
            onClick={load}
            variant="outline"
            size="sm"
            data-testid="hooks-retry-btn"
            className="border-white/10 text-white hover:bg-white/5"
          >
            Retry
          </Button>
        </div>
      )}

      {phase === "ready" && (
        <>
          {/* Filter chips: All + styles present in the loaded format + Mine. */}
          <div className="flex items-center gap-2 flex-wrap mb-4" role="group" aria-label="Filter hooks by style">
            {[
              { id: "all", label: "All" },
              ...styles.map((s) => ({ id: s, label: styleLabel(s) })),
            ].map((chip) => (
              <button
                key={chip.id}
                type="button"
                onClick={() =>
                  setStyleFilter(styleFilter === chip.id ? "all" : chip.id)
                }
                aria-pressed={styleFilter === chip.id}
                data-testid={`hook-style-chip-${chip.id}`}
                className={`text-xs rounded-full px-3 py-1 border ${
                  styleFilter === chip.id && !mineOnly
                    ? "border-lime text-lime bg-lime/10"
                    : "border-white/10 text-zinc-400 hover:text-white hover:bg-white/5"
                }`}
              >
                {chip.label}
              </button>
            ))}
            <button
              type="button"
              onClick={() => setMineOnly((v) => !v)}
              aria-pressed={mineOnly}
              data-testid="hook-mine-chip"
              className={`text-xs rounded-full px-3 py-1 border ${
                mineOnly
                  ? "border-lime text-lime bg-lime/10"
                  : "border-white/10 text-zinc-400 hover:text-white hover:bg-white/5"
              }`}
            >
              Mine
            </button>
          </div>

          {/* Swap mode's cost line lives in the action's own panel (§6.5). */}
          {originalPost && (
            <p className="text-xs text-zinc-400 font-mono mb-4" data-testid="hooks-swap-cost-hint">
              {SWAP_COST_HINT}
            </p>
          )}

          {filtered.length === 0 ? (
            // §6.2 distinguishes the two empties: "no saved hooks" is the
            // Mine view with nothing saved; "no match" is filters excluding
            // everything (reachable once user hooks exist).
            mineOnly && !hasUserHooks ? (
              <div data-testid="hooks-empty-mine">
                <p className="text-white text-sm font-medium mb-1">
                  You haven't saved any hooks yet.
                </p>
                <p className="text-zinc-400 text-sm mb-3">
                  Use &quot;Save a copy&quot; on any built-in pattern — your copy lands here,
                  where Edit and Delete work on it.
                </p>
                <Button
                  onClick={() => setMineOnly(false)}
                  variant="outline"
                  size="sm"
                  data-testid="hooks-browse-builtins-btn"
                  className="border-white/10 text-white hover:bg-white/5"
                >
                  Browse built-ins
                </Button>
              </div>
            ) : (
              <div data-testid="hooks-empty-filtered">
                <p className="text-white text-sm font-medium mb-1">
                  No hooks match &quot;{styleLabel(styleFilter)}&quot;.
                </p>
                <p className="text-zinc-400 text-sm mb-3">
                  Clear the filters, or save your own pattern — user hooks live alongside the
                  built-ins.
                </p>
                <Button
                  onClick={() => {
                    // "Clear the filters" clears everything — leaving Mine
                    // on would drop the user right back into a filtered view.
                    setStyleFilter("all");
                    setMineOnly(false);
                  }}
                  variant="outline"
                  size="sm"
                  data-testid="hooks-clear-filters-btn"
                  className="border-white/10 text-white hover:bg-white/5"
                >
                  Clear filters
                </Button>
              </div>
            )
          ) : (
            <ul className="space-y-3" aria-label="Hook patterns">
              {filtered.map((hook) => {
                const locked = hook.tags?.includes("requires_source") && !hasSourcedClaims;
                return (
                  <HookRow
                    key={hook.id}
                    hook={hook}
                    locked={locked}
                    selected={selectedHookId === hook.id}
                    hasOriginal={Boolean(originalPost)}
                    swapping={swappingId === hook.id}
                    copying={copyingId === hook.id}
                    editing={editingId === hook.id}
                    editValue={editingId === hook.id ? editPattern : ""}
                    editError={editingId === hook.id ? editError : null}
                    savingEdit={savingEdit}
                    onEditChange={setEditPattern}
                    onStartEdit={() => startEdit(hook)}
                    onSaveEdit={() => saveEdit(hook)}
                    onCancelEdit={cancelEdit}
                    deleteConfirmOpen={deleteConfirmId === hook.id}
                    deleting={deletingId === hook.id}
                    onRequestDelete={() => requestDelete(hook)}
                    onConfirmDelete={() => confirmDelete(hook)}
                    onCancelDelete={() => setDeleteConfirmId(null)}
                    onUse={() => onSelect?.(hook.id)}
                    onRemove={() => onSelect?.(null)}
                    onSwap={() => swap(hook)}
                    onSaveCopy={() => saveCopy(hook)}
                  />
                );
              })}
            </ul>
          )}
        </>
      )}
    </div>
  );
};

export default HookPicker;
