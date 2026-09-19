import { motion } from "framer-motion";
import { RefreshCw, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { CostHintBanner } from "./VariantCompare";
import TrendCard from "./TrendCard";
import { NICHES, TONES } from "@/lib/constants";

// Inline error strip for a failed per-trend forge (UI pack §3.1 kind map):
// an expired/unknown trend id (typed 404 TRENDS_NOT_FOUND) retries nothing —
// its fix is a fresh research sweep; every other failure retries the forge
// itself. The backend's honest detail sentence is always the body.
export const forgeErrorCopy = (error) =>
  error?.kind === "not_found"
    ? { headline: "This trend isn't cached anymore.", action: "Run fresh research" }
    : { headline: "Forge from this trend failed.", action: "Try again" };

// Trend Radar panel: the live-research trigger. Owns the niche/tone controls
// (moved out of the old dashboard navbar so this is the single source of
// truth for them) and the scanning feedback while research runs. The cost
// hint renders directly above the run button (UI pack §cost-hint placement
// law) — the estimate is on screen before the first spend can fire.
// After a run, the panel renders the trends it caught (spec Trend Radar
// surface): source chip, freshness chip, why-now line, post-worthiness, and
// a per-trend "Forge from this" scoped to the cached row via trend_ids.
const TrendRadar = ({
  niche,
  onNicheChange,
  tone,
  onToneChange,
  loading,
  scanningText,
  scanningSub,
  costHint,
  onGenerate,
  trends = [],
  forgingTrendId = null,
  forgeError = null,
  onForgeFromTrend,
}) => (
  <motion.div
    initial={{ opacity: 0, y: 20 }}
    animate={{ opacity: 1, y: 0 }}
    className="glass-card rounded-xl p-8 mb-8"
    aria-busy={loading}
  >
    <h2 className="font-heading text-2xl font-bold text-white mb-2" data-testid="trend-radar-heading">
      {`What's trending in ${niche} right now?`}
    </h2>
    <p className="text-zinc-400 mb-6">
      {`Run research to pull what's moving in ${niche} right now. Every trend comes with its real source URL, a freshness label, and a one-line “why now”.`}
    </p>

    <div className="flex flex-wrap items-center gap-4 mb-6">
      <div className="flex items-center gap-2">
        <span className="text-sm text-zinc-400">Niche:</span>
        <Select value={niche} onValueChange={onNicheChange}>
          <SelectTrigger className="w-32 bg-void border-white/10 text-white" data-testid="niche-selector">
            <SelectValue />
          </SelectTrigger>
          <SelectContent className="bg-deep border-white/10">
            {NICHES.map((n) => (
              <SelectItem key={n} value={n} className="text-white hover:bg-white/5">
                {n}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="flex items-center gap-2">
        <span className="text-sm text-zinc-400">Tone:</span>
        <Select value={tone} onValueChange={onToneChange}>
          <SelectTrigger className="w-32 bg-void border-white/10 text-white" data-testid="tone-selector-main">
            <SelectValue />
          </SelectTrigger>
          <SelectContent className="bg-deep border-white/10">
            {TONES.map((t) => (
              <SelectItem key={t} value={t} className="text-white hover:bg-white/5">
                {t}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
    </div>

    <CostHintBanner hint={costHint} testId="research-cost-hint" />

    <Button
      onClick={onGenerate}
      disabled={loading}
      data-testid="generate-ideas-btn"
      className="w-full bg-lime text-void hover:bg-lime-hover btn-glow text-lg py-6"
    >
      {loading ? (
        <span className="flex items-center gap-2">
          <RefreshCw className="w-5 h-5 animate-spin" aria-hidden="true" />
          Forging…
        </span>
      ) : (
        <span className="flex items-center gap-2">
          <Sparkles className="w-5 h-5" aria-hidden="true" />
          Forge ideas
        </span>
      )}
    </Button>

    {loading && scanningText && (
      <div className="mt-4 text-center">
        <p className="text-zinc-400 animate-scan-pulse">{scanningText}</p>
        {scanningSub && <p className="text-zinc-400 text-sm mt-1">{scanningSub}</p>}
      </div>
    )}

    {/* The trends the last research run caught (spec Trend Radar surface).
        Browsing them costs nothing beyond that run; the forge actions below
        sit under the same cost hint as the combined button. */}
    {!loading && trends.length > 0 && (
      <div className="mt-8" data-testid="trend-list">
        <div className="flex items-center justify-between gap-4 mb-4">
          <h3 className="font-heading text-lg text-white">
            Trends from your last research
          </h3>
          <span className="font-mono text-xs text-zinc-400" data-testid="trend-count">
            {trends.length} trends
          </span>
        </div>

        {forgeError && (
          <div
            role="alert"
            data-testid="trend-forge-error"
            className="border-l-2 border-red-400 bg-white/5 rounded-r-lg px-4 py-3 mb-4"
          >
            <p className="text-white text-sm font-medium">
              {forgeErrorCopy(forgeError.error).headline}
            </p>
            <p className="text-zinc-400 text-sm mt-1">
              {forgeError.error?.message ??
                "Nothing was forged — your research and ideas are untouched."}
            </p>
            <Button
              size="sm"
              variant="outline"
              onClick={
                forgeError.error?.kind === "not_found"
                  ? onGenerate
                  : () => {
                      const trend = trends.find((t) => t.id === forgeError.trendId);
                      if (trend) onForgeFromTrend(trend);
                    }
              }
              data-testid="trend-forge-error-action"
              className="mt-3 border-white/10 text-white hover:bg-white/5"
            >
              {forgeErrorCopy(forgeError.error).action}
            </Button>
          </div>
        )}

        <div className="grid md:grid-cols-2 gap-4">
          {trends.map((trend, index) => (
            <TrendCard
              key={trend.id ?? `trend-${index}`}
              trend={trend}
              index={index}
              forging={forgingTrendId != null && forgingTrendId === trend.id}
              forgeDisabled={loading || (forgingTrendId != null && forgingTrendId !== trend.id)}
              onForge={onForgeFromTrend}
            />
          ))}
        </div>
      </div>
    )}
  </motion.div>
);

export default TrendRadar;
