import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import Navbar from "@/components/layout/Navbar";
import SkipLink from "@/components/layout/SkipLink";
import { ErrorState, LoadingSkeleton } from "@/components/states/AsyncStates";
import { api } from "@/api/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Activity, BarChart3, ClipboardList, Flame, Trash2, TrendingUp } from "lucide-react";

// Honest analytics. Every number here is derived from one of two sources the
// user controls: their own usage events (what they did in IdeaForge) or their
// own manually pasted post results. Nothing is scraped, estimated, or
// fabricated — an empty count is a real zero and says so. Copy strings are
// lifted verbatim from the UI & Copy Craft Pack §3.9.

// Closed event vocabulary (backend services/usage.py) → honest human labels.
const EVENT_LABELS = {
  research_run: "Research runs",
  ideas_generated: "Ideas forged",
  insight_card_generated: "Insight cards",
  post_drafted: "Posts drafted",
  post_regenerated: "Variants regenerated",
  post_tweaked: "Drafts tweaked",
  voice_extracted: "Voice extractions",
  posts_exported: "Exports",
  metrics_logged: "Results logged",
};

const summarize = (counts) => ({
  total: counts?.total ?? 0,
  byEvent: counts?.by_event ?? {},
});

const PeriodCard = ({ label, current, previous, unit }) => {
  const delta = current - previous;
  const direction =
    delta === 0 ? "" : delta > 0 ? "+" : "−";
  const previousLabel =
    unit === "week" ? "vs previous 7 days" : "vs previous 30 days";
  return (
    <div data-testid={`period-${unit}`} className="glass-card rounded-xl p-4">
      <p className="font-mono text-xs text-zinc-400 uppercase tracking-wide">{label}</p>
      <p className="font-heading text-3xl text-white mt-2" data-testid={`period-${unit}-current`}>
        {current}
      </p>
      <p className="font-mono text-xs text-zinc-400 mt-1" data-testid={`period-${unit}-delta`}>
        {direction ? `${direction}${Math.abs(delta)}` : "no change"} {previousLabel} ({previous})
      </p>
    </div>
  );
};

// 30-day activity strip — bar heights come from real event counts only.
const Timeline = ({ timeline }) => {
  const max = Math.max(1, ...timeline.map((day) => day.total));
  return (
    <div data-testid="activity-timeline" className="flex items-end gap-1 h-24" role="img"
      aria-label="Activity over the last 30 days; bar height is your event count per day.">
      {timeline.map((day) => (
        <div key={day.date} className="flex-1 flex flex-col items-center justify-end h-full group">
          <div
            className={`w-full rounded-sm transition-all ${day.total ? "bg-lime" : "bg-white/5"}`}
            style={{ height: `${Math.max(4, (day.total / max) * 100)}%` }}
            title={`${day.date}: ${day.total} ${day.total === 1 ? "event" : "events"}`}
          />
        </div>
      ))}
    </div>
  );
};

const StreakCard = ({ streaks }) => (
  <div data-testid="streak-card" className="glass-card rounded-xl p-6 md:col-span-2">
    <div className="flex items-center gap-2 mb-4">
      <Flame className="w-5 h-5 text-lime" aria-hidden="true" />
      <h2 className="font-heading text-lg text-white">Streak</h2>
    </div>
    <div className="grid grid-cols-3 gap-4">
      <div>
        <p className="font-heading text-4xl text-lime" data-testid="streak-current">{streaks.current}</p>
        <p className="font-mono text-xs text-zinc-400 mt-1">day{streaks.current === 1 ? "" : "s"} in a row</p>
      </div>
      <div>
        <p className="font-heading text-4xl text-white" data-testid="streak-longest">{streaks.longest}</p>
        <p className="font-mono text-xs text-zinc-400 mt-1">longest streak</p>
      </div>
      <div>
        <p className="font-heading text-4xl text-white" data-testid="streak-active">{streaks.active_days_30}</p>
        <p className="font-mono text-xs text-zinc-400 mt-1">active days, last 30</p>
      </div>
    </div>
    <p className="font-mono text-xs text-zinc-400 mt-4">
      From your usage events — every action you take in IdeaForge counts one day.
    </p>
  </div>
);

const CountsCard = ({ byEvent }) => {
  const entries = Object.entries(byEvent).filter(([, n]) => n > 0);
  return (
    <div data-testid="counts-card" className="glass-card rounded-xl p-6">
      <div className="flex items-center gap-2 mb-4">
        <BarChart3 className="w-5 h-5 text-lime" aria-hidden="true" />
        <h2 className="font-heading text-lg text-white">What you've done</h2>
      </div>
      {entries.length === 0 ? (
        <p className="text-sm text-zinc-400">No actions recorded yet.</p>
      ) : (
        <ul className="space-y-2">
          {entries.map(([event, count]) => (
            <li key={event} className="flex items-center justify-between">
              <span className="text-sm text-zinc-300">{EVENT_LABELS[event] ?? event}</span>
              <span className="font-mono text-white" data-testid={`count-${event}`}>{count}</span>
            </li>
          ))}
        </ul>
      )}
      <p className="font-mono text-xs text-zinc-400 mt-4">
        From your usage events. Failed runs are never counted — a failed search produced nothing.
      </p>
    </div>
  );
};

// Logged results for the selected idea (Honesty bundle fix 6): the read half
// is the previously unwired GET /analytics/posts/{id}/metrics route, and each
// entry deletes itself via DELETE /analytics/posts/{id}/metrics/{metric_id}.
// A wrong pasted number becomes correctable — delete it, log the correction,
// and the summary reloads so the totals stop counting a disowned number.
const LoggedMetrics = ({ ideaId, refreshKey, onDeleted }) => {
  const [entries, setEntries] = useState(null);
  const [loadError, setLoadError] = useState(false);

  const load = useCallback(async () => {
    setLoadError(false);
    try {
      const list = await api.get(`/analytics/posts/${ideaId}/metrics`);
      setEntries(Array.isArray(list) ? list : []);
    } catch {
      setLoadError(true);
    }
  }, [ideaId]);

  useEffect(() => {
    if (!ideaId) {
      setEntries(null);
      setLoadError(false);
      return;
    }
    load();
  }, [ideaId, refreshKey, load]);

  if (!ideaId) return null;

  const remove = async (entryId) => {
    try {
      await api.delete(`/analytics/posts/${ideaId}/metrics/${entryId}`);
      setEntries((prev) => (prev ?? []).filter((e) => e.id !== entryId));
      onDeleted();
    } catch {
      toast.error("Couldn't delete that entry — it's still logged. Try again.");
    }
  };

  if (loadError) {
    return (
      <div data-testid="logged-metrics-error" className="mt-4 text-sm text-zinc-400">
        Logged results didn't load — nothing was changed.{" "}
        <Button variant="outline" onClick={load}
          className="h-7 px-2 text-xs border-white/10 text-white hover:bg-white/5">
          Retry
        </Button>
      </div>
    );
  }

  if (!entries) {
    return <p className="font-mono text-xs text-zinc-400 mt-4">Loading logged results…</p>;
  }

  if (entries.length === 0) {
    return (
      <p data-testid="logged-metrics-empty" className="text-sm text-zinc-400 mt-4">
        No results logged for this post yet — the first entry you save shows up here.
      </p>
    );
  }

  return (
    <div data-testid="logged-metrics" className="mt-4">
      <p className="text-sm text-zinc-300 mb-2">
        Logged results for this post — delete a wrong entry, then log the correction:
      </p>
      <ul className="space-y-2">
        {entries.map((entry) => (
          <li key={entry.id} data-testid={`logged-metric-${entry.id}`}
            className="flex flex-wrap items-center gap-3 border border-white/10 rounded-lg px-3 py-2 text-sm">
            <span className="font-mono text-xs text-zinc-400">{entry.posted_on}</span>
            <span className="font-mono text-white">{entry.impressions} impressions</span>
            <span className="font-mono text-zinc-300">{entry.reactions} reactions</span>
            <span className="font-mono text-zinc-300">{entry.comments} comments</span>
            <span className="font-mono text-zinc-300">{entry.reposts} reposts</span>
            <Button type="button" variant="outline" onClick={() => remove(entry.id)}
              data-testid={`logged-metric-delete-${entry.id}`}
              className="ml-auto h-7 px-2 text-xs border-white/10 text-red-300 hover:bg-white/5">
              <Trash2 className="w-3 h-3 mr-1" aria-hidden="true" />
              Delete
            </Button>
          </li>
        ))}
      </ul>
    </div>
  );
};

// The manual-entry form: numbers the user pasted from their own LinkedIn
// dashboard. Client validation mirrors the backend (non-negative integers);
// both surfaces render the same craft-pack sentence on a violation.
const MetricsForm = ({ ideas, onLogged, formRef }) => {
  const [ideaId, setIdeaId] = useState("");
  const [postedOn, setPostedOn] = useState(() => new Date().toISOString().slice(0, 10));
  const [values, setValues] = useState({ impressions: "", reactions: "", comments: "", reposts: "" });
  const [fieldError, setFieldError] = useState(null);
  const [submitting, setSubmitting] = useState(false);
  // Bumped after each successful log so the logged list re-reads and shows
  // the new entry without a full-page refresh.
  const [loggedKey, setLoggedKey] = useState(0);

  const setField = (field) => (e) => {
    const raw = e.target.value;
    // Numbers only, never negative — the backend rejects negatives with 422,
    // the form rejects them before a round trip, with the same sentence.
    if (raw !== "" && (!/^\d+$/.test(raw) || Number(raw) < 0)) {
      setFieldError("Numbers only — impressions and reactions are counts.");
      return;
    }
    setFieldError(null);
    setValues((prev) => ({ ...prev, [field]: raw }));
  };

  const submit = async (e) => {
    e.preventDefault();
    if (!ideaId) return;
    setSubmitting(true);
    try {
      await api.post(`/analytics/posts/${ideaId}/metrics`, {
        posted_on: postedOn,
        impressions: Number(values.impressions || 0),
        reactions: Number(values.reactions || 0),
        comments: Number(values.comments || 0),
        reposts: Number(values.reposts || 0),
      });
      const idea = ideas.find((i) => i.id === ideaId);
      toast.success(`Results logged for ${idea?.topic_title ?? "your post"}.`);
      setValues({ impressions: "", reactions: "", comments: "", reposts: "" });
      setLoggedKey((k) => k + 1);
      onLogged();
    } catch (error) {
      toast.error(error?.message ?? "Logging failed — nothing was saved.");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <form ref={formRef} onSubmit={submit} data-testid="metrics-form"
      className="glass-card rounded-xl p-6 mt-6" aria-label="Log post results">
      <div className="flex items-center gap-2 mb-4">
        <ClipboardList className="w-5 h-5 text-lime" aria-hidden="true" />
        <h2 className="font-heading text-lg text-white">Log post results</h2>
      </div>
      <p className="text-sm text-zinc-400 mb-4">
        Paste impressions and reactions from a post you published — it takes about a minute and
        stays manual by design. IdeaForge never scrapes LinkedIn.
      </p>
      <div className="grid md:grid-cols-2 gap-4">
        <div className="space-y-1">
          <label htmlFor="metrics-idea" className="text-sm text-zinc-300">Post</label>
          <Select value={ideaId} onValueChange={setIdeaId}>
            <SelectTrigger id="metrics-idea" data-testid="metrics-idea-select" className="w-full">
              <SelectValue placeholder="Which saved idea was it?" />
            </SelectTrigger>
            <SelectContent>
              {ideas.map((idea) => (
                <SelectItem key={idea.id} value={idea.id}>{idea.topic_title}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1">
          <label htmlFor="metrics-date" className="text-sm text-zinc-300">Posted on</label>
          <Input id="metrics-date" type="date" value={postedOn} max={new Date().toISOString().slice(0, 10)}
            onChange={(e) => setPostedOn(e.target.value)} data-testid="metrics-date-input" />
        </div>
        {[
          ["impressions", "Impressions"],
          ["reactions", "Reactions"],
          ["comments", "Comments"],
          ["reposts", "Reposts"],
        ].map(([field, label]) => (
          <div key={field} className="space-y-1">
            <label htmlFor={`metrics-${field}`} className="text-sm text-zinc-300">{label}</label>
            <Input
              id={`metrics-${field}`}
              inputMode="numeric"
              min="0"
              placeholder="0"
              value={values[field]}
              onChange={setField(field)}
              data-testid={`metrics-${field}-input`}
            />
          </div>
        ))}
      </div>
      {fieldError && (
        <p role="alert" data-testid="metrics-field-error" className="text-sm text-red-400 mt-3">
          {fieldError}
        </p>
      )}
      <Button type="submit" disabled={!ideaId || submitting}
        className="mt-4 bg-lime text-void hover:bg-lime-hover" data-testid="metrics-submit-btn">
        {submitting ? "Logging…" : "Log results"}
      </Button>
      <LoggedMetrics ideaId={ideaId} refreshKey={loggedKey} onDeleted={onLogged} />
    </form>
  );
};

// Empty manual section per craft pack §3.9: names the period and the one
// action that fills it.
const ManualEmpty = ({ periodLabel, onLogClick }) => (
  <div data-testid="manual-empty" className="text-center py-10">
    <h3 className="font-heading text-lg text-white">No results logged for {periodLabel}.</h3>
    <p className="text-zinc-400 text-sm max-w-md mx-auto mt-2">
      Paste impressions and reactions from a post — it takes about a minute and stays manual by
      design.
    </p>
    <Button variant="outline" onClick={onLogClick}
      className="mt-4 border-white/10 text-white hover:bg-white/5" data-testid="manual-empty-cta">
      Log post results
    </Button>
  </div>
);

const ManualSection = ({ manual, ideas, onLogged, formRef, onLogClick }) => {
  const week = manual?.week;
  const month = manual?.month;
  const hasEntries = [week?.current?.count, week?.previous?.count, month?.current?.count, month?.previous?.count]
    .some((n) => (n ?? 0) > 0);
  return (
    <section data-testid="manual-section" className="mt-10">
      <div className="flex items-center gap-2 mb-1">
        <TrendingUp className="w-5 h-5 text-lime" aria-hidden="true" />
        <h2 className="font-heading text-xl text-white">Post results</h2>
      </div>
      <p className="font-mono text-xs text-zinc-400 mb-4">
        Pasted by you from your LinkedIn dashboard — never scraped, never estimated.
      </p>
      {hasEntries ? (
        <div className="grid md:grid-cols-2 gap-4">
          <div className="glass-card rounded-xl p-4 space-y-2">
            <p className="font-heading text-sm text-white">This week vs last week</p>
            {[["Impressions", "impressions"], ["Reactions", "reactions"], ["Comments", "comments"], ["Reposts", "reposts"]].map(
              ([label, field]) => (
                <div key={field} className="flex items-center justify-between text-sm">
                  <span className="text-zinc-300">{label}</span>
                  <span className="font-mono text-white" data-testid={`manual-week-${field}`}>
                    {week?.current?.[field] ?? 0}
                    <span className="text-zinc-400 ml-2">
                      vs {week?.previous?.[field] ?? 0}
                    </span>
                  </span>
                </div>
              ),
            )}
          </div>
          <div className="glass-card rounded-xl p-4 space-y-2">
            <p className="font-heading text-sm text-white">This month vs last month</p>
            {[["Impressions", "impressions"], ["Reactions", "reactions"], ["Comments", "comments"], ["Reposts", "reposts"]].map(
              ([label, field]) => (
                <div key={field} className="flex items-center justify-between text-sm">
                  <span className="text-zinc-300">{label}</span>
                  <span className="font-mono text-white" data-testid={`manual-month-${field}`}>
                    {month?.current?.[field] ?? 0}
                    <span className="text-zinc-400 ml-2">
                      vs {month?.previous?.[field] ?? 0}
                    </span>
                  </span>
                </div>
              ),
            )}
          </div>
        </div>
      ) : (
        <ManualEmpty periodLabel="any period yet" onLogClick={onLogClick} />
      )}
      <MetricsForm ideas={ideas} onLogged={onLogged} formRef={formRef} />
    </section>
  );
};

const SummaryBody = ({ summary, ideas, onLogged, onLogClick }) => {
  const counts = summarize(summary.counts);
  const streaks = summary.streaks ?? { current: 0, longest: 0, active_days_30: 0 };
  const comparison = summary.comparison ?? {};

  return (
    <div className="space-y-6">
      <div className="grid md:grid-cols-2 gap-4">
        <StreakCard streaks={streaks} />
        <CountsCard byEvent={counts.byEvent} />
      </div>

      <section data-testid="usage-comparison" aria-label="Usage period comparison">
        <div className="flex items-center gap-2 mb-1">
          <Activity className="w-5 h-5 text-lime" aria-hidden="true" />
          <h2 className="font-heading text-xl text-white">Activity</h2>
        </div>
        <p className="font-mono text-xs text-zinc-400 mb-4">
          From your usage events — what you actually did in IdeaForge.
        </p>
        <div className="grid md:grid-cols-2 gap-4">
          <PeriodCard label="Events this week" unit="week"
            current={comparison.week?.current?.total ?? 0}
            previous={comparison.week?.previous?.total ?? 0} />
          <PeriodCard label="Events this month" unit="month"
            current={comparison.month?.current?.total ?? 0}
            previous={comparison.month?.previous?.total ?? 0} />
        </div>
        <div className="glass-card rounded-xl p-4 mt-4">
          <p className="font-mono text-xs text-zinc-400 mb-2">Last 30 days</p>
          <Timeline timeline={summary.timeline ?? []} />
        </div>
      </section>

      <ManualSection manual={summary.manual} ideas={ideas} onLogged={onLogged}
        onLogClick={onLogClick} />
    </div>
  );
};

const Analytics = () => {
  const [status, setStatus] = useState("loading"); // loading | error | ready
  const [summary, setSummary] = useState(null);
  const [ideas, setIdeas] = useState([]);
  const formRef = useRef(null);

  const load = useCallback(async () => {
    setStatus("loading");
    try {
      const [summaryData, savedIdeas] = await Promise.all([
        api.get("/analytics/summary"),
        api.get("/saved"),
      ]);
      setSummary(summaryData);
      setIdeas(Array.isArray(savedIdeas) ? savedIdeas : []);
      setStatus("ready");
    } catch {
      setStatus("error");
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  // A log action refreshes the summary so the new entry shows up honestly;
  // the empty-state CTA just brings the form into view.
  const focusForm = useCallback(
    () => formRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }),
    [],
  );

  const counts = summarize(summary?.counts);
  const hasUsage = counts.total > 0;
  const manual = summary?.manual ?? {};
  const hasManual = [
    manual.week?.current?.count,
    manual.week?.previous?.count,
    manual.month?.current?.count,
    manual.month?.previous?.count,
  ].some((n) => (n ?? 0) > 0);

  return (
    <div className="min-h-screen bg-void text-white">
      <SkipLink />
      <Navbar />
      <main id="main-content" className="max-w-5xl mx-auto px-6 pt-24 pb-16">
        <h1 className="font-heading text-3xl text-white mb-2">Analytics</h1>
        <p className="text-zinc-400 mb-8">
          Your numbers, honestly counted — usage events from your own actions, plus results you
          paste in yourself. IdeaForge never scrapes LinkedIn.
        </p>

        {status === "loading" && (
          <div data-testid="analytics-loading" className="space-y-4" aria-busy="true">
            <p className="font-mono text-sm text-zinc-400">Loading your numbers…</p>
            <div className="grid md:grid-cols-2 gap-4">
              <LoadingSkeleton className="h-40" />
              <LoadingSkeleton className="h-40" />
            </div>
            <LoadingSkeleton className="h-48" />
          </div>
        )}

        {status === "error" && (
          <ErrorState
            error={{ kind: "server", message: "Your logged numbers are safe — this is a read failure, not a data problem." }}
            title="Analytics didn't load."
            onRetry={load}
          />
        )}

        {status === "ready" && !hasUsage && !hasManual && (
          <div data-testid="analytics-empty">
            <h3 className="font-heading text-xl text-white mb-2">No numbers yet.</h3>
            <p className="text-zinc-400 max-w-md">
              Streaks, ideas forged, and posts drafted appear as you use the forge. Post results
              stay yours: you paste impressions and reactions yourself — IdeaForge never scrapes
              LinkedIn.
            </p>
          </div>
        )}

        {status === "ready" && (hasUsage || hasManual) && (
          <SummaryBody summary={summary} ideas={ideas} onLogged={load}
            onLogClick={focusForm} />
        )}
      </main>
    </div>
  );
};

export default Analytics;
