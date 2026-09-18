import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { AlertTriangle, CheckCircle2, Copy, Monitor, Smartphone } from "lucide-react";
import { Button } from "@/components/ui/button";
import { api, ApiError } from "@/api/client";
import AiBadge from "@/components/common/AiBadge";

// LinkedIn-accurate preview (UI pack §6.1): the draft rendered the way the
// feed will show it, the first-two-lines fold, the character counter, and the
// linter's checks — severity-colored, each one actionable. Checks come from
// the backend linter (one source of truth); if that call fails we say so
// instead of inventing a clean verdict.

const SEVERITY_STYLE = {
  error: { dot: "bg-red-400", text: "text-red-300", icon: AlertTriangle },
  warn: { dot: "bg-amber-400", text: "text-amber-200", icon: AlertTriangle },
  info: { dot: "bg-sky-400", text: "text-sky-200", icon: CheckCircle2 },
};

const DEVICES = [
  { id: "desktop", label: "Desktop", icon: Monitor, maxChars: 210 },
  { id: "phone", label: "Phone", icon: Smartphone, maxChars: 140 },
];

// The fold: what fits before LinkedIn's "…see more" truncation at this
// viewport. Two visible lines (blank separators don't count), re-truncated
// for the selected device so the preview is honest at both sizes.
export function foldPreview(text, maxChars = 210) {
  const joined = String(text ?? "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .slice(0, 2)
    .join("\n");
  if (joined.length > maxChars) {
    return `${joined.slice(0, maxChars - 1).trimEnd()}…`;
  }
  return joined || "—";
}

export default function LinkedInPreviewPane({ text, onCopied }) {
  const [result, setResult] = useState(null);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(false);
  const [device, setDevice] = useState("desktop");
  const debounceRef = useRef(null);

  const runCheck = async (current) => {
    setLoading(true);
    setError(null);
    try {
      const data = await api.post("/preview/linkedin", { text: current });
      setResult(data);
    } catch (err) {
      setResult(null);
      setError(
        err instanceof ApiError
          ? err
          : new ApiError({ status: 0, kind: "unknown", message: "Preview checks failed." }),
      );
    } finally {
      setLoading(false);
    }
  };

  // Debounced lint: checks track the text without a request per keystroke.
  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => runCheck(text), 300);
    return () => clearTimeout(debounceRef.current);
  }, [text]);

  const deviceMax = DEVICES.find((d) => d.id === device)?.maxChars ?? 210;
  const charCount = result?.char_count ?? text.length;
  const charLimit = result?.char_limit ?? 3000;
  const overLimit = charCount > charLimit;
  const nearLimit = !overLimit && charCount >= charLimit * 0.9;

  const copyPost = async () => {
    try {
      await navigator.clipboard.writeText(text);
      // The copy button IS the posting action: pasting into LinkedIn is the
      // user's own hand (UI pack §6.1 — name the boundary).
      toast.success("Copied. Paste it into LinkedIn and post it yourself.");
      onCopied?.();
    } catch {
      toast.error("Copy failed — select the text and copy it manually.");
    }
  };

  return (
    <div className="glass-card rounded-xl p-6" data-testid="linkedin-preview">
      <div className="flex flex-wrap items-center gap-2 mb-4 text-sm text-zinc-400">
        <span>LinkedIn preview</span>
        <AiBadge className="ml-auto" />
      </div>

      <div className="flex gap-2 mb-4">
        {DEVICES.map(({ id, label, icon: Icon }) => (
          <Button
            key={id}
            variant={device === id ? "default" : "outline"}
            onClick={() => setDevice(id)}
            data-testid={`preview-device-${id}`}
            className={
              device === id
                ? "bg-lime text-void hover:bg-lime-hover"
                : "border-white/10 text-white hover:bg-white/5"
            }
          >
            <Icon className="w-4 h-4 mr-2" aria-hidden="true" />
            {label}
          </Button>
        ))}
      </div>

      <div
        data-testid="preview-fold"
        className={`bg-void rounded-lg p-4 border border-white/5 mb-3 ${
          device === "phone" ? "max-w-xs" : ""
        }`}
      >
        <p className="text-[11px] uppercase tracking-wider text-zinc-500 mb-2">
          First impression (before “…see more”)
        </p>
        <p className="post-content text-white/90 font-mono text-sm whitespace-pre-wrap">
          {foldPreview(text, deviceMax)}
        </p>
      </div>

      <p
        data-testid="preview-char-counter"
        className={`text-sm font-mono mb-4 ${
          overLimit ? "text-red-300" : nearLimit ? "text-amber-200" : "text-zinc-400"
        }`}
      >
        {charCount.toLocaleString()} / {charLimit.toLocaleString()} characters
        {overLimit ? " — over the limit" : ""}
      </p>

      {loading && (
        <p data-testid="preview-checks-loading" className="text-sm text-zinc-400">
          Checking…
        </p>
      )}

      {error && !loading && (
        <div data-testid="preview-checks-error" className="mb-4">
          <p className="text-sm text-amber-200 mb-2">
            Preview checks didn&apos;t load — your draft is untouched.
          </p>
          <Button
            variant="outline"
            onClick={() => runCheck(text)}
            data-testid="preview-retry-btn"
            className="border-white/10 text-white hover:bg-white/5"
          >
            Retry
          </Button>
        </div>
      )}

      {result && !loading && (
        <div data-testid="preview-checks">
          {result.clean ? (
            <p className="text-sm text-lime" role="status" aria-live="polite">
              Clean — this is what LinkedIn will show.
            </p>
          ) : (
            <ul className="space-y-2" aria-live="polite">
              {result.checks.map((check) => {
                const style = SEVERITY_STYLE[check.severity] ?? SEVERITY_STYLE.info;
                return (
                  <li key={check.id} className="flex items-start gap-2 text-sm">
                    <span className={`w-2 h-2 rounded-full mt-1.5 shrink-0 ${style.dot}`} aria-hidden="true" />
                    <span className={style.text}>{check.message}</span>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      )}

      <Button
        onClick={copyPost}
        data-testid="preview-copy-btn"
        className="mt-6 bg-lime text-void hover:bg-lime-hover"
      >
        <Copy className="w-4 h-4 mr-2" aria-hidden="true" />
        Copy post
      </Button>
      <p className="text-xs text-zinc-500 mt-3">
        IdeaForge never posts for you — copying is the handoff.
      </p>
    </div>
  );
}
