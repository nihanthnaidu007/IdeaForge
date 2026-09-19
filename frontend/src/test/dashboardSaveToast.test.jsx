import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import App from "../App";

// Honesty bundle fix 4: the forge→board handoff — the Dashboard's save toast
// carries an "Open Board" action, so a save stops being a dead end. The real
// sonner Toaster is rendered (App owns it), so the action is clickable and
// the navigation observable.
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

const SAVE_IDEA = {
  title: "RAG evals",
  rating: 8.4,
  rating_explanation: "High tension, concrete deadline.",
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

describe("save toast links to the board (Honesty bundle fix 4)", () => {
  it("offers Open Board on the save toast and navigates when clicked", async () => {
    api.post
      .mockResolvedValueOnce({ raw_trends: [], researched_at: "2026-09-19T00:00:00Z" })
      .mockResolvedValueOnce({ ideas: [SAVE_IDEA] })
      .mockResolvedValue({ id: "saved_1" });

    const user = userEvent.setup();
    renderRoute("/dashboard");

    await user.click(await screen.findByTestId("generate-ideas-btn"));
    const card = await screen.findByTestId("idea-card-0");
    await user.click(card); // expand to reach the save footer

    await user.click(screen.getByTestId("save-idea-0-btn"));

    // The toast is the handoff: it names the destination and the click
    // actually lands on the board route.
    await waitFor(() => expect(screen.getByText("Idea saved")).toBeInTheDocument());
    const openBoard = screen.getByRole("button", { name: "Open Board" });
    await user.click(openBoard);

    expect(await screen.findByTestId("board-empty")).toBeInTheDocument();
    expect(window.location.pathname).toBe("/board");
  });
});
