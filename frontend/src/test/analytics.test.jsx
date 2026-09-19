import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import App from "../App";

// jsdom lacks matchMedia; sonner's Toaster (via next-themes) calls it.
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

// jsdom lacks scrollIntoView; radix Select scrolls the highlighted item on
// open. The page also calls it from the empty-state CTA.
if (typeof Element.prototype.scrollIntoView !== "function") {
  Element.prototype.scrollIntoView = () => {};
}

// Mock the api client so the page can be driven through its honest states
// without a backend. Same mock shape as components.test.jsx.
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

// jsdom has no PointerEvent, so the radix Select trigger never opens under
// userEvent (data-state stays "closed") — a widget-behavior limitation, not
// a page one. Mock the module with the contract the page actually uses:
// an item selection calls onValueChange with the item's value.
vi.mock("@/components/ui/select", async () => {
  const React = await import("react");
  const SelectContext = React.createContext(null);
  const Select = ({ value, onValueChange, children }) =>
    React.createElement(
      SelectContext.Provider,
      { value: { value, onValueChange } },
      children
    );
  const SelectTrigger = ({ children, ...props }) =>
    React.createElement("div", props, children);
  const SelectValue = ({ placeholder }) =>
    React.createElement("span", null, placeholder);
  const SelectContent = ({ children }) => React.createElement("div", null, children);
  const SelectItem = ({ value, children }) =>
    React.createElement(SelectContext.Consumer, null, (ctx) =>
      React.createElement(
        "button",
        {
          type: "button",
          "data-testid": `select-option-${value}`,
          onClick: () => ctx?.onValueChange?.(value),
        },
        children
      )
    );
  return { Select, SelectTrigger, SelectValue, SelectContent, SelectItem };
});

const renderRoute = (path) => {
  window.history.pushState({}, "", path);
  return render(<App />);
};

// A summary carrying real usage: matches the backend aggregate_usage() +
// aggregate_manual_metrics() contract (streaks, counts, timeline,
// comparison, manual week/month sections).
const summaryWithUsage = {
  streaks: { current: 2, longest: 4, active_days_30: 7 },
  counts: { by_event: { research_run: 2, ideas_generated: 3 }, total: 5 },
  timeline: Array.from({ length: 30 }, (_, i) => ({
    date: `2026-09-${String(30 - i).padStart(2, "0")}`,
    total: i === 0 ? 2 : i === 1 ? 1 : 0,
    by_event: i === 0 ? { research_run: 2 } : {},
  })),
  comparison: {
    week: { current: { by_event: { research_run: 2 }, total: 3 }, previous: { by_event: {}, total: 1 } },
    month: { current: { by_event: {}, total: 5 }, previous: { by_event: {}, total: 0 } },
  },
  total_events: 5,
  manual: {
    week: {
      current: { impressions: 1200, reactions: 45, comments: 6, reposts: 2, count: 1 },
      previous: { impressions: 0, reactions: 0, comments: 0, reposts: 0, count: 0 },
    },
    month: {
      current: { impressions: 1200, reactions: 45, comments: 6, reposts: 2, count: 1 },
      previous: { impressions: 0, reactions: 0, comments: 0, reposts: 0, count: 0 },
    },
  },
};

const emptySummary = {
  streaks: { current: 0, longest: 0, active_days_30: 0 },
  counts: { by_event: {}, total: 0 },
  timeline: Array.from({ length: 30 }, (_, i) => ({
    date: `2026-09-${String(30 - i).padStart(2, "0")}`,
    total: 0,
    by_event: {},
  })),
  comparison: {
    week: { current: { by_event: {}, total: 0 }, previous: { by_event: {}, total: 0 } },
    month: { current: { by_event: {}, total: 0 }, previous: { by_event: {}, total: 0 } },
  },
  total_events: 0,
  manual: {
    week: {
      current: { impressions: 0, reactions: 0, comments: 0, reposts: 0, count: 0 },
      previous: { impressions: 0, reactions: 0, comments: 0, reposts: 0, count: 0 },
    },
    month: {
      current: { impressions: 0, reactions: 0, comments: 0, reposts: 0, count: 0 },
      previous: { impressions: 0, reactions: 0, comments: 0, reposts: 0, count: 0 },
    },
  },
};

const savedIdeas = [
  { id: "idea-1", topic_title: "AI agents in production" },
  { id: "idea-2", topic_title: "Vector DB costs" },
];

const useSummary = (summary) => {
  api.get.mockImplementation((url) => {
    if (url === "/auth/me") return authMe();
    if (url === "/analytics/summary") return Promise.resolve(summary);
    if (url === "/saved") return Promise.resolve(savedIdeas);
    return Promise.resolve({});
  });
};

beforeEach(() => {
  localStorage.clear();
  localStorage.setItem("ideaforge_token", "tok");
  authMe.mockResolvedValue({ email: "dev@example.com", name: "Dev" });
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("analytics page — honest states", () => {
  it("renders the loading state while the summary is fetched", async () => {
    // Hold the summary fetch open so the loading state is observable. /auth/me
    // must still resolve or the protected route never renders at all.
    api.get.mockImplementation((url) => {
      if (url === "/auth/me") return authMe();
      if (url === "/analytics/summary") return new Promise(() => {});
      return Promise.resolve({});
    });
    renderRoute("/analytics");
    expect(await screen.findByTestId("analytics-loading")).toBeInTheDocument();
    expect(screen.getByText("Loading your numbers…")).toBeInTheDocument();
  });

  it("renders streaks, honest source framing, and period comparisons", async () => {
    useSummary(summaryWithUsage);
    renderRoute("/analytics");

    expect(await screen.findByTestId("streak-current")).toHaveTextContent("2");
    expect(screen.getByTestId("streak-longest")).toHaveTextContent("4");
    expect(screen.getByTestId("streak-active")).toHaveTextContent("7");
    expect(screen.getByTestId("count-research_run")).toHaveTextContent("2");
    expect(screen.getByText("Ideas forged")).toBeInTheDocument();

    // Every number states where it comes from (craft pack §3.9 honesty rule);
    // the framing appears in the streak and activity sections, so assert on
    // all occurrences rather than a unique match.
    expect(screen.getAllByText(/From your usage events/i).length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText(/never scraped, never estimated/i)).toBeInTheDocument();

    // Period comparison labels compare like periods and say so
    expect(screen.getByTestId("period-week")).toHaveTextContent("vs previous 7 days");
    expect(screen.getByTestId("period-week")).toHaveTextContent("+2 vs previous 7 days (1)");
    expect(screen.getByTestId("period-month")).toHaveTextContent("vs previous 30 days");

    // Manual metrics render as pasted results, week vs week
    expect(screen.getByTestId("manual-week-impressions")).toHaveTextContent("1200");
    expect(screen.getByTestId("manual-week-impressions")).toHaveTextContent("vs 0");

    // The page is reachable from the shared navbar
    expect(screen.getByTestId("nav-analytics-btn")).toBeInTheDocument();
  });

  it("shows the honest empty state when nothing has been used yet", async () => {
    useSummary(emptySummary);
    renderRoute("/analytics");

    expect(await screen.findByTestId("analytics-empty")).toBeInTheDocument();
    expect(screen.getByText("No numbers yet.")).toBeInTheDocument();
    // The no-scraping rule states in both the page subtitle and the empty body
    expect(screen.getAllByText(/IdeaForge never scrapes LinkedIn/i).length).toBeGreaterThanOrEqual(2);
  });

  it("shows the read-failure error state with a working retry", async () => {
    useSummary(summaryWithUsage);
    api.get.mockImplementation((url) => {
      if (url === "/auth/me") return authMe();
      if (url === "/analytics/summary") return Promise.reject(new Error("boom"));
      if (url === "/saved") return Promise.resolve(savedIdeas);
      return Promise.resolve({});
    });
    const user = userEvent.setup();
    renderRoute("/analytics");

    const errorState = await screen.findByTestId("error-state");
    expect(errorState).toHaveTextContent("Analytics didn't load.");
    expect(errorState).toHaveTextContent(
      "Your logged numbers are safe — this is a read failure, not a data problem."
    );

    // Recover: retry succeeds and the summary renders
    api.get.mockImplementation((url) => {
      if (url === "/auth/me") return authMe();
      if (url === "/analytics/summary") return Promise.resolve(summaryWithUsage);
      if (url === "/saved") return Promise.resolve(savedIdeas);
      return Promise.resolve({});
    });
    await user.click(screen.getByTestId("error-retry-btn"));
    expect(await screen.findByTestId("streak-current")).toHaveTextContent("2");
  });
});

describe("analytics page — manual metrics entry", () => {
  it("shows the manual-entry empty state with the log CTA when nothing is logged", async () => {
    useSummary(emptySummary);
    // Manual section still renders its form; empty manual + usage counts both
    // zero keeps the page-level empty state, so give one usage event.
    api.get.mockImplementation((url) => {
      if (url === "/auth/me") return authMe();
      if (url === "/analytics/summary")
        return Promise.resolve({ ...emptySummary, counts: { by_event: { research_run: 1 }, total: 1 } });
      if (url === "/saved") return Promise.resolve(savedIdeas);
      return Promise.resolve({});
    });
    renderRoute("/analytics");

    expect(await screen.findByTestId("manual-empty")).toBeInTheDocument();
    expect(screen.getByTestId("manual-empty")).toHaveTextContent("No results logged for");
    expect(screen.getByTestId("manual-empty-cta")).toHaveTextContent("Log post results");
  });

  it("rejects non-numeric input with the craft-pack sentence and never posts", async () => {
    useSummary(summaryWithUsage);
    const user = userEvent.setup();
    renderRoute("/analytics");

    await screen.findByTestId("metrics-form");
    const impressions = screen.getByTestId("metrics-impressions-input");
    await user.type(impressions, "12a");

    expect(await screen.findByTestId("metrics-field-error")).toHaveTextContent(
      "Numbers only — impressions and reactions are counts."
    );
    // The offending characters never made it into the field, and nothing posted
    expect(api.post).not.toHaveBeenCalled();
  });

  it("posts the metrics to the selected idea's endpoint and clears the form", async () => {
    useSummary(summaryWithUsage);
    const user = userEvent.setup();
    renderRoute("/analytics");

    await screen.findByTestId("metrics-form");

    // Select the idea through the mocked contract: clicking an option calls
    // onValueChange with its value, exactly as radix does.
    await user.click(screen.getByTestId("select-option-idea-1"));

    await user.type(screen.getByTestId("metrics-impressions-input"), "850");
    await user.type(screen.getByTestId("metrics-reactions-input"), "32");
    await user.type(screen.getByTestId("metrics-comments-input"), "4");
    await user.type(screen.getByTestId("metrics-reposts-input"), "1");

    await user.click(screen.getByTestId("metrics-submit-btn"));

    await waitFor(() => expect(api.post).toHaveBeenCalledTimes(1));
    const [url, payload] = api.post.mock.calls[0];
    expect(url).toBe("/analytics/posts/idea-1/metrics");
    expect(payload).toEqual({
      posted_on: expect.any(String),
      impressions: 850,
      reactions: 32,
      comments: 4,
      reposts: 1,
    });

    // Form clears after a successful log
    await waitFor(() =>
      expect(screen.getByTestId("metrics-impressions-input")).toHaveValue("")
    );
  });
});
