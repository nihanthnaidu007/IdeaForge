import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { api } from "@/api/client";
import {
  Check,
  ChevronDown,
  History,
  Loader2,
  RefreshCw,
  Sparkles,
  Trash2,
  X,
} from "lucide-react";

// Voice DNA editor, per the UI & Copy Craft Pack §6.3 + §3.5: empty state
// (paste box + consent line + cost hint), extraction progress, honest
// failure, confidence chip, do/don't editing, notes, version history with
// restore-as-save. §3.5 law: restore is a normal save that appends a new
// version — history is never rewritten.
//
// Cost copy: the AI Craft Pack §6 owns these strings. Its {est_usd} slot is
// filled by a backend price table that does not exist yet, and the pack's
// implementation note forbids a fabricated number — so the estimate clause
// uses the sanctioned fallback ("cost depends on your provider pricing").
const EXTRACT_COST_HINT =
  "Voice extraction runs one model call on your key — cost depends on your provider pricing. You can re-run it anytime; each run costs the same.";
const RE_EXTRACT_CONFIRM =
  "Re-running extraction costs the same as the first run on your key. The current profile stays until the new one is saved.";

const EMPTY_TITLE = "IdeaForge doesn't know your voice yet.";
const EMPTY_BODY =
  "Paste 3–5 of your own past posts. Extraction pulls out your structure, vocabulary, energy, and signature moves — retrieval into every prompt, no fine-tuning. Nobody else's posts, ever: samples must be yours.";

const confidenceTier = (value) => {
  if (typeof value !== "number") return "low";
  if (value >= 0.8) return "high";
  if (value >= 0.5) return "mid";
  return "low";
};

const CONFIDENCE_COPY = {
  high: "Confident — this profile is built on your real posts and matches them closely.",
  mid: "Decent confidence — it fits you, but a few fields are guesses. Read them and correct what's off.",
  low: "Low confidence — your samples may have been too few or too similar. Add more posts and re-extract for a sharper profile.",
};

const CONFIDENCE_CHIP = {
  high: { label: "Confident", className: "text-rating-high border-rating-high/30 bg-rating-high/10" },
  mid: { label: "Decent confidence", className: "text-rating-mid border-rating-mid/30 bg-rating-mid/10" },
  low: { label: "Low confidence", className: "text-rating-low border-rating-low/30 bg-rating-low/10" },
};

const formatDate = (iso) => {
  if (!iso) return "unknown date";
  try {
    return new Date(iso).toLocaleDateString(undefined, {
      year: "numeric",
      month: "short",
      day: "numeric",
    });
  } catch {
    return "unknown date";
  }
};

// Do/don't list editor: rows with Remove, an Add row that appends. The
// backend caps both lists at 8 items (VoiceProfileEdit).
const ListEditor = ({ label, items, onChange, testIdPrefix }) => {
  const [draft, setDraft] = useState("");

  const add = () => {
    const value = draft.trim();
    if (!value) return;
    if (items.length >= 8) return;
    onChange([...items, value]);
    setDraft("");
  };

  return (
    <div className="space-y-2">
      <p className="text-sm text-zinc-400">{label}</p>
      {items.length === 0 && (
        <p className="text-xs text-zinc-500">Nothing here yet — add the first rule.</p>
      )}
      <ul className="space-y-2" aria-label={label} data-testid={`${testIdPrefix}-list`}>
        {items.map((item, i) => (
          <li
            key={`${item}-${i}`}
            className="flex items-start justify-between gap-3 bg-void border border-white/10 rounded-lg px-3 py-2"
          >
            <span className="text-sm text-white">{item}</span>
            <button
              type="button"
              onClick={() => onChange(items.filter((_, j) => j !== i))}
              data-testid={`${testIdPrefix}-remove-${i}`}
              className="text-zinc-400 hover:text-red-400 flex-shrink-0 mt-0.5"
              aria-label={`Remove rule: ${item}`}
            >
              <Trash2 className="w-4 h-4" aria-hidden="true" />
            </button>
          </li>
        ))}
      </ul>
      <div className="flex gap-2">
        <input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              add();
            }
          }}
          data-testid={`${testIdPrefix}-add-input`}
          placeholder="Add a rule the drafts should follow…"
          className="flex-1 bg-void border border-white/10 rounded-lg px-3 py-2 text-sm text-white placeholder:text-zinc-500"
        />
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={add}
          disabled={!draft.trim() || items.length >= 8}
          data-testid={`${testIdPrefix}-add-btn`}
          className="border-white/10 text-white hover:bg-white/5"
        >
          Add
        </Button>
      </div>
    </div>
  );
};

const ProfileField = ({ label, value, testId }) => {
  if (!value) return null;
  return (
    <div data-testid={testId}>
      <p className="text-xs uppercase tracking-wide text-zinc-500 mb-1">{label}</p>
      <p className="text-sm text-white">{value}</p>
    </div>
  );
};

const VoiceDNAEditor = () => {
  const [phase, setPhase] = useState("loading"); // loading | error | empty | ready
  const [loadError, setLoadError] = useState(null);
  const [active, setActive] = useState(null); // active version response body
  const [samplesText, setSamplesText] = useState("");
  const [extracting, setExtracting] = useState(false);
  const [extractError, setExtractError] = useState(null);
  const [confirmReextract, setConfirmReextract] = useState(false);
  const [doList, setDoList] = useState([]);
  const [dontList, setDontList] = useState([]);
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [history, setHistory] = useState(null); // null = not loaded
  const [historyLoading, setHistoryLoading] = useState(false);
  const [restoringVersion, setRestoringVersion] = useState(null);

  const applyResponse = useCallback((data) => {
    setActive(data);
    setDoList(Array.isArray(data.do_list) ? data.do_list : []);
    setDontList(Array.isArray(data.dont_list) ? data.dont_list : []);
    setNotes(data.notes ?? "");
  }, []);

  const loadProfile = useCallback(async () => {
    setPhase("loading");
    setLoadError(null);
    try {
      const data = await api.get("/voice/profile");
      if (!data?.profile) {
        setPhase("empty");
        return;
      }
      applyResponse(data);
      setPhase("ready");
    } catch (error) {
      setLoadError(error);
      setPhase("error");
    }
  }, [applyResponse]);

  useEffect(() => {
    loadProfile();
  }, [loadProfile]);

  // Samples split on blank lines — the paste box's only parsing rule.
  const samples = useMemo(
    () =>
      samplesText
        .split(/\n\s*\n/)
        .map((s) => s.trim())
        .filter(Boolean),
    [samplesText],
  );

  const extract = async () => {
    if (samples.length < 3 || samples.length > 5) return;
    setExtracting(true);
    setExtractError(null);
    try {
      const data = await api.post("/voice/profile", { samples });
      applyResponse(data);
      setSamplesText("");
      setConfirmReextract(false);
      setHistory(null); // re-fetch next open — a new version landed
      setPhase("ready");
      toast.success("Voice profile extracted");
    } catch (error) {
      setExtractError(error);
      toast.error(error.message);
    } finally {
      setExtracting(false);
    }
  };

  const dirty = useMemo(() => {
    if (!active) return false;
    const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
    return (
      !same(doList, active.do_list ?? []) ||
      !same(dontList, active.dont_list ?? []) ||
      notes !== (active.notes ?? "")
    );
  }, [active, doList, dontList, notes]);

  const saveEdits = async () => {
    setSaving(true);
    try {
      const data = await api.put("/voice/profile", {
        do_list: doList,
        dont_list: dontList,
        notes,
      });
      applyResponse(data);
      setHistory(null);
      toast.success("Voice profile saved");
    } catch (error) {
      toast.error(error.message);
    } finally {
      setSaving(false);
    }
  };

  const loadHistory = async () => {
    setHistoryLoading(true);
    try {
      const data = await api.get("/voice/profile/versions");
      setHistory(Array.isArray(data?.versions) ? data.versions : []);
    } catch (error) {
      toast.error(error.message);
    } finally {
      setHistoryLoading(false);
    }
  };

  const toggleHistory = () => {
    const next = !historyOpen;
    setHistoryOpen(next);
    if (next && history === null) loadHistory();
  };

  // §3.5: restore is a normal save that appends a new version — the restore
  // action PUTs the old version's editable fields; history is never rewritten.
  const restoreVersion = async (v) => {
    setRestoringVersion(v.version);
    try {
      const data = await api.put("/voice/profile", {
        do_list: v.do_list ?? [],
        dont_list: v.dont_list ?? [],
        notes: v.notes ?? "",
      });
      applyResponse(data);
      setHistory(null);
      loadHistory();
      toast.success(`Version ${v.version} restored as the new active version`);
    } catch (error) {
      toast.error(error.message);
    } finally {
      setRestoringVersion(null);
    }
  };

  if (phase === "loading") {
    return (
      <div className="glass-card rounded-xl p-6" data-testid="voice-dna-loading" aria-busy="true">
        <h2 className="font-heading text-xl font-semibold text-white mb-2">Voice DNA</h2>
        <p className="text-zinc-400 text-sm flex items-center gap-2">
          <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" />
          Loading your voice profile…
        </p>
      </div>
    );
  }

  if (phase === "error") {
    return (
      <div className="glass-card rounded-xl p-6" data-testid="voice-dna-error" role="alert">
        <h2 className="font-heading text-xl font-semibold text-white mb-2">Voice DNA</h2>
        <p className="text-zinc-400 text-sm mb-4">
          {loadError?.message ?? "The profile didn't load."}
        </p>
        <Button
          onClick={loadProfile}
          variant="outline"
          className="border-white/10 text-white hover:bg-white/5"
          data-testid="voice-dna-retry-btn"
        >
          Retry
        </Button>
      </div>
    );
  }

  const style = active?.profile ?? null;

  return (
    <div className="glass-card rounded-xl p-6" data-testid="voice-dna-editor">
      <div className="flex items-start justify-between gap-4 mb-4">
        <div>
          <h2 className="font-heading text-xl font-semibold text-white">Voice DNA</h2>
          <p className="text-zinc-400 text-sm mt-1">
            Your trained voice conditions every generated post.
          </p>
        </div>
        {phase === "ready" && (
          <Button
            onClick={toggleHistory}
            variant="ghost"
            size="sm"
            className="text-zinc-400 hover:text-white flex-shrink-0"
            data-testid="voice-history-toggle"
            aria-expanded={historyOpen}
          >
            <History className="w-4 h-4 mr-1" aria-hidden="true" />
            History
            <ChevronDown
              className={`w-4 h-4 ml-1 transition-transform ${historyOpen ? "rotate-180" : ""}`}
              aria-hidden="true"
            />
          </Button>
        )}
      </div>

      {/* Version history drawer (§6.3): newest first; current version marked. */}
      {phase === "ready" && historyOpen && (
        <div
          className="mb-6 border border-white/10 rounded-xl p-4 bg-void"
          data-testid="voice-history"
        >
          <p className="text-sm text-zinc-400 mb-3">
            Version history — restoring applies that version's rules as a new save.
          </p>
          {historyLoading && (
            <p className="text-zinc-400 text-sm flex items-center gap-2">
              <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" />
              Loading versions…
            </p>
          )}
          {!historyLoading && history && history.length === 0 && (
            <p className="text-zinc-400 text-sm">No versions recorded yet.</p>
          )}
          {!historyLoading &&
            history &&
            history.length > 0 && (
              <ul className="space-y-2">
                {history.map((v) => {
                  const isCurrent = v.version === active?.version;
                  return (
                    <li
                      key={v.version}
                      className="flex items-center justify-between gap-3 bg-deep border border-white/10 rounded-lg px-3 py-2"
                    >
                      <span className="text-sm text-zinc-300">
                        {formatDate(v.extracted_at)} · {v.sample_count ?? "?"} posts analyzed ·
                        confidence {confidenceTier(v.confidence)}
                      </span>
                      {isCurrent ? (
                        <span
                          className="text-xs text-lime flex items-center gap-1 flex-shrink-0"
                          data-testid={`voice-version-${v.version}-current`}
                        >
                          <Check className="w-3 h-3" aria-hidden="true" />
                          Current
                        </span>
                      ) : (
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => restoreVersion(v)}
                          disabled={restoringVersion !== null}
                          data-testid={`voice-restore-${v.version}-btn`}
                          className="border-white/10 text-white hover:bg-white/5 flex-shrink-0"
                        >
                          {restoringVersion === v.version ? "Restoring…" : "Restore this version"}
                        </Button>
                      )}
                    </li>
                  );
                })}
              </ul>
            )}
        </div>
      )}

      {phase === "empty" && (
        <div data-testid="voice-dna-empty">
          <h3 className="text-white font-medium mb-2">{EMPTY_TITLE}</h3>
          <p className="text-zinc-400 text-sm mb-4">{EMPTY_BODY}</p>
          <Textarea
            value={samplesText}
            onChange={(e) => setSamplesText(e.target.value)}
            data-testid="voice-samples-input"
            placeholder={"Paste your past posts here, one per block, separated by a blank line…"}
            className="bg-void border-white/10 text-white min-h-[160px]"
            disabled={extracting}
          />
          <p className="text-xs text-zinc-500 mt-2" data-testid="voice-sample-count" aria-live="polite">
            {samples.length === 0
              ? "3–5 posts pasted = enough material."
              : `${samples.length} post${samples.length === 1 ? "" : "s"} detected.`}
            {samples.length > 5 ? " 5 max — use your strongest posts." : ""}
          </p>
          <p className="text-xs text-zinc-400 mt-3" data-testid="voice-cost-hint">
            {EXTRACT_COST_HINT}
          </p>
          {extractError && (
            <div className="mt-4 border border-red-500/30 rounded-lg p-4" role="alert" data-testid="voice-extract-error">
              {extractError.kind === "missing_key" ? (
                <>
                  <p className="text-white text-sm font-medium mb-1">No generation key connected.</p>
                  <p className="text-zinc-400 text-sm mb-3">
                    Extraction runs on Anthropic or OpenAI. Add a key in Settings — it bills only to
                    your own account.
                  </p>
                </>
              ) : (
                <>
                  <p className="text-white text-sm font-medium mb-1">Voice extraction failed.</p>
                  <p className="text-zinc-400 text-sm mb-3">
                    Nothing was saved. If your samples are very short or very alike, add one more
                    post and try again.
                  </p>
                </>
              )}
              <Button
                onClick={extract}
                disabled={samples.length < 3 || samples.length > 5}
                className="bg-lime text-void hover:bg-lime-hover"
                data-testid="voice-retry-btn"
              >
                Retry
              </Button>
            </div>
          )}
          <Button
            onClick={extract}
            disabled={extracting || samples.length < 3 || samples.length > 5}
            data-testid="voice-extract-btn"
            className="mt-4 bg-lime text-void hover:bg-lime-hover"
          >
            {extracting ? (
              <span className="flex items-center gap-2">
                <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" />
                Reading how you write — structure, vocabulary, energy…
              </span>
            ) : (
              <span className="flex items-center gap-2">
                <Sparkles className="w-4 h-4" aria-hidden="true" />
                Train Voice DNA
              </span>
            )}
          </Button>
          {extracting && (
            <p className="text-xs text-zinc-400 mt-2" aria-live="polite">
              This runs one model call on your key. The profile is editable after.
            </p>
          )}
        </div>
      )}

      {phase === "ready" && style && (
        <div data-testid="voice-dna-profile">
          {/* Confidence chip: the word, never the decimal — §3.4. */}
          <span
            className={`inline-flex items-center gap-1 text-xs border rounded-full px-3 py-1 mb-4 ${
              CONFIDENCE_CHIP[confidenceTier(active.confidence)].className
            }`}
            data-testid="voice-confidence-chip"
          >
            {CONFIDENCE_CHIP[confidenceTier(active.confidence)].label}
          </span>
          <p className="text-sm text-zinc-400 mb-6" data-testid="voice-confidence-copy">
            {CONFIDENCE_COPY[confidenceTier(active.confidence)]}
          </p>

          <div className="grid md:grid-cols-2 gap-4 mb-6">
            <div className="space-y-3">
              <ProfileField
                label="Opening"
                value={style?.structure?.opening_pattern}
                testId="voice-opening"
              />
              <ProfileField
                label="Body"
                value={style?.structure?.body_pattern}
                testId="voice-body"
              />
              <ProfileField
                label="Closing"
                value={style?.structure?.closing_pattern}
                testId="voice-closing"
              />
              <ProfileField
                label="Vocabulary"
                value={style?.vocabulary?.register}
                testId="voice-vocabulary"
              />
            </div>
            <div className="space-y-3">
              <ProfileField
                label="Energy"
                value={
                  style?.energy
                    ? `${style.energy.overall_level ?? "?"}/10 — ${style.energy.punctuation_style ?? ""}`
                    : null
                }
                testId="voice-energy"
              />
              <ProfileField
                label="Rhythm"
                value={
                  active.sentence_rhythm
                    ? `${active.sentence_rhythm.avg_sentence_length_words ?? "?"} words per sentence on average; fragments ${active.sentence_rhythm.fragment_use ?? "unknown"}.`
                    : null
                }
                testId="voice-rhythm"
              />
            </div>
          </div>

          {Array.isArray(style?.signature_moves) && style.signature_moves.length > 0 && (
            <div className="mb-6" data-testid="voice-signature-moves">
              <p className="text-xs uppercase tracking-wide text-zinc-500 mb-2">Signature moves</p>
              <ul className="space-y-2">
                {style.signature_moves.map((m, i) => (
                  <li key={i} className="bg-void border border-white/10 rounded-lg px-3 py-2">
                    <p className="text-sm text-white">{m.move}</p>
                    {m.evidence && (
                      <p className="text-xs text-zinc-500 mt-1 italic">&quot;{m.evidence}&quot;</p>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          )}

          <div className="grid md:grid-cols-2 gap-6 mb-6">
            <ListEditor
              label="Do — rules the drafts should follow"
              items={doList}
              onChange={setDoList}
              testIdPrefix="voice-do"
            />
            <ListEditor
              label="Don't — what your posts never do"
              items={dontList}
              onChange={setDontList}
              testIdPrefix="voice-dont"
            />
          </div>

          <div className="mb-6">
            <label htmlFor="voice-notes" className="text-sm text-zinc-400 mb-2 block">
              Notes
            </label>
            <Textarea
              id="voice-notes"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              data-testid="voice-notes-input"
              className="bg-void border-white/10 text-white min-h-[80px]"
            />
            <p className="text-xs text-zinc-500 mt-1">
              What the extraction missed about your voice — future drafts read this.
            </p>
          </div>

          <div className="flex items-center gap-3 flex-wrap">
            <Button
              onClick={saveEdits}
              disabled={saving || !dirty}
              data-testid="voice-save-btn"
              className="bg-lime text-void hover:bg-lime-hover disabled:opacity-50"
            >
              {saving ? "Saving…" : "Save changes"}
            </Button>
            <Button
              onClick={() => {
                setDoList(Array.isArray(active.do_list) ? active.do_list : []);
                setDontList(Array.isArray(active.dont_list) ? active.dont_list : []);
                setNotes(active.notes ?? "");
              }}
              disabled={saving || !dirty}
              variant="ghost"
              className="text-zinc-400 hover:text-white"
              data-testid="voice-discard-btn"
            >
              <X className="w-4 h-4 mr-1" aria-hidden="true" />
              Discard
            </Button>
            {dirty && (
              <span className="text-xs text-rating-mid" data-testid="voice-dirty-indicator" aria-live="polite">
                Unsaved changes
              </span>
            )}
          </div>

          <div className="mt-6 pt-6 border-t border-white/10">
            {!confirmReextract ? (
              <Button
                onClick={() => setConfirmReextract(true)}
                variant="outline"
                size="sm"
                data-testid="voice-reextract-btn"
                className="border-white/10 text-white hover:bg-white/5"
              >
                <RefreshCw className="w-4 h-4 mr-1" aria-hidden="true" />
                Re-extract from new samples
              </Button>
            ) : (
              <div className="space-y-3" data-testid="voice-reextract-confirm">
                <p className="text-sm text-zinc-300">{RE_EXTRACT_CONFIRM}</p>
                <p className="text-xs text-zinc-400">{EXTRACT_COST_HINT}</p>
                <Textarea
                  value={samplesText}
                  onChange={(e) => setSamplesText(e.target.value)}
                  data-testid="voice-reextract-samples-input"
                  placeholder={"Paste 3–5 of your own posts, separated by a blank line…"}
                  className="bg-void border-white/10 text-white min-h-[140px]"
                  disabled={extracting}
                />
                <p className="text-xs text-zinc-500" aria-live="polite">
                  {samples.length} post{samples.length === 1 ? "" : "s"} detected.
                  {samples.length > 5 ? " 5 max." : ""}
                </p>
                <div className="flex gap-2">
                  <Button
                    onClick={extract}
                    disabled={extracting || samples.length < 3 || samples.length > 5}
                    data-testid="voice-reextract-run-btn"
                    className="bg-lime text-void hover:bg-lime-hover"
                  >
                    {extracting ? (
                      <span className="flex items-center gap-2">
                        <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" />
                        Reading how you write — structure, vocabulary, energy…
                      </span>
                    ) : (
                      "Re-run extraction"
                    )}
                  </Button>
                  <Button
                    onClick={() => {
                      setConfirmReextract(false);
                      setSamplesText("");
                      setExtractError(null);
                    }}
                    disabled={extracting}
                    variant="ghost"
                    className="text-zinc-400 hover:text-white"
                  >
                    Cancel
                  </Button>
                </div>
              </div>
            )}
            {extractError && confirmReextract && (
              <div className="mt-3 border border-red-500/30 rounded-lg p-4" role="alert">
                <p className="text-white text-sm font-medium mb-1">Voice extraction failed.</p>
                <p className="text-zinc-400 text-sm mb-3">
                  Nothing was saved. If your samples are very short or very alike, add one more
                  post and try again.
                </p>
                <Button
                  onClick={extract}
                  disabled={samples.length < 3 || samples.length > 5}
                  className="bg-lime text-void hover:bg-lime-hover"
                >
                  Retry
                </Button>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
};

export default VoiceDNAEditor;
