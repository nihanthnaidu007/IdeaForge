import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import App from "../App";

// Wave 1 §Onboarding — the guide's frontend contract: the mat states the
// bundled-first promise with allowance facts, the CTAs complete welcome
// (never other steps — those advance on real events), dismissal hides the
// guide until a Settings replay, and the replay never resets progress. The
// server's response body is always the truth the UI renders.

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

const PROGRESS = {
  fresh: {
    steps: { welcome: "current", first_sweep: "pending", first_forge: "pending" },
    completed_at: null,
    dismissed_at: null,
  },
  leftMat: {
    steps: { welcome: "done", first_sweep: "current", first_forge: "pending" },
    completed_at: null,
    dismissed_at: null,
  },
  dismissed: {
    steps: { welcome: "done", first_sweep: "current", first_forge: "pending" },
    completed_at: null,
    dismissed_at: "2026-09-19T00:00:00Z",
  },
  allDone: {
    steps: { welcome: "done", first_sweep: "done", first_forge: "done" },
    completed_at: "2026-09-19T00:00:00Z",
    dismissed_at: null,
  },
};

const CAPS = {
  resources: {
    research: { used: 0, limit: 100, bundled_available: true, byok_connected: false },
    llm: { used: 2, limit: 50, bundled_available: true, byok_connected: false },
  },
  resets_at: "2026-09-20T00:00:00Z",
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
    if (url === "/onboarding") return Promise.resolve(PROGRESS.fresh);
    if (url === "/usage/caps") return Promise.resolve(CAPS);
    return Promise.resolve({});
  });
  api.post.mockResolvedValue({});
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("welcome mat", () => {
  it("states the bundled-first promise with allowance facts on first login", async () => {
    renderRoute("/dashboard");

    const mat = await screen.findByTestId("onboarding-welcome-mat");
    expect(mat).toHaveTextContent("Your forge is live");
    // Facts from /usage/caps, not marketing: bundled key + the daily cap.
    // The caps fetch resolves after the mat paints, so await the first line;
    // all allowance lines render atomically from the same capsSummary map.
    const researchLine = await screen.findByTestId("onboarding-allowance-research");
    expect(researchLine).toHaveTextContent("of 100 today");
    expect(screen.getByTestId("onboarding-allowance-llm")).toHaveTextContent(
      "2 of 50 today",
    );
  });

  it("leaving via the primary CTA completes only the welcome step", async () => {
    api.post.mockImplementation((url) => {
      if (url === "/onboarding/welcome") return Promise.resolve(PROGRESS.leftMat);
      return Promise.resolve({});
    });
    renderRoute("/dashboard");

    const user = userEvent.setup();
    await user.click(await screen.findByTestId("onboarding-start-btn"));

    expect(api.post).toHaveBeenCalledWith("/onboarding/welcome");
    // The mat stands down; the stepper takes over at first_sweep.
    await screen.findByTestId("onboarding-stepper");
    expect(screen.queryByTestId("onboarding-welcome-mat")).toBeNull();
    expect(screen.getByTestId("onboarding-step-first_sweep")).toHaveAttribute(
      "data-status",
      "current",
    );
  });

  it("the optional BYOK path also completes welcome and routes to Settings", async () => {
    api.post.mockImplementation((url) => {
      if (url === "/onboarding/welcome") return Promise.resolve(PROGRESS.leftMat);
      return Promise.resolve({});
    });
    renderRoute("/dashboard");

    const user = userEvent.setup();
    await user.click(await screen.findByTestId("onboarding-byok-btn"));

    expect(api.post).toHaveBeenCalledWith("/onboarding/welcome");
    // Skippable: BYOK setup is optional, but the user did leave the mat.
    expect(await screen.findByTestId("replay-onboarding-btn")).toBeInTheDocument();
  });

  it("dismissal hides the guide and stays hidden", async () => {
    // The GET after dismissal returns the dismissed body — the server's
    // dismissed_at is what keeps the guide hidden, not local state.
    let dismissed = false;
    api.get.mockImplementation((url) => {
      if (url === "/auth/me") return authMe();
      if (url === "/onboarding") {
        return Promise.resolve(dismissed ? PROGRESS.dismissed : PROGRESS.fresh);
      }
      if (url === "/usage/caps") return Promise.resolve(CAPS);
      return Promise.resolve({});
    });
    api.post.mockImplementation((url) => {
      if (url === "/onboarding/dismiss") {
        dismissed = true;
        return Promise.resolve(PROGRESS.dismissed);
      }
      return Promise.resolve({});
    });
    renderRoute("/dashboard");

    const user = userEvent.setup();
    await user.click(await screen.findByTestId("onboarding-dismiss-btn"));

    expect(api.post).toHaveBeenCalledWith("/onboarding/dismiss");
    await screen.findByTestId("trend-radar-heading");
    expect(screen.queryByTestId("onboarding-welcome-mat")).toBeNull();
    expect(screen.queryByTestId("onboarding-stepper")).toBeNull();
  });
});

describe("stepper", () => {
  it("is absent while the user is still on the welcome mat", async () => {
    renderRoute("/dashboard");
    await screen.findByTestId("onboarding-welcome-mat");
    expect(screen.queryByTestId("onboarding-stepper")).toBeNull();
  });

  it("never renders when the flow is complete", async () => {
    api.get.mockImplementation((url) => {
      if (url === "/auth/me") return authMe();
      if (url === "/onboarding") return Promise.resolve(PROGRESS.allDone);
      return Promise.resolve({});
    });
    renderRoute("/dashboard");

    await screen.findByTestId("trend-radar-heading");
    expect(screen.queryByTestId("onboarding-stepper")).toBeNull();
    expect(screen.queryByTestId("onboarding-welcome-mat")).toBeNull();
  });

  it("renders nothing when the progress read fails (fail-open)", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    api.get.mockImplementation((url) => {
      if (url === "/auth/me") return authMe();
      if (url === "/onboarding") return Promise.reject(new Error("down"));
      return Promise.resolve({});
    });
    renderRoute("/dashboard");

    // The dashboard stays usable — the existing empty states are the fallback.
    await screen.findByTestId("trend-radar-heading");
    expect(screen.queryByTestId("onboarding-welcome-mat")).toBeNull();
    expect(screen.queryByTestId("onboarding-stepper")).toBeNull();
    expect(consoleError).toHaveBeenCalled();
    consoleError.mockRestore();
  });
});

describe("settings replay", () => {
  it("re-opens the guide without resetting state", async () => {
    // A completed-then-replayed flow: the server preserves the steps, and
    // this session chooses to show the completed checklist again.
    api.get.mockImplementation((url) => {
      if (url === "/auth/me") return authMe();
      if (url === "/onboarding") return Promise.resolve(PROGRESS.allDone);
      if (url === "/usage/caps") return Promise.resolve(CAPS);
      return Promise.resolve({});
    });
    api.post.mockImplementation((url) => {
      if (url === "/onboarding/replay") return Promise.resolve(PROGRESS.allDone);
      return Promise.resolve({});
    });
    renderRoute("/settings");

    const user = userEvent.setup();
    const btn = await screen.findByTestId("replay-onboarding-btn");
    await user.click(btn);

    expect(api.post).toHaveBeenCalledWith("/onboarding/replay");
    expect(
      await screen.findByText("Setup guide is back on your dashboard."),
    ).toBeInTheDocument();
  });
});
