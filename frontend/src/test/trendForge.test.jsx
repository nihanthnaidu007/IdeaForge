import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import App from "../App";

// Wave 1 (Trend Radar surface): the research response's raw_trends render
// as trend cards, and "Forge from this" re-forges a single cached trend via
// trend_ids — never a re-search, never an unscoped fallback. A typed 404
// (TRENDS_NOT_FOUND) surfaces as an honest inline error wired to a fresh
// research run; a key-issue failure routes to Settings. This drives the
// real Dashboard wiring at the API boundary.
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

vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn() },
  Toaster: () => null,
}));

const authMe = vi.fn();
vi.mock("@/api/client", () => ({
  API: "http://test/api",
  ERROR_KINDS: {
    MISSING_KEY: "missing_key",
    AUTH: "auth",
    QUOTA: "quota",
    RATE_LIMITED: "rate_limited",
    RESEARCH_FAILED: "research_failed",
    GENERATION_FAILED: "generation_failed",
    UNAVAILABLE: "unavailable",
    VALIDATION: "validation",
    CONFLICT: "conflict",
    NOT_FOUND: "not_found",
    NETWORK: "network",
    SERVER: "server",
    CAP: "cap",
    UNKNOWN: "unknown",
  },
  ApiError: class ApiError extends Error {
    constructor({ status, kind, message, provider, detail }) {
      super(message);
      this.name = "ApiError";
      this.status = status;
      this.kind = kind;
      this.provider = provider;
      this.detail = detail;
    }
  },
  isKeyIssueError: (e) =>
    ["missing_key", "auth", "quota", "cap"].includes(e?.kind),
  normalizeApiError: (e) => e,
  onUnauthorized: () => {},
  api: {
    get: vi.fn((url) => {
      if (url === "/auth/me") return authMe();
      return Promise.resolve({});
    }),
    post: vi.fn().mockResolvedValue({}),
    patch: vi.fn().mockResolvedValue({}),
    delete: vi.fn().mockResolvedValue({}),
  },
}));

import { api } from "@/api/client";
import { toast } from "sonner";

// One enriched row (spec's enriched-trend shape) and one partial row —
// partial enrichment is the honest norm, not a failure state.
const TRENDS = [
  {
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
  },
  {
    id: null,
    title: "Agents ate the demo days",
    snippet: "Launches keep centering agent frameworks over features.",
    url: "https://news.ycombinator.com/item?id=1",
    source: "",
    published_at: null,
    freshness: null,
    why_now: null,
    post_worthiness: null,
    score_reason: null,
  },
];

const IDEAS = [
  {
    title: "Eval suites are the new test suite",
    hook: "Your prompt checks are vibe QA.",
    rating: 8.4,
    rating_explanation: "High tension, concrete deadline.",
  },
];

const RESEARCH_OK = {
  raw_trends: TRENDS,
  niche: "AI",
  tone: "professional",
  researched_at: "2026-09-19T00:00:00Z",
};

const renderRoute = (path) => {
  window.history.pushState({}, "", path);
  return render(<App />);
};

beforeEach(() => {
  localStorage.clear();
  localStorage.setItem("ideaforge_token", "tok");
  authMe.mockResolvedValue({ email: "dev@example.com", name: "Dev" });
  api.get.mockImplementation((url) => {
    if (url === "/auth/me") return authMe();
    if (url === "/cost-estimate?action=research")
      return Promise.resolve({ action: "research", hint: "h", estimated_usd: 0.02 });
    if (url === "/board") return Promise.resolve([]);
    if (url === "/board/tags") return Promise.resolve([]);
    if (url === "/queue") return Promise.resolve({ email_enabled: false, items: [] });
    if (url === "/queue/notifications") return Promise.resolve([]);
    return Promise.resolve({});
  });
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("Trend Radar surface wiring (Wave 1)", () => {
  it("renders trend cards from the research response with honest unknown states", async () => {
    api.post
      .mockResolvedValueOnce(RESEARCH_OK)
      .mockResolvedValue({ ideas: IDEAS });

    const user = userEvent.setup();
    renderRoute("/dashboard");

    await user.click(await screen.findByTestId("generate-ideas-btn"));

    // Trend cards render as soon as research lands — the enriched row with
    // its chips, why-now line, and post-worthiness...
    expect(await screen.findByTestId("trend-card-0")).toBeInTheDocument();
    expect(screen.getByTestId("trend-source-0")).toHaveTextContent(
      "AI latest trends site:reddit.com",
    );
    expect(screen.getByTestId("trend-freshness-0")).toHaveTextContent("This week");
    expect(screen.getByTestId("trend-why-now-0")).toHaveTextContent(
      "Every team I talk to is shipping eval harnesses this quarter.",
    );
    expect(screen.getByTestId("trend-worthiness-0")).toHaveTextContent("8");
    // ...and the partial row with its explicit unknowns.
    expect(screen.getByTestId("trend-freshness-1")).toHaveTextContent(
      "No signal yet",
    );
    expect(screen.getByTestId("trend-why-now-1")).toHaveTextContent(
      "No signal yet.",
    );
    expect(screen.queryByTestId("trend-worthiness-1")).not.toBeInTheDocument();
    expect(screen.getByTestId("trend-not-forgeable-1")).toHaveTextContent(
      "Not cached for forging",
    );
  });

  it("forges from a single trend via trend_ids — no re-search, scoped one-model-call forge", async () => {
    api.post
      .mockResolvedValueOnce(RESEARCH_OK)
      // The combined research→forge flow completes first (its own ideas land).
      .mockResolvedValueOnce({ ideas: IDEAS })
      // Then the per-trend forge is its own scoped call.
      .mockResolvedValueOnce({
        ideas: [
          {
            title: "Scoped idea from one trend",
            hook: "One trend, one forge.",
            rating: 7.5,
            rating_explanation: "Tight scope, strong hook.",
          },
        ],
      });

    const user = userEvent.setup();
    renderRoute("/dashboard");
    await user.click(await screen.findByTestId("generate-ideas-btn"));
    // Wait for the combined flow to finish — ideas on screen — before the
    // per-trend forge, so the call ordering is deterministic.
    await screen.findByTestId("idea-card-0");
    await screen.findByTestId("trend-card-0");

    await user.click(screen.getByTestId("forge-from-trend-0-btn"));

    // The per-trend forge posts ONE scoped generate call carrying the
    // cached trend id — no second /research call, no raw_trends fallback.
    expect(api.post).toHaveBeenNthCalledWith(
      3,
      "/generate-ideas",
      expect.objectContaining({ trend_ids: ["t-1"], niche: "AI", tone: "professional" }),
    );
    expect(api.post).toHaveBeenCalledTimes(3);

    // The scoped forge's ideas replace the board and the success toast
    // names the act.
    expect(await screen.findByTestId("idea-card-0")).toHaveTextContent(
      "Scoped idea from one trend",
    );
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith("Ideas forged"));
  });

  it("surfaces a typed TRENDS_NOT_FOUND as an honest error wired to fresh research — never a silent fallback", async () => {
    const { ApiError } = await import("@/api/client");
    const notFound = new ApiError({
      status: 404,
      kind: "not_found",
      message:
        "Unknown or expired trend ids: t-1. Run a fresh research sweep to forge from current trends.",
    });
    api.post
      .mockResolvedValueOnce(RESEARCH_OK)
      // The combined flow completes first.
      .mockResolvedValueOnce({ ideas: IDEAS })
      // The per-trend forge 404s with the typed TRENDS_NOT_FOUND.
      .mockRejectedValueOnce(notFound)
      // The strip's action re-runs research (fresh sweep).
      .mockResolvedValueOnce(RESEARCH_OK);

    const user = userEvent.setup();
    renderRoute("/dashboard");
    await user.click(await screen.findByTestId("generate-ideas-btn"));
    await screen.findByTestId("idea-card-0");
    await screen.findByTestId("trend-card-0");

    await user.click(screen.getByTestId("forge-from-trend-0-btn"));

    // The honest inline error strip renders with the backend's own detail.
    const strip = await screen.findByTestId("trend-forge-error");
    expect(strip).toHaveTextContent("This trend isn't cached anymore.");
    expect(strip).toHaveTextContent("Run a fresh research sweep");
    // The trends stay on screen (they are real data, not invalidated), and
    // the earlier ideas are untouched — nothing was silently forged from a
    // fallback path.
    expect(screen.getByTestId("trend-card-0")).toBeInTheDocument();
    expect(screen.getByTestId("idea-card-0")).toHaveTextContent(
      "Eval suites are the new test suite",
    );
    await waitFor(() => expect(toast.error).toHaveBeenCalled());

    // The one action is a fresh research run — clicking it re-runs the full
    // research→forge flow (research call + its own generate step).
    await user.click(screen.getByTestId("trend-forge-error-action"));
    expect(api.post).toHaveBeenCalledTimes(5);
    expect(api.post).toHaveBeenNthCalledWith(4, "/research", {
      niche: "AI",
      tone: "professional",
    });
    expect(await screen.findByTestId("trend-card-0")).toBeInTheDocument();
  });

  it("routes key-issue forge failures to the Settings card, not the inline strip", async () => {
    const { ApiError } = await import("@/api/client");
    const missingKey = new ApiError({
      status: 400,
      kind: "missing_key",
      message: "Add a generation key in Settings to run this.",
    });
    api.post
      .mockResolvedValueOnce(RESEARCH_OK)
      // The combined flow completes first.
      .mockResolvedValueOnce({ ideas: IDEAS })
      // The per-trend forge hits the key issue.
      .mockRejectedValueOnce(missingKey);

    const user = userEvent.setup();
    renderRoute("/dashboard");
    await user.click(await screen.findByTestId("generate-ideas-btn"));
    await screen.findByTestId("idea-card-0");
    await screen.findByTestId("trend-card-0");

    await user.click(screen.getByTestId("forge-from-trend-0-btn"));

    // Key issues are fixed in Settings: the honest card renders its fixed
    // missing-key copy with the Add key action, and the inline forge strip
    // does not appear alongside it.
    const card = await screen.findByTestId("key-issue-state");
    expect(card).toHaveTextContent("No generation key connected.");
    expect(screen.queryByTestId("trend-forge-error")).not.toBeInTheDocument();
  });
});
