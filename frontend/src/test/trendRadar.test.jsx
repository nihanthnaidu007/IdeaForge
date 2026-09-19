import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import TrendRadar, { forgeErrorCopy } from "../components/dashboard/TrendRadar";
import { freshnessLabel, worthinessTier, sourceLabel } from "../components/dashboard/TrendCard";

// Honesty bundle fix 2: the Trend Radar panel is scoped to the user's
// niche — its heading and subcopy must track the selected niche instead of
// the hardcoded "Tech & AI" that contradicted four of the five options.
//
// Wave 1 (Trend Radar surface): after a research run the panel renders the
// trends it caught — source chip, freshness chip, why-now line, post-
// worthiness, per-trend forge — with unknown enrichment rendered as
// explicitly unknown, never invented and never silently absent.
window.matchMedia =
  window.matchMedia ||
  ((query) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => {},
  }));

const renderPanel = (niche, extra = {}) =>
  render(
    <TrendRadar
      niche={niche}
      onNicheChange={vi.fn()}
      tone="Professional"
      onToneChange={vi.fn()}
      loading={false}
      scanningText={null}
      scanningSub={null}
      costHint={null}
      onGenerate={vi.fn()}
      {...extra}
    />,
  );

// Fully enriched row (spec's enriched-trend shape).
const ENRICHED_TREND = {
  id: "t-1",
  title: "RAG evals are the new unit tests — change my mind",
  snippet: "Teams are replacing ad-hoc prompt checks with eval suites.",
  url: "https://www.reddit.com/r/Rag/example",
  source: "AI latest trends site:reddit.com",
  published_at: "2026-09-16T00:00:00+00:00",
  freshness: "this_week",
  why_now: "Every team I talk to is shipping eval harnesses this quarter.",
  post_worthiness: 8,
  score_reason: "Concrete pain, big audience, deadline-free but urgent.",
};

describe("TrendRadar heading tracks the selected niche (Honesty bundle fix 2)", () => {
  it("names the selected niche in the heading and subcopy", () => {
    renderPanel("Data Science");

    expect(screen.getByTestId("trend-radar-heading")).toHaveTextContent(
      "What's trending in Data Science right now?",
    );
    expect(
      screen.getByText(/Run research to pull what's moving in Data Science right now/),
    ).toBeInTheDocument();
    // The hardcoded niche is gone from the surface entirely.
    expect(screen.queryByText(/Tech & AI/)).not.toBeInTheDocument();
  });

  it("updates when the selected niche changes", () => {
    const { unmount } = renderPanel("AI");
    expect(screen.getByTestId("trend-radar-heading")).toHaveTextContent(
      "What's trending in AI right now?",
    );
    unmount();

    renderPanel("Web Dev");
    expect(screen.getByTestId("trend-radar-heading")).toHaveTextContent(
      "What's trending in Web Dev right now?",
    );
    expect(screen.queryByText(/Tech & AI/)).not.toBeInTheDocument();
  });
});

describe("TrendRadar trend cards (Wave 1 Trend Radar surface)", () => {
  it("renders an enriched trend with source chip, freshness chip, why-now line, and post-worthiness", () => {
    renderPanel("AI", { trends: [ENRICHED_TREND], onForgeFromTrend: vi.fn() });

    // Source chip carries the backend's source label verbatim — never a
    // guessed pretty label.
    expect(screen.getByTestId("trend-source-0")).toHaveTextContent(
      "AI latest trends site:reddit.com",
    );
    // Deterministic freshness bucket in user language.
    expect(screen.getByTestId("trend-freshness-0")).toHaveTextContent("This week");
    // Why-now line carries the enrichment claim.
    expect(screen.getByTestId("trend-why-now-0")).toHaveTextContent(
      "Every team I talk to is shipping eval harnesses this quarter.",
    );
    // Post-worthiness with the same 1-10 vocabulary as idea ratings.
    expect(screen.getByTestId("trend-worthiness-0")).toHaveTextContent("8");
    expect(screen.getByTestId("trend-worthiness-0")).toHaveTextContent(
      "Concrete pain, big audience, deadline-free but urgent.",
    );
  });

  it("links the title out to the source URL in a new tab", () => {
    renderPanel("AI", { trends: [ENRICHED_TREND], onForgeFromTrend: vi.fn() });

    const link = screen.getByTestId("trend-card-link-0");
    expect(link).toHaveAttribute("href", ENRICHED_TREND.url);
    expect(link).toHaveAttribute("target", "_blank");
    expect(link).toHaveAttribute("rel", "noopener noreferrer");
  });

  it("renders unknown enrichment as explicitly unknown — never invented from the snippet", () => {
    renderPanel("AI", {
      trends: [
        {
          ...ENRICHED_TREND,
          id: "t-2",
          freshness: null,
          why_now: null,
          post_worthiness: null,
          score_reason: null,
        },
      ],
      onForgeFromTrend: vi.fn(),
    });

    // Freshness: the explicit "No signal yet" chip.
    expect(screen.getByTestId("trend-freshness-0")).toHaveTextContent(
      "No signal yet",
    );
    // Why-now: the explicit unknown — the snippet text must never be
    // repurposed as a why-now claim.
    const whyNow = screen.getByTestId("trend-why-now-0");
    expect(whyNow).toHaveTextContent("No signal yet.");
    expect(whyNow).not.toHaveTextContent(
      "Teams are replacing ad-hoc prompt checks",
    );
    // Post-worthiness: no score widget at all (the sanctioned unknown).
    expect(screen.queryByTestId("trend-worthiness-0")).not.toBeInTheDocument();
  });

  it("renders a row without a cache id as not forgeable, with the reason visible", () => {
    renderPanel("AI", {
      trends: [{ ...ENRICHED_TREND, id: null }],
      onForgeFromTrend: vi.fn(),
    });

    expect(screen.getByTestId("trend-not-forgeable-0")).toHaveTextContent(
      "Not cached for forging",
    );
    expect(screen.queryByTestId("forge-from-trend-0-btn")).not.toBeInTheDocument();
  });

  it("fires the per-trend forge with the row's own trend object", async () => {
    const user = userEvent.setup();
    const onForgeFromTrend = vi.fn();
    renderPanel("AI", { trends: [ENRICHED_TREND], onForgeFromTrend });

    await user.click(screen.getByTestId("forge-from-trend-0-btn"));
    expect(onForgeFromTrend).toHaveBeenCalledWith(ENRICHED_TREND);
  });

  it("shows the in-flight label on the forging card and disables the other cards", () => {
    renderPanel("AI", {
      trends: [ENRICHED_TREND, { ...ENRICHED_TREND, id: "t-2" }],
      forgingTrendId: "t-1",
      onForgeFromTrend: vi.fn(),
    });

    const forgingButton = screen.getByTestId("forge-from-trend-0-btn");
    expect(forgingButton).toHaveTextContent("Forging…");
    expect(forgingButton).toBeDisabled();
    // The other card's forge is disabled while one is in flight.
    expect(screen.getByTestId("forge-from-trend-1-btn")).toBeDisabled();
  });
});

describe("TrendRadar per-trend forge errors (typed 404 honesty)", () => {
  it("renders the typed 404 as an honest strip wired to a fresh research run", async () => {
    const user = userEvent.setup();
    const onGenerate = vi.fn();
    const onForgeFromTrend = vi.fn();
    renderPanel("AI", {
      trends: [ENRICHED_TREND],
      onGenerate,
      onForgeFromTrend,
      forgeError: {
        error: {
          kind: "not_found",
          status: 404,
          message: "Unknown or expired trend ids: t-1. Run a fresh research sweep to forge from current trends.",
        },
        trendId: "t-1",
      },
    });

    expect(screen.getByTestId("trend-forge-error")).toHaveTextContent(
      "This trend isn't cached anymore.",
    );
    expect(screen.getByTestId("trend-forge-error")).toHaveTextContent(
      "Run a fresh research sweep",
    );
    // No silent fallback: the forged-into ideas path is untouched, and the
    // one action is a fresh research run, not a doomed retry.
    await user.click(screen.getByTestId("trend-forge-error-action"));
    expect(onGenerate).toHaveBeenCalledTimes(1);
    expect(onForgeFromTrend).not.toHaveBeenCalled();
  });

  it("renders transient forge failures with a retry of the same trend", async () => {
    const user = userEvent.setup();
    const onGenerate = vi.fn();
    const onForgeFromTrend = vi.fn();
    renderPanel("AI", {
      trends: [ENRICHED_TREND],
      onGenerate,
      onForgeFromTrend,
      forgeError: {
        error: { kind: "generation_failed", status: 502, message: "Generation failed — please retry." },
        trendId: "t-1",
      },
    });

    expect(screen.getByTestId("trend-forge-error")).toHaveTextContent(
      "Forge from this trend failed.",
    );
    await user.click(screen.getByTestId("trend-forge-error-action"));
    expect(onForgeFromTrend).toHaveBeenCalledWith(ENRICHED_TREND);
    expect(onGenerate).not.toHaveBeenCalled();
  });

  it("maps the forge error kinds to honest copy", () => {
    expect(forgeErrorCopy({ kind: "not_found" }).action).toBe("Run fresh research");
    expect(forgeErrorCopy({ kind: "server" }).action).toBe("Try again");
    expect(forgeErrorCopy(null).action).toBe("Try again");
  });
});

describe("Trend card label helpers (pure functions)", () => {
  it("maps the deterministic freshness buckets and the explicit unknown", () => {
    expect(freshnessLabel("this_week")).toBe("This week");
    expect(freshnessLabel("this_month")).toBe("This month");
    expect(freshnessLabel("older")).toBe("Older");
    expect(freshnessLabel(null)).toBe("No signal yet");
    expect(freshnessLabel(undefined)).toBe("No signal yet");
  });

  it("tiers post-worthiness like idea ratings", () => {
    expect(worthinessTier(8)).toBe("high");
    expect(worthinessTier(6)).toBe("medium");
    expect(worthinessTier(2)).toBe("low");
  });

  it("never invents a source label", () => {
    expect(sourceLabel({ source: "AI latest trends site:reddit.com" })).toBe(
      "AI latest trends site:reddit.com",
    );
    expect(sourceLabel({ source: "" })).toBe("Unknown source");
    expect(sourceLabel({})).toBe("Unknown source");
    expect(sourceLabel(null)).toBe("Unknown source");
  });
});
