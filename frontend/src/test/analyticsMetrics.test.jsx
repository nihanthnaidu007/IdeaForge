import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import App from "../App";

// Honesty bundle fix 6: logged metrics become correctable. Selecting a post
// reads its entries through the previously unwired GET
// /analytics/posts/{id}/metrics route, and each entry deletes itself via
// DELETE /analytics/posts/{id}/metrics/{metric_id}, reloading the summary so
// a disowned wrong number stops counting.
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

if (typeof Element.prototype.scrollIntoView !== "function") {
  Element.prototype.scrollIntoView = () => {};
}

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
import { toast } from "sonner";

// Radix never opens under jsdom's PointerEvent; the mocked Select contract
// (same as analytics.test.jsx) lets a click call onValueChange directly.
vi.mock("@/components/ui/select", async () => {
  const React = await import("react");
  const SelectContext = React.createContext(null);
  const Select = ({ value, onValueChange, children }) =>
    React.createElement(SelectContext.Provider, { value: { value, onValueChange } }, children);
  const SelectTrigger = ({ children, ...props }) => React.createElement("div", props, children);
  const SelectValue = ({ placeholder }) => React.createElement("span", null, placeholder);
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

const summaryWithUsage = {
  streaks: { current: 2, longest: 4, active_days_30: 7 },
  counts: { by_event: { research_run: 2, ideas_generated: 3 }, total: 5 },
  timeline: Array.from({ length: 30 }, (_, i) => ({
    date: `2026-09-${String(30 - i).padStart(2, "0")}`,
    total: 0,
    by_event: {},
  })),
  comparison: {
    week: { current: { by_event: {}, total: 3 }, previous: { by_event: {}, total: 1 } },
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

const savedIdeas = [{ id: "idea-1", topic_title: "AI agents in production" }];

// Two pasted entries for the selected idea — one of them holds the wrong
// number the user wants to correct.
const loggedEntries = [
  { id: "m_1", posted_on: "2026-09-12", impressions: 850, reactions: 32, comments: 4, reposts: 1, recorded_at: "2026-09-19T10:00:00Z" },
  { id: "m_2", posted_on: "2026-09-05", impressions: 420, reactions: 15, comments: 2, reposts: 0, recorded_at: "2026-09-19T10:00:00Z" },
];

const summaryCalls = () =>
  api.get.mock.calls.filter(([url]) => url === "/analytics/summary").length;

beforeEach(() => {
  localStorage.clear();
  localStorage.setItem("ideaforge_token", "tok");
  authMe.mockResolvedValue({ email: "dev@example.com", name: "Dev" });
  api.get.mockImplementation((url) => {
    if (url === "/auth/me") return authMe();
    if (url === "/analytics/summary") return Promise.resolve(summaryWithUsage);
    if (url === "/saved") return Promise.resolve(savedIdeas);
    if (url === "/analytics/posts/idea-1/metrics") return Promise.resolve(loggedEntries);
    return Promise.resolve({});
  });
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("logged metrics are correctable (Honesty bundle fix 6)", () => {
  it("loads and renders the selected idea's logged entries through the previously unwired GET route", async () => {
    const user = userEvent.setup();
    renderRoute("/analytics");
    await screen.findByTestId("metrics-form");
    await user.click(screen.getByTestId("select-option-idea-1"));

    // The read half: GET fires for the selected idea and the entries render
    // with their real numbers and dates.
    await waitFor(() =>
      expect(api.get).toHaveBeenCalledWith("/analytics/posts/idea-1/metrics"),
    );
    expect(await screen.findByTestId("logged-metrics")).toBeInTheDocument();
    expect(screen.getByTestId("logged-metric-m_1")).toHaveTextContent("850 impressions");
    expect(screen.getByTestId("logged-metric-m_2")).toHaveTextContent("420 impressions");
    expect(screen.getByTestId("logged-metric-m_1")).toHaveTextContent("2026-09-12");
  });

  it("deletes a wrong entry, drops it from the list, and reloads the summary", async () => {
    const user = userEvent.setup();
    renderRoute("/analytics");
    await screen.findByTestId("metrics-form");
    await user.click(screen.getByTestId("select-option-idea-1"));
    await screen.findByTestId("logged-metric-m_1");

    api.delete.mockResolvedValueOnce({ message: "Metric entry deleted" });
    await user.click(screen.getByTestId("logged-metric-delete-m_1"));

    await waitFor(() =>
      expect(api.delete).toHaveBeenCalledWith("/analytics/posts/idea-1/metrics/m_1"),
    );
    await waitFor(() =>
      expect(screen.queryByTestId("logged-metric-m_1")).not.toBeInTheDocument(),
    );
    expect(screen.getByTestId("logged-metric-m_2")).toBeInTheDocument();
    // The correction propagates: the summary reloads so the disowned number
    // stops counting.
    await waitFor(() => expect(summaryCalls()).toBeGreaterThan(1));
  });

  it("fails loud with an honest message when the delete fails", async () => {
    const user = userEvent.setup();
    renderRoute("/analytics");
    await screen.findByTestId("metrics-form");
    await user.click(screen.getByTestId("select-option-idea-1"));
    await screen.findByTestId("logged-metric-m_1");

    api.delete.mockRejectedValueOnce(new Error("down"));
    await user.click(screen.getByTestId("logged-metric-delete-m_1"));
    await waitFor(() =>
      expect(toast.error).toHaveBeenCalledWith(
        "Couldn't delete that entry — it's still logged. Try again.",
      ),
    );
  });

  it("renders an honest read-failure state with retry when the entries GET fails", async () => {
    const user = userEvent.setup();
    api.get.mockImplementation((url) => {
      if (url === "/auth/me") return authMe();
      if (url === "/analytics/summary") return Promise.resolve(summaryWithUsage);
      if (url === "/saved") return Promise.resolve(savedIdeas);
      if (url === "/analytics/posts/idea-1/metrics") return Promise.reject(new Error("boom"));
      return Promise.resolve({});
    });
    renderRoute("/analytics");
    await screen.findByTestId("metrics-form");
    await user.click(screen.getByTestId("select-option-idea-1"));

    expect(await screen.findByTestId("logged-metrics-error")).toHaveTextContent(
      "nothing was changed",
    );
    await user.click(screen.getByRole("button", { name: "Retry" }));
    await waitFor(() =>
      expect(
        api.get.mock.calls.filter(([url]) => url === "/analytics/posts/idea-1/metrics").length,
      ).toBeGreaterThan(1),
    );
  });
});
