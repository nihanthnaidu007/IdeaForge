import { ExternalLink, Zap } from "lucide-react";
import { Button } from "@/components/ui/button";

// One trend card on the Trend Radar surface (spec: make the namesake
// visible). Presentational and props-driven — the Dashboard owns all state
// and calls. The honesty invariant lives here in rendering form: an unknown
// enrichment field renders as explicitly unknown ("No signal yet", no score,
// no why-now) — never invented from the snippet, never silently absent.

// Deterministic freshness buckets (backend contract, PR #19) rendered in
// user language. null/unknown renders the explicit "No signal yet" chip.
export const freshnessLabel = (freshness) => {
  if (freshness === "this_week") return "This week";
  if (freshness === "this_month") return "This month";
  if (freshness === "older") return "Older";
  return "No signal yet";
};

// Post-worthiness uses the same 1-10 scale and tier accents as idea ratings
// (IdeaCard's ratingTier) — one score vocabulary across the forge.
export const worthinessTier = (postWorthiness) =>
  postWorthiness >= 8 ? "high" : postWorthiness >= 6 ? "medium" : "low";

// The backend's source field carries the research query label and may be
// empty — an absent source renders explicitly unknown, never guessed from
// the URL.
export const sourceLabel = (trend) => {
  const source = trend?.source?.trim();
  return source || "Unknown source";
};

const TrendCard = ({ trend, index, forging, forgeDisabled, onForge }) => {
  const hasUrl = Boolean(trend.url);
  const hasWorthiness = trend.post_worthiness != null;
  const forgeable = Boolean(trend.id);

  return (
    <div
      data-testid={`trend-card-${index}`}
      className="glass-card rounded-xl p-4 card-hover"
    >
      <div className="flex flex-wrap items-center gap-2 mb-2">
        <span
          data-testid={`trend-source-${index}`}
          title={sourceLabel(trend)}
          className="font-mono text-xs text-zinc-300 border border-white/10 bg-white/5 rounded-full px-2.5 py-0.5 max-w-48 truncate"
        >
          {sourceLabel(trend)}
        </span>
        <span
          data-testid={`trend-freshness-${index}`}
          className={
            trend.freshness
              ? "font-mono text-xs text-lime border border-lime/30 bg-lime/5 rounded-full px-2.5 py-0.5"
              : "font-mono text-xs text-zinc-400 border border-white/10 bg-white/5 rounded-full px-2.5 py-0.5"
          }
        >
          {freshnessLabel(trend.freshness)}
        </span>
      </div>

      {hasUrl ? (
        <a
          href={trend.url}
          target="_blank"
          rel="noopener noreferrer"
          data-testid={`trend-card-link-${index}`}
          title={trend.title}
          className="font-heading font-semibold text-white text-sm leading-tight hover:text-lime inline-flex items-start gap-1.5"
        >
          {trend.title}
          <ExternalLink
            className="w-3.5 h-3.5 text-zinc-400 mt-0.5 shrink-0"
            aria-hidden="true"
          />
        </a>
      ) : (
        <h3
          data-testid={`trend-card-title-${index}`}
          title={trend.title}
          className="font-heading font-semibold text-white text-sm leading-tight"
        >
          {trend.title}
        </h3>
      )}

      {trend.snippet ? (
        <p className="text-zinc-400 text-sm mt-2">{trend.snippet}</p>
      ) : null}

      {/* Why-now line: the enrichment's grounded claim when present, the
          explicit unknown when not — the snippet is never repurposed as one. */}
      <div className="mt-3" data-testid={`trend-why-now-${index}`}>
        <span className="text-xs uppercase tracking-wider text-zinc-400">
          Why now
        </span>
        <p className="text-white/80 text-sm mt-0.5">
          {trend.why_now ? trend.why_now : "No signal yet."}
        </p>
      </div>

      {/* Post-worthiness: rendered only when the enrichment supplied it —
          "no score" is the sanctioned unknown, an invented default is not. */}
      {hasWorthiness && (
        <div className="mt-3" data-testid={`trend-worthiness-${index}`}>
          <div className="flex items-center gap-1">
            <Zap
              className={`w-4 h-4 text-rating-${worthinessTier(trend.post_worthiness)}`}
              aria-hidden="true"
            />
            <span
              className={`font-mono text-sm font-medium text-rating-${worthinessTier(trend.post_worthiness)}`}
            >
              {trend.post_worthiness}
            </span>
            <span className="text-zinc-400 text-sm">/ 10 post-worthiness</span>
          </div>
          {trend.score_reason ? (
            <p className="text-zinc-400 text-sm italic mt-1">
              &ldquo;{trend.score_reason}&rdquo;
            </p>
          ) : null}
        </div>
      )}

      {/* Per-trend forge (spec): scoped to the server-cached trend via
          trend_ids — no re-search, no extra Tavily spend. A row without a
          cache id (failed cache write or validation) states why it can't
          forge instead of offering an action that would 404. */}
      {forgeable ? (
        <Button
          onClick={() => onForge(trend)}
          disabled={forgeDisabled || forging}
          aria-busy={forging}
          data-testid={`forge-from-trend-${index}-btn`}
          size="sm"
          variant="outline"
          className="mt-4 border-lime/40 text-lime hover:bg-lime/10 hover:text-lime"
        >
          <Zap className="w-3.5 h-3.5" aria-hidden="true" />
          {forging ? "Forging…" : "Forge from this"}
        </Button>
      ) : (
        <p
          data-testid={`trend-not-forgeable-${index}`}
          className="text-zinc-400 text-xs mt-4"
        >
          Not cached for forging — run a fresh research sweep.
        </p>
      )}
    </div>
  );
};

export default TrendCard;
