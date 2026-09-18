import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { api } from "@/api/client";
import { POST_FORMATS } from "@/lib/constants";
import { Check, HelpCircle, Loader2, Lock, MousePointerClick, RefreshCw } from "lucide-react";

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

const styleLabel = (style) => String(style ?? "").replace(/_/g, " ");

const formatLabel = (id) => POST_FORMATS.find((f) => f.id === id)?.name ?? id;

// Backend hook formats are snake_case enums; frontend POST_FORMATS ids are
// kebab-case (models/hooks.py maps the two).
const toApiFormat = (id) => String(id ?? "").replace(/-/g, "_");

const HookRow = ({ hook, locked, selected, hasOriginal, swapping, onUse, onRemove, onSwap }) => {
  const [whyOpen, setWhyOpen] = useState(false);
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
      </div>
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

  const apiFormat = toApiFormat(format);

  const load = async () => {
    setPhase("loading");
    try {
      const data = await api.get(`/hooks?format=${apiFormat}`);
      setHooks(Array.isArray(data?.hooks) ? data.hooks : []);
      setPhase("ready");
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
        post: originalPost,
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
                  Duplicate any built-in pattern with your own tweak and save it — your version
                  keeps the same style and format tags.
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
                    onUse={() => onSelect?.(hook.id)}
                    onRemove={() => onSelect?.(null)}
                    onSwap={() => swap(hook)}
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
